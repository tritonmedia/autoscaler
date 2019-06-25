const AMQP = require('triton-core/amqp')
const dyn = require('triton-core/dynamics')
const proto = require('triton-core/proto')

const a = new AMQP(dyn('rabbitmq'))

const wait = async(ms = 1000) => {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

const init = async () => {
  await a.connect()

  const convert = await proto.load('api.Convert')

  const payload = {
    createdAt: new Date().toISOString(),
    media: {
      id: '123',
      name: 'Awesome Media',
      creator: 0,
      creatorId: 'trello-id',
      type: 0,
      source: 0,
      sourceURI: 'http://hello.com/hello.mp4'
    }
  }

  const encoded = proto.encode(convert, payload)

  for (let i = 0; i !== 100000; i++) {
    await a.publish('v1.media', encoded)
  }
  a.close()
  process.exit(0)
}

init()
