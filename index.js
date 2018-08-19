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
const events = require('events')
const logger = require('pino')({
  name: path.basename(__filename)
})

const statuses = {
  isPendingScaleDown: {
    status: false,
    since: new Date()
  },
  isPendingScaleUp: {
    status: false,
    since: new Date()
  },
  lastScaleDownTime: new Date(),
  lastScaleUpTime: new Date()
}

const printStatus = () => {
  const scaleDown = statuses.isPendingScaleDown.status
  const scaleUp = statuses.isPendingScaleUp.status

  const child = logger.child({
    scaleDown: scaleDown,
    scaleUp: scaleUp
  })

  child.info(`autoscale status report`)
}

const init = async () => {
  const config = await Config('events')
  const emitter = new events.EventEmitter()
  const queue = kue.createQueue({
    redis: dyn('redis')
  })

  const kube = await require('./lib/kube')(config)
  const watcher = require('./lib/watcher')

  setInterval(watcher.watcher(queue, emitter), 5000)

  // wait a bit to spin up a new deployment
  setInterval(async function () {
    const scaleTime = (1000 * 60) * 1
    const now = new Date()

    // scale up
    if (statuses.isPendingScaleUp.status && !statuses.isPendingScaleDown.status) {
      const diff = now.valueOf() - statuses.isPendingScaleUp.since.valueOf()

      // 1 minute
      if (diff > scaleTime) {
        logger.info('triggered scale up')

        try {
          await kube.scaleUp('triton-converter')
        } catch (err) {
          logger.error('failed to scale up, requeue.', err)
        }
      }
    }

    // scale down
    if (statuses.isPendingScaleDown.status && !statuses.isPendingScaleUp.status) {
      const diff = now.valueOf() - statuses.isPendingScaleDown.since.valueOf()

      // 1 minute
      if (diff > scaleTime) {
        logger.info('triggered scale down')

        try {
          await kube.scaleDown('triton-converter')
        } catch (err) {
          logger.error('failed to scale down, requeue.', err)
        }
      }
    }

    printStatus()
  }, 10000)

  // add to the 'waiting' object
  emitter.on('inactive', inactive => {
    if (inactive !== 0) {
      logger.info('there are pending jobs')

      if (!statuses.isPendingScaleUp.status) {
        statuses.isPendingScaleUp.status = true
        statuses.isPendingScaleUp.since = new Date()
      }
    } else {
      logger.debug('canceled scaleUp, if there was one present')
      statuses.isPendingScaleUp.status = false
    }

    logger.debug(`inactive=${inactive}`)
  })

  emitter.on('active', async active => {
    // process new stuff
    const replicas = await kube.getReplicas('triton-converter')
    if (replicas > active) {
      logger.debug('there are more replicas than active jobs, scaleDown')

      if (!statuses.isPendingScaleDown.status) {
        statuses.isPendingScaleDown.status = true
        statuses.isPendingScaleDown.since = new Date()
      }
    } else {
      logger.debug('canceled scaleDown, if there was one present')
      statuses.isPendingScaleDown.status = false
    }

    logger.debug(`replicas=${replicas}, active=${active}`)
  })

  queue.watchStuckJobs()

  logger.info('initialized')
}

init()
