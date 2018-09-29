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
const { map } = require('lodash')
const logger = require('pino')({
  name: path.basename(__filename)
})

const { EventEmitter } = require('events')

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

      // dedup jobs
      const idMap = {}

      // cleans up error'd jobs
      queue.active((err, aids) => {
        if (err) return logger.error('Failed to list active jobs')

        aids.forEach(id => {
          const child = logger.child({
            job: id,
            type: 'active'
          })
          kue.Job.get(id, (err, job) => {
            if (err) {
              return
            }
            const now = Date.now()
            const updated = parseInt(job.updated_at, 10)

            const diff = now - updated

            idMap[job.data.id] = true

            // don't always debug until we hit bad territory
            if (diff > (1000 * 60) * 1.5) {
              child.info(`was updated at: ${updated}, ${pretty(diff)}`)
            }

            // 2 minutes
            if (diff > (1000 * 60) * 2) {
              child.warn('removing stale job')
              job.remove()
            }
          })
        })

        queue.inactive(async (err, ids) => {
          if (err) return logger.error('Failed to list inactive')

          const inactiveIDs = {}
          for (const id of ids) {
            const child = logger.child({
              job: id,
              type: 'inactive'
            })

            const job = await getJob(id)
            inactiveIDs[id] = job.data.id
            if (idMap[job.data.id]) {
              child.warn('removing duplicate')
              kue.Job.remove(job.id, () => {})
            }

            idMap[job.data.id] = true
          }

          emitter.emit('active', aids)
          emitter.emit('inactive', Object.keys(inactiveIDs))
        })
      })
    }
  }
}
