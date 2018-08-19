/**
 * Watcher watches over the "queues"
 * 
 * @author Jared Allard <jaredallard@outlook.com>
 * @license MIT
 * @version 1
 */

const kue = require('kue')
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

      kue.Job.rangeByType('newMedia', 'inactive', 0, 100, 'asc', (err, jobs) => {
        if (err) return logger.error('Failed to list inactive jobs:', err)

        const inactiveJobs = jobs.length

        if (inactiveJobs !== 0) {
          const inactiveMap = map(jobs, job => {
            return {
              id: job.data.id
            }
          })

          emitter.emit('inactive-jobs', inactiveMap)
        }
      })

      kue.Job.rangeByType('newMedia', 'complete', 0, 100, 'asc', (err, jobs) => {
        if (err) return logger.error('Failed to list completed jobs')

        const completedJobs = jobs.length

        if (completedJobs !== 0) {
          const jobMap = map(jobs, job => {
            return {
              id: job.data.id
            }
          })

          emitter.emit('completed-jobs', jobMap)
        }
      })
    }
  }
}
