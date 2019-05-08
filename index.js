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
const prettyMs = require('pretty-ms')
const os = require('os')
const uuid = require('uuid/v4')
const logger = require('pino')({
  name: path.basename(__filename)
})

// internals
const Watcher = require('./lib/watcher')
const JobQueue = require('./lib/job')
const Kube = require('./lib/kube')

// lodash shim to make it easier to understand what's going on here.
const _ = {
  create: require('lodash.create')
}

const jobQueue = new JobQueue()
const printStatus = async () => {
  const pendingJobs = await jobQueue.list()
  for (const op of pendingJobs) {
    const w = watcherTable.get(op.data.watcher)
    const deployment = w.deployment

    const now = new Date()
    const diff = now.valueOf() - op.created_at.valueOf()

    logger.info(`Operation '${op.data.op}' deployment '${deployment}' has been pending for ${prettyMs(diff)} (${op.created_at.toISOString()})`)
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
 * @param {Kube} kube kubernetes client
 * @param {kue.Queue} queue kue queue object
 * @param {JobQueue} jobQueue job queue
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
        watcher: watcher.id,
        queue: w.jobType
      })
    }
  })

  watcher.on('active', async active => {
    const activeJobs = active.length
    // process new stuff
    const replicas = await kube.getReplicas(w.deploymentName)
    if (replicas > activeJobs) {
      await jobQueue.create({
        op: 'scaleDown',
        watcher: watcher.id,
        queue: w.jobType
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
  const kube = await Kube(config)

  /**
   * Operations to be run on events.
   */
  const ops = {
    scaleUp: async function (data) {
      logger.info(`executing scaleUp on '%o'`, data)

      const watcher = watcherTable.get(data.watcher)
      const deployment = watcher.deployment

      await kube.scaleUp(deployment)
      publishStatus({
        event: 'scaleUp'
      })
    },
    scaleDown: async function (data) {
      logger.info(`executing scaleDown on '%o'`, data)

      const watcher = watcherTable.get(data.watcher)
      const deployment = watcher.deployment

      await kube.scaleDown(deployment)
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

      await ops[job.data.op](job.data)
      await jobQueue.finish(job.id)
    }

    await printStatus()
  }

  // check every 20 seconds
  setInterval(poll, 1000 * 20)

  const k8sWatchers = await kube._client.apis['tritonjs.com'].v1.namespaces('default').autoscalerwatchers.get()
  for (const w of k8sWatchers.body.items) {
    if (!w.spec || !w.spec.deploymentName || !w.spec.jobType) {
      logger.warn('Skipping invalid watcher', w.metadata.name)
    }
    const watcherId = await createWatcher(w.spec, kube, queue)
    logger.info(`created watcher '${watcherId}' from '%o'`, w.spec)
  }

  queue.watchStuckJobs()
  jobQueue.startWatcher()

  logger.info('initialized')

  poll()
}

init()
