/**
 * AMQP Library
 *
 * @author Jared Allard <jaredallard@outlook.com>
 * @license MIT
 * @version 1.0
 */

'use strict'

const amqp = require('amqp-connection-manager')

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

    // connection and channels in use
    this.connection = null
    this.channel = null
  }

  async connect () {
    this.connection = await amqp.connect(this.host)
  }

  /**
   * Create a channel on the existing connection
   *
   * @returns {amqp.ChannelWrapper}
   */
  async createChannel (exchange = required(), routingKey = required()) {
    if (!this.channel) {
      this.channel = await this.connection.createChannel({
        json: false,
        setup: async channel => {
          await this._ensureExchange(channel, exchange, {})
          await this._ensureConsumerQueues(channel, exchange, routingKey)
        }
      })
    }
    return this.channel
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
    try {
      await channel.checkExchange(name)
    } catch (err) {
      // doesn't exist
      await channel.assertExchange(name, 'direct', options)
    }
  }

  /**
   * Ensure that consumer queues exist.
   *
   * @param {amqp.ChannelWrapper} channel amqplib channel (std)
   * @param {String} exchangeName exchange to bind too
   * @param {String} routingKey routing key to use
   * @see http://www.squaremobius.net/amqp.node/channel_api.html#channelassertqueue
   * @see http://www.squaremobius.net/amqp.node/channel_api.html#channelbindqueue
   */
  async _ensureConsumerQueues (channel = required(), exchangeName = required(), routingKey = required()) {
    for (let i = 0; i !== this.numConsumerQueues; i++) {
      const queueName = `${routingKey}-${i}`
      try {
        await channel.checkQueue(queueName)
      } catch (err) {
        await channel.assertQueue(queueName)
      }

      // bind the queue to the exchange based on the routing key
      await channel.bindQueue(queueName, exchangeName, routingKey)
    }
  }

  /**
   * Listen on for a routing key
   *
   * @param {String} exchange name of the exchange
   * @param {String} routingKey routing key
   * @param {Function} processor function that processes new jobs
   * @returns {Promise} never RESOLVES
   * @see http://www.squaremobius.net/amqp.node/channel_api.html#channelconsume
   */
  async listen (exchange = required(), routingKey = required(), processor = required()) {
    if (this.mode && this.mode === 'publisher') throw new Error('Already marked as a publisher.')

    const channelWrapper = await this.createChannel()
    return channelWrapper.addSetup(async channel => {
      for (let i = 0; i !== this.numConsumerQueues; i++) {
        const queueName = `${routingKey}-${i}`
        await channel.consume(queueName, async () => {
          return processor()
        })
      }
    })
  }

  /**
   * Publish a message. Marks this class as being in publish mode.
   *
   * @param {String} exchange exchange to publish on
   * @param {String} routingKey routing key to publish message with
   * @param {String} body body of the message
   */
  async publish (exchange = required(), routingKey = required(), body = required()) {
    if (this.mode && this.mode === 'consumer') throw new Error('Already marked as a consumer.')

    const channel = await this.createChannel(exchange, routingKey)
    channel.publish(exchange, routingKey, Buffer.from())
  }
}

module.exports = AMQP
