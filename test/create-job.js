const AMQP = require('../lib/amqp')
const path = require('path')
const protobuf = require('protobufjs')

const a = new AMQP('amqp://user:bitnami@localhost')

const wait = async(ms = 1000) => {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

const loadProtobuf = async () => {
  const root = await protobuf.load(path.join(__dirname, '../protos/api/v1.convert.proto'))
  const convert = root.lookupType("api.Convert")
  return convert
}

const init = async () => {
  await a.connect()

  const convert = await loadProtobuf()

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

  const err = convert.verify(payload)
  if (err) throw err

  const msg = convert.create(payload)
  const encoded = convert.encode(msg).finish()

  for (let i = 0; i !== 100000; i++) {
    await a.publish('v1.media', encoded)
  }
  a.close()
  process.exit(0)
}

init()
