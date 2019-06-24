const AMQP = require('triton-core/amqp')
const dyn = require('triton-core/dynamics')
const proto = require('triton-core/proto')

const a = new AMQP(dyn('rabbitmq'))

const init = async () => {
  const convert = await proto.load('api.Convert')

  await a.connect()
  await a.listen('v1.media', function(msg) {
    try {
      const content = proto.decode(convert, msg.message.content)
      console.log(content)
      msg.ack()
    } catch(err) {
      console.log('failed to read message', err)
    }
  })

  console.log('subscribed to v1.media')
}

process.on('SIGINT', () => {
  console.log('SIGINT')
  a.close()
})

init()
