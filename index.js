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
const Redis = require('ioredis')
const os = require('os')
const logger = require('pino')({
  name: path.basename(__filename)
})

// lodash shim to make it easier to understand what's going on here.
const _ = {
  create: require('lodash.create')
}

// statues is the shim used for each eligible watcher to determine if it can be scaled.
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

// scaleTables contains jobs that should be executed after they are done pending
const scaleTable = []

const printStatus = () => {
  // TODO: re-implement this
}

const metricsDb = dyn('redis') + '/1'
logger.info('metrics is at', metricsDb)
const metrics = new Redis(metricsDb)

// FIXME: convert to CRD some day
// watchers containers a list of watchers, which tell the
// autoscaler what queue to watch and then, in turn, which
// deployment should be scaled off of that queue.
const watchers = [
  {
    deploymentName: 'triton-converter',
    jobType: 'convert'
  },
  {
    deploymentName: 'triton-downloader',
    jobType: 'newMedia'
  }
]

/**
 * Publish the status to the metrics pubsub
 * @param {Object} status status object
 * @example
 *  publishStatus({
 *    event: 'scaleUp'
 * })
 * @returns {Promise}
 */
const publishStatus = async status => {
  const event = _.create({
    host: os.hostname()
  }, status)
  return metrics.publish('events', JSON.stringify(event))
}

const init = async () => {
  const config = await Config('events')
  const emitter = new events.EventEmitter()
  const queue = kue.createQueue({
    redis: dyn('redis')
  })

  const kube = await require('./lib/kube')(config)
  const watcher = require('./lib/watcher').watcher(queue, jobType, emitter)

  const poll = async function () {
    watcher()

    // 10 minutes
    const scaleTime = (1000 * 60) * 5
    const now = new Date()

    // scale up
    if (statuses.isPendingScaleUp.status && !statuses.isPendingScaleDown.status) {
      const diff = now.valueOf() - statuses.isPendingScaleUp.since.valueOf()

      if (diff > scaleTime) {
        logger.info('triggered scale up')

        const canScale = await kube.canScale(deploymentName)
        if (!canScale) {
          logger.warn('Unable to scale up due to pending, or uavailable pods being present.')
          return printStatus()
        }

        try {
          await kube.scaleUp(deploymentName)
          publishStatus({
            event: 'scaleUp'
          })
          statuses.isPendingScaleUp.status = false
          statuses.lastScaleUpTime = new Date()
        } catch (err) {
          logger.error('failed to scale up, requeue.')
        }
      }
    }

    // scale down
    if (statuses.isPendingScaleDown.status && !statuses.isPendingScaleUp.status) {
      const diff = now.valueOf() - statuses.isPendingScaleDown.since.valueOf()

      if (diff > scaleTime) {
        logger.info('triggered scale down')

        try {
          await kube.scaleDown(deploymentName)
          publishStatus({
            event: 'scaleDown'
          })
          statuses.isPendingScaleDown.status = false
          statuses.lastScaleDownTime = new Date()
        } catch (err) {
          logger.error('failed to scale down, requeue.')
        }
      }
    }

    printStatus()
  }

  // check every 5 seconds
  setInterval(poll, 5000)

  // add to the 'waiting' object
  emitter.on('inactive', async inactive => {
    const inactiveJobs = inactive.length
    const canScale = await kube.canScale(deploymentName)
    if (inactiveJobs !== 0 && canScale) {
      logger.info(inactiveJobs, 'job(s) have been pending since', statuses.isPendingScaleUp.since.toISOString())

      if (!statuses.isPendingScaleUp.status) {
        publishStatus({
          event: 'scaleUpPending',
          cause: inactive
        })

        statuses.isPendingScaleUp.status = true
        statuses.isPendingScaleUp.since = new Date()
      }
    } else if (statuses.isPendingScaleUp.status) {
      publishStatus({
        event: 'scaleUpCanceled'
      })
      logger.debug('canceled scaleUp, if there was one present')

      statuses.isPendingScaleUp.status = false
    }

    logger.debug(`inactive=${inactiveJobs}`)
  })

  emitter.on('active', async active => {
    const activeJobs = active.length
    // process new stuff
    const replicas = await kube.getReplicas(deploymentName)
    if (replicas > activeJobs) {
      logger.debug('there are more replicas than active jobs, scaleDown')

      if (!statuses.isPendingScaleDown.status) {
        publishStatus({
          event: 'scaleDownPending',
          cause: active
        })
        statuses.isPendingScaleDown.status = true
        statuses.isPendingScaleDown.since = new Date()
      }

      logger.info(replicas - activeJobs, 'replica(s) are uneeded since', statuses.isPendingScaleDown.since.toISOString())
    } else if (statuses.isPendingScaleDown.status) {
      publishStatus({
        event: 'scaleDownCanceled'
      })
      logger.debug('canceled scaleDown, if there was one present')

      statuses.isPendingScaleDown.status = false
    }

    logger.debug(`replicas=${replicas}, active=${activeJobs}`)
  })

  queue.watchStuckJobs()

  logger.info('initialized')
}

if (process.env.DEBUG) {
  logger.level = 'debug'
}

init()
