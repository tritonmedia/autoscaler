/**
 * Watcher watches over the "queues"
 *
 * @author Jared Allard <jaredallard@outlook.com>
 * @license MIT
 * @version 1
 */

const kue = require('kue')
const pretty = require('pretty-ms')
const path = require('path')
const logger = require('pino')({
  name: path.basename(__filename)
})

if (process.env.DEBUG) {
  logger.level = 'debug'
}

// const { EventEmitter } = require('events')

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

      return resolve(job)
    })
  })
}

module.exports = {
  /**
   * Watcher polls the queue and fires events.
   *
   * @param {kue.Queue} queue is the kue Queue
   * @param {EventEmitter} emitter is the event emitter
   */
  watcher: function (queue, emitter) {
    logger.debug('generated watcher function')
    return function () {
      logger.debug('running ...')

      // cleans up error'd jobs
      queue.active(async (err, aids) => {
        if (err) return logger.error('Failed to list active jobs')


        logger.debug(`active precheck=${aids.length}`)

        // process stale jobs and store active jobs in memory
        let activeJobs = []
        for (let id of aids) {
          const child = logger.child({
            job: id,
            type: 'active'
          })

          const job = await getJob(id)
          const now = Date.now()
          const updated = parseInt(job.updated_at, 10)

          const diff = now - updated

          // don't always debug until we hit bad territory
          if (diff > (1000 * 60) * 1.5) {
            child.info(`was updated at: ${updated}, ${pretty(diff)}`)
          }

          // 2 minutes
          if (diff > (1000 * 60) * 2) {
            child.warn('removing stale job')
            job.remove()
          }

          // check if we're already tracking this jobId
          if(!job.data.id) continue // skip invalid card data
          if (activeJobs.indexOf(job.data.id) !== -1) continue
          activeJobs.push(job.data.id)
        }

        queue.inactive(async (err, ids) => {
          if (err) return logger.error('Failed to list inactive')

          logger.debug(`inactive precheck=${ids.length}`)

          let inactiveJobs = []
          for (let id of ids) {
            let job
            try {
              job = await getJob(id)
              if (!job.data.id) continue
            } catch (err) {
              continue
            }

            if (inactiveJobs.indexOf(job.data.id) !== -1) continue
            inactiveJobs.push(job.data.id)
          }

          emitter.emit('active', activeJobs)
          emitter.emit('inactive', inactiveJobs)
        })
      })
    }
  }
}
