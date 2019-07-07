/**
 * Watcher Library
 *
 * @author Jared Allard <jaredallard@outlook.com>
 * @license MIT
 * @version 0.1
 */

'use strict'

const uuid = require('uuid/v4')
const events = require('events')
const path = require('path')

const request = require('request-promise-native')
const _ = require('lodash')
const logger = require('pino')({
  name: path.basename(__filename)
})

/* eslint no-unused-vars: 0 */
const JobQueue = require('./job')
const Kube = require('./kube')

class Watcher extends events.EventEmitter {
  /**
   * Create a watcher
   * @constructor
   * @param {String} jobType queue to listen on
   * @param {String} deploymentName deployment this is related too
   * @param {Number} [pendingTimeMinutes=10] time to have job created by this watcher to be pending
   * @param {JobQueue} jobQueue see ./lib/job.js
   * @param {Kube} kube kubernetes client
   * @param {kue.Queue} queue kue queue
   */
  constructor (jobType, deploymentName, pendingTimeMinutes = 10, jobQueue, kube) {
    super()

    /**
     * @type {String}
     */
    this.id = uuid()
    this.jobType = jobType
    this.jobQueue = jobQueue
    this.deployment = deploymentName
    this.pendingTimeMinutes = pendingTimeMinutes

    // private stuff
    this._pollInterval = 0
    this._jobs = []

    // on jobs waiting
    this.on('inactive', async inactiveJobs => {
      const canScale = await kube.canScale(deploymentName)
      const replicas = await kube.getReplicas(deploymentName)

      if (replicas === inactiveJobs && inactiveJobs !== 0) {
        return logger.warn('want to scale up, but already at replica-inactive limit')
      }

      if (inactiveJobs !== 0 && canScale) {
        const job = await jobQueue.create({
          op: 'scaleUp',
          watcher: this.id,
          queue: jobType
        }, this.pendingTimeMinutes)
        if (this._jobs.indexOf(job.id) === -1) this._jobs.push(job.id)
      }
    })
    // on jobs active
    this.on('active', async activeJobs => {
      const replicas = await kube.getReplicas(deploymentName)
      if (replicas > activeJobs) {
        const job = await jobQueue.create({
          op: 'scaleDown',
          watcher: this.id,
          queue: jobType
        }, this.pendingTimeMinutes)
        if (this._jobs.indexOf(job.id) === -1) this._jobs.push(job.id)
      }
    })
  }

  /**
   * Terminate a watcher
   */
  async terminate () {
    this.removeAllListeners()
    for (const id of this._jobs) {
      try {
        await this.jobQueue.get(id)
      } catch (err) {
        // doesn't exist, skip
        continue
      }

      try {
        await this.jobQueue.delete(id)
      } catch (err) {
        // TODO: print a warning that we failed to cleanup a live job
      }
    }
    delete this._jobs

    clearInterval(this._pollInterval)
  }

  /**
   * Start the watcher
   */
  async start () {
    this._startWatcher()
  }

  // PRIVATE FUNCTIONS

  /**
   * _gc cleanups up jobs that don't exist anymore, i.e had finish()
   * called on them, or they expired
   */
  async _gc () {
    // TODO: could probably use a filter or something cooler
    let index = 0
    for (const id of this._jobs) {
      try {
        await this.jobQueue.get(id)
      } catch (err) {
        this._jobs.splice(index, 1)
      }
      index++
    }
  }

  async _watcher () {
    this._gc()

    // TODO: use service discovery for this
    const rabbitMQURL = 'http://user:bitnami@triton-rabbitmq:15672/api'

    let bindings
    try {
      bindings = await request({
        uri: rabbitMQURL + '/bindings',
        json: true
      })
    } catch (err) {
      logger.error('failed to hit rabbitmq:', err.message || err)
      return
    }

    logger.debug(`checking exchange ${this.jobType}`)

    const queues = _.filter(bindings, {
      source: this.jobType
    }).map(binding => {
      return binding.destination
    })

    logger.debug(`exchange ${this.jobType} has ${queues.length} queues bound`)

    const knownQueuesHM = new Map()

    let knownQueues
    try {
      knownQueues = await request({
        uri: rabbitMQURL + '/queues',
        json: true
      })
    } catch (err) {
      logger.error('failed to hit rabbitmq:', err.message || err)
      return
    }

    for (let queue of knownQueues) {
      knownQueuesHM.set(queue.name, queue)
    }

    let ready = 0
    let unacked = 0
    for (let queue of queues) {
      const qobj = knownQueuesHM.get(queue)
      if (!qobj) {
        logger.warn(`failed to find queue ${queue} in-mem`)
        continue
      }

      ready += qobj.messages_ready
      unacked += qobj.messages_unacknowledged
    }

    if (ready !== 0) {
      logger.debug(`exchange ${this.jobType} has ${ready} ready message(s)`)
    }

    if (unacked !== 0) {
      logger.debug(`exchange ${this.jobType} has ${unacked} unacked message(s)`)
    }

    this.emit('inactive', ready)
    this.emit('active', unacked)
  }

  _startWatcher () {
    this._pollInterval = setInterval(this._watcher.bind(this), 5000)
  }
}

module.exports = Watcher
