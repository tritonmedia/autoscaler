const AMQP = require('../lib/amqp')
const protobuf = require('protobufjs')
const path = require('path')
const dyn = require('triton-core/dynamics')

const a = new AMQP('amqp://user:bitnami@localhost')

const loadProtobuf = async () => {
  const root = await protobuf.load(path.join(__dirname, '../protos/api/v1.convert.proto'))
  const convert = root.lookupType("api.Convert")
  return convert
}

const init = async () => {
  const convert = await loadProtobuf()

  await a.connect()
  await a.listen('v1.media', msg => {
    try {
      const engMsg = convert.decode(msg.message.content)
      const content = convert.toObject(engMsg, {
        enums: String,
        bytes: String,
        longs: String,
      })
      console.log(content)
      msg.ack()
    } catch(err) {
      logger.error('failed to read message')
      logger.error(err)
    }
  })

  console.log('subscribed to v1.media')
}

process.on('SIGINT', () => {
  console.log('SIGINT')
  a.close()
})

init()
