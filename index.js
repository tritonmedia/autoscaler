/**
 * Deployment Autoscaler
 *
 * @author Jared Allard <jaredallard@outlook.com>
 * @license MIT
 * @version 1
 */

'use strict'

const dyn = require('triton-core/dynamics')
const Config = require('triton-core/config')
const kue = require('kue')
const path = require('path')
const fecha = require('fecha')
const events = require('events')
const pretty = require('pretty-ms')
const logger = require('pino')({
  name: path.basename(__filename)
})

const waiting = {}

const init = async () => {
  const config = await Config('events')
  const emitter = new events.EventEmitter()
  const queue = kue.createQueue({
    redis: dyn('redis')
  })

  const kube = await require('./lib/kube')(config)
  const watcher = require('./lib/watcher')

  setInterval(watcher.watcher(queue, emitter), 1000)

  // wait a bit to spin up a new deployment
  setInterval(async function() {
    const now = new Date()
    const keys = Object.keys(waiting)

    for(const jobId of keys) {
      const since = waiting[jobId].date
      const ack = waiting[jobId].ack

      const child = logger.child({
        job: jobId,
        since,
        ack
      })

      // noop on ack
      if (ack) continue 

      const diff = now.valueOf() - since.valueOf()

      const sinceFriendly = fecha.format(since, 'default')
      child.info(`${jobId} has been pending for ${pretty(diff)}`)

      // 5 minutes
      if (diff > (1000 * 60) * 1 ) {
        waiting[jobId].ack = true
        child.info('triggered scale up')

        try {
          await kube.scaleUp("triton-converter")
        } catch(err) {
          child.error('failed to scale up, requeue.')
          delete waiting[jobId]
        }
      }
    }
  }, 10000)

  // add to the 'waiting' object
  emitter.on('inactive-jobs', inactive => {
    logger.debug('inactive-fired', inactive)

    inactive.forEach(job => {
      if (waiting[job.id] === undefined) {
        waiting[job.id] = {
          date: new Date(),
          ack: false
        }
      }
    })
  })

  emitter.on('completed-jobs', completed => {
    logger.debug('completed-fired', completed)
  })

  logger.info('initialized')
}

init()
