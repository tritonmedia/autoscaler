/**
 * AMQP Library
 *
 * @author Jared Allard <jaredallard@outlook.com>
 * @license MIT
 * @version 1.0
 */

'use strict'

const amqp = require('amqp-connection-manager')
const path = require('path')
const events = require('events')
const logger = require('pino')({
  name: path.basename(__filename)
})

const required = () => {
  throw new Error('Missing required parameter to AMQP.')
}

class AMQP {
  constructor (host = required()) {
    this.host = host
    this.mode = null

    // queue creation options
    // TODO: make configurable
    this.numConsumerQueues = 2

    /**
     * @type {Map<string,Number>}
     */
    this._topicState = new Map()
    this._events = new events.EventEmitter()

    // connection and channels in use
    this.connection = null
    this.channel = null
  }

  async connect () {
    return new Promise(async (resolve, reject) => {
      this.connection = await amqp.connect(this.host)
      this.connection.on('disconnect', err => {
        logger.warn('disconnected to rabbitmq', err)
      })
      this.connection.on('connect', () => {
        logger.info('connected to rabbitmq')
        resolve()
      })
    })
  }

  /**
   * Ensure that an exchange exists.
   *
   * @param {amqp.ChannelWrapper} channel amqplib channel (std)
   * @param {String} name name of the exchange
   * @param {Object} options options for the exchange, see amqp.assertExchange
   * @see http://www.squaremobius.net/amqp.node/channel_api.html#channelassertexchange
   */
  async _ensureExchange (channel = required(), name = required(), options = {}) {
    logger.info('ensuring exchange', name)
    return channel.assertExchange(name, 'direct', options)
  }

  /**
   * Ensure that consumer queues exist.
   *
   * @param {amqp.ChannelWrapper} channel amqplib channel (std)
   * @param {String} exchangeName exchange to bind too
   * @see http://www.squaremobius.net/amqp.node/channel_api.html#channelassertqueue
   * @see http://www.squaremobius.net/amqp.node/channel_api.html#channelbindqueue
   */
  async _ensureConsumerQueues (channel = required(), exchangeName = required()) {
    for (let i = 0; i !== this.numConsumerQueues; i++) {
      const queueName = `${exchangeName}-${i}`
      logger.info('creating consumer queue', queueName)

      try {
        await channel.assertQueue(queueName)
      } catch (err) {
        logger.error('failed to create queue', queueName, err.stack)
      }

      // bind the queue to the exchange based on the queueName
      logger.info(`binding queue '${queueName}' to exchange '${exchangeName}'`)
      try {
        await channel.bindQueue(queueName, exchangeName, queueName)
      } catch (err) {
        logger.error('failed to bind:', err.stack)
      }
    }
  }

  /**
   * Listen on for a routing key
   *
   * @param {String} topic topic of the message
   * @param {Function} processor function that processes new jobs
   * @returns {Promise} never RESOLVES
   * @see http://www.squaremobius.net/amqp.node/channel_api.html#channelconsume
   */
  async listen (topic = required(), processor = required()) {
    if (this.mode && this.mode === 'publisher') throw new Error('Already marked as a publisher.')

    this.connection.createChannel({
      json: false,
      setup: async channel => {
        logger.info('executing channel setup')
        await this._ensureExchange(channel, topic, {})
        await this._ensureConsumerQueues(channel, topic)
        this._events.emit('initialized')

        for (let i = 0; i !== this.numConsumerQueues; i++) {
          const queueName = `${topic}-${i}`

          logger.info('subscribing to queue', queueName)
          channel.consume(queueName, msg => {
            try {
              return processor({
                message: msg,
                ack: () => {
                  channel.ack(msg)
                }
              })
            } catch (err) {
              logger.error('processor failed', err)
            }
          })
        }
      }
    })
  }

  /**
   * Publish a message. Marks this class as being in publish mode.
   *
   * @param {String} topic topic of the message
   * @param {Buffer} body body of the message
   */
  async publish (topic = required(), body = required()) {
    if (this.mode && this.mode === 'consumer') throw new Error('Already marked as a consumer.')

    const generateChannel = async () => {
      if (!this.channel) {
        logger.warn('generating channel')
        this.channel = await this.connection.createChannel({
          json: false,
          setup: async channel => {
            return this._ensureExchange(channel, topic, {})
          }
        })

        await this.channel.waitForConnect()
        logger.info('channel is ready')
      }

      return this.channel
    }
    const channel = await generateChannel()

    // get the last routing key index we used for this topic
    let rkIndex = this._topicState.get(topic)
    if (rkIndex === undefined) {
      this._topicState.set(topic, 0)
      rkIndex = 0
    }

    // format the routin key
    const rk = `${topic}-${rkIndex}`

    logger.info('publishing to exchange', topic, 'using rk', rk)

    try {
      await channel.publish(topic, rk, body)
    } catch (err) {
      logger.error('failed to publish', err)
    }

    // reset if we're at the max num of consumer queues
    if (rkIndex === this.numConsumerQueues - 1) {
      rkIndex = 0
    } else {
      rkIndex++
    }

    this._topicState.set(topic, rkIndex)
  }

  async close () {
    this.connection.close()
  }
}

module.exports = AMQP
