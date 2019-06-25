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
const path = require('path')
const events = require('events')
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

/* eslint no-unused-vars: 0 */
const WatcherData = {
  deploymentName: '',
  jobType: '',
  pendingTimeMinutes: 10
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
  return // NOOP
}

/**
 * Creates and manages a queue watcher
 * @param {WatcherData} w watcher to setup
 * @param {Kube} kube kubernetes client
 * @param {JobQueue} jobQueue job queue
 * @returns {String} watcherId
 */
const createWatcher = async function (w, kube) {
  const watcher = new Watcher(w.jobType, w.deploymentName, w.pendingTimeMinutes, jobQueue, kube)
  watcher.start()
  watcherTable.set(watcher.id, watcher)

  return watcher.id
}

const init = async () => {
  const config = await Config('events')

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

  /**
   * @type Map<String, String>
   */
  const k8swatcherToUUID = new Map()
  const k8sevents = kube.watchWatchers()
  k8sevents.on('created', async item => {
    const { name, namespace } = item.object.metadata
    logger.info('on::create:getWatcher(): \'%s\' in namespace \'%s\'', name, namespace)
    const w = await kube.getWatcher(name, namespace)
    if (!w.spec || !w.spec.deploymentName || !w.spec.jobType) {
      logger.warn('Skipping invalid watcher', w.metadata.name)
    }
    const watcherId = await createWatcher(w.spec, kube)
    logger.info(`created watcher '${watcherId}' from '%o'`, w.spec)
    k8swatcherToUUID.set(`${name}:${namespace}`, watcherId)
  })
  k8sevents.on('removed', async item => {
    const { name, namespace } = item.object.metadata
    const watcherId = k8swatcherToUUID.get(`${name}:${namespace}`)
    logger.info(`removed watcher %s (ID: %s)`, `${name}:${namespace}`, watcherId)
    const watcher = watcherTable.get(watcherId)
    await watcher.terminate()
    watcherTable.delete(watcherId)
  })

  jobQueue.startWatcher()

  logger.info('initialized')

  poll()
}

init()
