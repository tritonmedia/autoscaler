/**
 * Job - a in-memory job queue that supports pending events
 *
 * @author Jared Allard <jaredallard@outlook.com>
 * @license MIT
 * @version 1
 */

'use strict'

const uuid = require('uuid/v4')
const path = require('path')
const crypto = require('crypto')
const logger = require('pino')({
  name: path.basename(__filename)
})
const _ = {
  create: require('lodash.create'),
  defaults: require('lodash.defaults'),
  cloneDeep: require('lodash.clonedeep')
}

// JobData is the data of a Job
const JobData = {
  watcher: '',
  op: ''
}

// Job is a job object
const Job = {
  // id of the job
  id: '',

  // is this job being processed at the moment
  mutex: false,

  /**
   * @type JobData
   */
  data: _.defaults(JobData),

  // time this job was created
  created_at: new Date(),
  updated_at: new Date(),

  // promote job after x minutes
  promote_after_minutes: 10,

  // timeout to expire this job if it hasn't been updated
  timeout_seconds: 180
}

/**
 * @class JobQueue
 * @description A JobQueue powered by in-memory backing, with support
 * for jobs that expire if not updated.
 */
class JobQueue {
  constructor () {
    const jobMap = {
      /**
       * @type Map<String, Job>
       */
      jobs: new Map(),

      /**
       * Hashes of all job contents to quickly search for duplicates
       * @type Map<String, String>
       */
      contents: new Map()
    }

    /**
     * @type jobMap
     */
    this.pending = _.defaults(jobMap)

    /**
     * @type {Number}
     */
    this._interval = null

    /**
     * @type Job[]
     */
    this.readyJobs = []
  }

  /**
   * Returns ready jobs and removes them from the queue.
   * @returns {Job[]} jobs to process
   */
  async ready () {
    process.nextTick(() => {
      delete this.readyJobs
      this.readyJobs = []
    })
    return this.readyJobs
  }

  /**
   * Create a new job
   * @param {JobData} data watcher and operation data
   * @param {Number} promoteAfterMinutes number of minutes to promote job to ready
   * @param {Number} timeoutSeconds number of seconds to timeout the job if it hasn't been updated
   * @example
   *  const jobQueue = new JobQueue()
   *  const job = await jobQueue.create({ watcher: 'uuid', op: 'scaleUp' })
   * @returns {Job} a promise
   */
  async create (data, promoteAfterMinutes = null, timeoutSeconds = null) {
    const existingId = await this.exists(data)
    if (existingId !== -1) {
      // logger.info('using existing job', existingId)
      const job = await this.get(existingId)
      job.updated_at = new Date()
      this.pending.jobs.set(existingId, job)
      return job
    }

    /**
     * @type {Job}
     */
    const job = _.defaults({
      id: uuid(),
      data: data,
      created_at: new Date()
    }, Job)

    if (promoteAfterMinutes) {
      job.promote_after_minutes = promoteAfterMinutes
    }

    if (timeoutSeconds) {
      job.timeout_seconds = timeoutSeconds
    }

    // logger.info('creating new job', job.id)

    this.pending.jobs.set(job.id, job)

    // logger.info(JSON.stringify(Array.from(this.pending.jobs.keys())))

    const hash = await this._hashData(job)
    this.pending.contents.set(hash, job.id)

    return job
  }

  /**
   * Check if a job exists by it's data, this is O(1)
   * @param {Object} data job data
   * @example
   *  const jobQueue = new JobQueue()
   *  const job = await jobQueue.create({ watcher: 'uuid', op: 'scaleUp' })
   *  const job2 = await jobQueue.find({  watcher: 'uuid', op: 'scaleUp' })
   * @returns {Number} job id, or -1 if not found
   */
  async exists (data) {
    const hash = await this._hashData({
      data
    })

    // logger.info('checking for hash', hash, Array.from(this.pending.contents.keys()), Array.from(this.pending.jobs.keys()))

    const id = this.pending.contents.get(hash)
    if (id === undefined) {
      return -1
    }

    return id
  }

  /**
   * Hash the data of a job
   * @param {Job} job job object
   */
  async _hashData (job) {
    return crypto.createHash('sha512').update(JSON.stringify(job.data)).digest('hex')
  }

  /**
   * Delete a job by ID
   * @param {String} id id of a job
   * @returns {Job} job object that was deleted
   */
  async delete (id) {
    const job = await this.get(id)
    const hash = await this._hashData(job)

    this.pending.jobs.delete(job.id)
    this.pending.contents.delete(hash)

    return job
  }

  /**
   * Get a job by it's ID
   * @param {String} id id of a job
   * @returns {Job} job object
   */
  async get (id) {
    const val = this.pending.jobs.get(id)
    if (val === undefined) {
      throw new Error(`Couldn't find job '${id}'`)
    }

    return _.cloneDeep(val)
  }

  /**
   * Mark a job as finished and delete it
   * @param {String} id id of the job
   */
  async finish (id) {
    this.delete(id)
  }

  /**
   * List all pending jobs
   * @returns {Job[]} pending jobs
   */
  async list () {
    const jobs = []
    for (const j of this.pending.jobs) {
      const job = j[1]
      if (job.mutex) continue
      jobs.push(job)
    }

    return jobs
  }

  async _watcher () {
    for (const j of this.pending.jobs) {
      const job = j[1] // see how maps work for explanation for this

      if (job.mutex) continue

      const now = new Date()

      const updatedDiff = now.getTime() - job.updated_at.getTime()
      if (updatedDiff > (1000 * job.timeout_seconds)) {
        // ogger.info(`expiring job '${job.id}' %o`, job.data)
        await this.delete(job.id)
        continue
      }

      // check if job is ready to be promoted
      const createdDiff = now.getTime() - job.created_at.getTime()
      if (createdDiff < (60000 * job.promote_after_minutes)) {
        continue
      }

      logger.info(`promoting job '${job.id}'`)
      job.mutex = true
      this.pending.jobs.set(job.id, job) // can't recall if this is already set, so be safe
      this.readyJobs.push(job)
    }
  }

  /**
   * Start watching for jobs that haven't been updated
   */
  startWatcher () {
    this._interval = setInterval(this._watcher.bind(this), 1000)
  }

  /**
   * Stop the queue.
   */
  stop () {
    if (this._interval === null) throw new Error('Not started')
    clearInterval(this._interval)
  }
}

module.exports = JobQueue
