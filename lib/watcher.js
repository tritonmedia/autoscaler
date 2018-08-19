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

      queue.inactiveCount('newMedia', (err, jobs) => {
        if (err) return logger.error('Failed to list inactive jobs')
        emitter.emit('inactive', jobs)
      })

      queue.activeCount('newMedia', (err, jobs) => {
        if (err) return logger.error('Failed to list active jobs')
        emitter.emit('active', jobs)
      })

      // cleans up error'd jobs
      queue.active(function (err, ids) {
        ids.forEach(function (id) {
          const child = logger.child({
            job: id
          })
          kue.Job.get(id, function (err, job) {
            const now = Date.now()
            const updated = parseInt(job.updated_at, 10)

            const diff = now - updated

            child.info(`was updated at: ${updated}, ${pretty(diff)}`)

            // 2 minutes
            if (diff > (1000 * 60) * 2) {
              child.warn('removing stale job')
              job.remove()
            }
          })
        })
      })
    }
  }
}
