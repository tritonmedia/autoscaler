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
   * @param {kue.Queue} queue kue queue
   */
  constructor (jobType, deploymentName, queue) {
    super()

    /**
     * @type {String}
     */
    this.id = uuid()
    this.jobType = jobType
    this.deployment = deploymentName

    // private stuff
    this._queue = queue
    this._pollInterval = 0
  }

  /**
   * Terminate a watcher
   */
  async terminate () {
    this.removeAllListeners()
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
   * Polls for active and inactive jobs in Kue
   */
  _poll () {
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
