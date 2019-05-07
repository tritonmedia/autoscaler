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
const watcher = require('./lib/watcher')
const JobQueue = require('./lib/job')
const os = require('os')
const uuid = require('uuid/v4')
const logger = require('pino')({
  name: path.basename(__filename)
})

// lodash shim to make it easier to understand what's going on here.
const _ = {
  create: require('lodash.create')
}

const jobQueue = new JobQueue()
const printStatus = async () => {
  const pendingJobs = await jobQueue.list()
  logger.info(`${pendingJobs.length} pending operations`)
}

const metricsDb = dyn('redis') + '/1'
logger.info('metrics is at', metricsDb)
const metrics = new Redis(metricsDb)

/* eslint no-unused-vars: 0 */
const WatcherData = {
  deploymentName: '',
  jobType: ''
}

/**
 * @type WatcherData[]
 */
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

/**
 * Creates and manages a queue watcher
 * @param {WatcherData} w watcher to setup
 * @param {kube} kube kubernetes client
 * @param {kube.Queue} queue kue queue object
 * @param {JobQueue} jobQueue job queue
 *
 * @returns {String} watcherId
 */
const createWatcher = async function (w, kube, queue) {
  const emitter = new events.EventEmitter()
  const watcherId = uuid()

  watcher.watcher(queue, w.jobType, emitter)

  let wlog = logger.child({
    queue: w.jobType,
    deplyment: w.deploymentName
  })

  // add to the 'waiting' object
  emitter.on('inactive', async inactive => {
    const inactiveJobs = inactive.length
    const canScale = await kube.canScale(w.deploymentName)
    if (inactiveJobs !== 0 && canScale) {
      await jobQueue.create({
        op: 'scaleUp',
        watcher: watcherId
      })
    }
  })

  emitter.on('active', async active => {
    const activeJobs = active.length
    // process new stuff
    const replicas = await kube.getReplicas(w.deploymentName)
    wlog.info(`activeJobs=${activeJobs},replicas=${replicas}`)
    if (replicas > activeJobs) {
      logger.debug('there are more replicas than active jobs, scaleDown')

      await jobQueue.create({
        op: 'scaleDown',
        watcher: watcherId
      })
    }
  })

  return watcherId
}

const init = async () => {
  const config = await Config('events')
  const queue = kue.createQueue({
    redis: dyn('redis')
  })

  logger.info('loading kubespec')
  const kube = await require('./lib/kube')(config)

  /**
   * Operations to be run on events.
   */
  const ops = {
    scaleUp: async function (data) {
      publishStatus({
        event: 'scaleUp'
      })
    },
    scaleDown: async function (data) {
      publishStatus({
        event: 'scaleDown'
      })
    }
  }

  const poll = async function () {
    const jobs = await jobQueue.ready()
    for (const job of jobs) {
      console.log(job.data)

      if (!ops[job.data.op]) {
        logger.warn('failed to execute job:', job.data.op, 'on watcher', job.data.watcher)
      }
    }

    await printStatus()
  }

  // check every 5 seconds
  setInterval(poll, 5000)

  for (const w of watchers) {
    const watcherId = await createWatcher(w, kube, queue)
    logger.info(`created watcher '${watcherId}' from '%o'`, w)
  }

  queue.watchStuckJobs()

  logger.info('initialized')

  poll()
}

init()
