const request = require('request-promise-native')
const _ = require('lodash')

const init = async () => {
  const bindings = await request({
    uri: 'http://triton-rabbitmq:15672/api/bindings',
    auth: {
      user: 'user',
      pass: 'bitnami'
    },
    json: true
  })

  const queues = _.filter(bindings, {
    source: 'v1.download'
  }).map(binding => {
    return binding.destination
  })

  console.log('exchange v1.download has', queues.length, 'queues')

  const knownQueuesHM = new Map()
  const knownQueues = await request({
    uri: 'http://triton-rabbitmq:15672/api/queues',
    auth: {
      user: 'user',
      pass: 'bitnami'
    },
    json: true
  })

  for (let queue of knownQueues) {
    knownQueuesHM.set(queue.name, queue)
  }

  let ready = 0
  for (let queue of queues) {
    const qobj = knownQueuesHM.get(queue)
    if (!qobj) continue
    ready += qobj.messages_ready
  }

  console.log('exchange v1.download has', ready, 'messages ready')
}

init()
