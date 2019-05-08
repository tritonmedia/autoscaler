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
const Watcher = require('./lib/watcher')
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
  for (const op of pendingJobs) {
    const w = watcherTable.get(op.data.watcher)
    const queue = w.jobType
    const deployment = w.deployment

    logger.info(`Pending Operation: op=${op.data.op},queue=${queue},deployment=${deployment},watcher=${op.data.watcher}`)
  }
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
 * @type {Map<String, Watcher>}
 */
const watcherTable = new Map()

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
 * @param {kue.Queue} queue kue queue object
 * @param {JobQueue} jobQueue job queue
 *
 * @returns {String} watcherId
 */
const createWatcher = async function (w, kube, queue) {
  const watcher = new Watcher(w.jobType, w.deploymentName, queue)

  let wlog = logger.child({
    queue: w.jobType,
    deplyment: w.deploymentName
  })

  // add to the 'waiting' object
  watcher.on('inactive', async inactive => {
    const inactiveJobs = inactive.length
    const canScale = await kube.canScale(w.deploymentName)
    if (inactiveJobs !== 0 && canScale) {
      await jobQueue.create({
        op: 'scaleUp',
        watcher: watcher.id
      })
    }
  })

  watcher.on('active', async active => {
    const activeJobs = active.length
    // process new stuff
    const replicas = await kube.getReplicas(w.deploymentName)
    wlog.info(`activeJobs=${activeJobs},replicas=${replicas}`)
    if (replicas > activeJobs) {
      logger.debug('there are more replicas than active jobs, scaleDown')

      await jobQueue.create({
        op: 'scaleDown',
        watcher: watcher.id
      })
    }
  })

  watcher.start()

  watcherTable.set(watcher.id, watcher)

  return watcher.id
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
