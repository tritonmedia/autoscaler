/**
 * Watcher Library
 *
 * @author Jared Allard <jaredallard@outlook.com>
 * @license MIT
 * @version 0.1
 */

'use strict'

const uuid = require('uuid/v4')
const events = require('events')
const path = require('path')
const kue = require('kue')
const logger = require('pino')({
  name: path.basename(__filename)
})

const JobQueue = require('./job')
const Kube = require('./kube')

/**
 * getJob gets a job w/ a promise
 *
 * @param {String} id Job ID
 * @returns {kue.Job} job
 */
const getJob = async id => {
  return new Promise((resolve, reject) => {
    kue.Job.get(id, (err, job) => {
      if (err) return reject(err)

      /* @type kue.Job */
      return resolve(job)
    })
  })
}

class Watcher extends events.EventEmitter {
  /**
   * Create a watcher
   * @constructor
   * @param {String} jobType queue to listen on
   * @param {String} deploymentName deployment this is related too
   * @param {JobQueue} jobQueue see ./lib/job.js
   * @param {Kube} kube kubernetes client
   * @param {kue.Queue} queue kue queue
   */
  constructor (jobType, deploymentName, queue, jobQueue, kube) {
    super()

    /**
     * @type {String}
     */
    this.id = uuid()
    this.jobType = jobType
    this.jobQueue = jobQueue
    this.deployment = deploymentName

    // private stuff
    this._queue = queue
    this._pollInterval = 0
    this._jobs = []

    // listeners for later
    // TODO: cleanup this._jobs so it doesn't grow forever
    this.on('inactive', async inactive => {
      const inactiveJobs = inactive.length
      const canScale = await kube.canScale(deploymentName)
      if (inactiveJobs !== 0 && canScale) {
        const job = await jobQueue.create({
          op: 'scaleUp',
          watcher: this.id,
          queue: jobType
        })
        if (this._jobs.indexOf(job.id) === -1) this._jobs.push(job.id)
      }
    })

    this.on('active', async active => {
      const activeJobs = active.length
      const replicas = await kube.getReplicas(deploymentName)
      if (replicas > activeJobs) {
        const job = await jobQueue.create({
          op: 'scaleDown',
          watcher: this.id,
          queue: jobType
        })
        if (this._jobs.indexOf(job.id) === -1) this._jobs.push(job.id)
      }
    })
  }

  /**
   * Terminate a watcher
   */
  async terminate () {
    this.removeAllListeners()
    for (const id of this._jobs) {
      try {
        await this.jobQueue.get(id)
      } catch (err) {
        // doesn't exist, skip
        continue
      }

      try {
        await this.jobQueue.delete(id)
      } catch (err) {
        // TODO: print a warning that we failed to cleanup a live job
      }
    }
    delete this._jobs

    clearInterval(this._pollInterval)
  }

  /**
   * Start the watcher
   */
  async start () {
    this._startWatcher()
  }

  // PRIVATE FUNCTIONS

  /**
   * _gc cleanups up jobs that don't exist anymore, i.e had finish()
   * called on them, or they expired
   */
  async _gc () {
    // TODO: could probably use a filter or something cooler
    let index = 0
    for (const id of this._jobs) {
      try {
        await this.jobQueue.get(id)
      } catch (err) {
        this._jobs.splice(index, 1)
      }
      index++
    }
  }

  /**
   * Polls for active and inactive jobs in Kue
   */
  _poll () {
    this._gc()
    // cleans up error'd jobs
    this._queue.active(async (err, aids) => {
      if (err) return logger.error('Failed to list active jobs')

      // process stale jobs and store active jobs in memory
      let activeJobs = []
      for (let id of aids) {
        const child = logger.child({
          job: id,
          type: 'active'
        })

        const job = await getJob(id)

        if (job.type !== this.jobType) continue

        const now = Date.now()
        const updated = parseInt(job.updated_at, 10)

        const diff = now - updated

        // 2 minutes
        if (diff > (1000 * 60) * 2) {
          child.warn(`removing stale job '${id}'`)
          job.remove()
        }

        // check if we're already tracking this jobId
        if (!job.data.id) continue // skip invalid card data
        if (activeJobs.indexOf(job.data.id) !== -1) continue
        activeJobs.push(job.data.id)
      }

      this._queue.inactive(async (err, ids) => {
        if (err) return logger.error('Failed to list inactive')

        let inactiveJobs = []
        for (let id of ids) {
          let job
          try {
            job = await getJob(id)
            if (job.type !== this.jobType) continue
            if (!job.data.id) continue
          } catch (err) {
            continue
          }

          if (inactiveJobs.indexOf(job.data.id) !== -1) continue
          inactiveJobs.push(job.data.id)
        }

        this.emit('active', activeJobs)
        this.emit('inactive', inactiveJobs)
      })
    })
  }

  _startWatcher () {
    this._pollInterval = setInterval(this._poll.bind(this), 5000)
  }
}

module.exports = Watcher
