const assert = require('assert')
const Client = require('kubernetes-client').Client
const kconfig = require('kubernetes-client').config
const kue = require('kue')
const queue = kue.createQueue({
  redis: 'redis://127.0.0.1:6379'
})
const uuid = require('uuid/v4')

/**
 * Delete Kue Job
 * @param {Number} id id of the job
 */
const deleteJob = async id => {
  return new Promise((resolve, reject) => {
    kue.Job.remove(id, err => {
      if (err) return reject(err)
      return resolve()
    })
  })
}

/**
 * Cleanup state left by other integration tests.
 * @param {Client} client kubeneretes client
 * @returns {Promise} undefined
 */
const cleanup = async client => {
  return new Promise((resolve, reject) => {
    queue.inactive(async (err, ids) => {
      if (err) return reject(err)

      for (const id of ids) {
        await deleteJob(id)
      }

      await client.apis.apps.v1.namespaces('default').deployment('triton-converter').patch({
        body: {
          spec: {
            replicas: 0
          }
        }
      })

      return resolve()
    })
  })
}

/**
 * @type {Client}
 */
const getClient = async () => {
  let config
  if (process.env.KUBERNETES_SERVICE_PORT) {
    config = kconfig.getInCluster()
  } else {
    config = kconfig.fromKubeconfig()
  }

  const client = new Client({
    config
  })

  await client.loadSpec()
  return client
}

/**
 * Create a Queue Job
 * @param {String} queueName name of queue to publish job on
 * @returns {Promise} undefined
 */
const createJob = async queueName => {
  return new Promise((resolve, reject) => {
    queue.create(queueName, {
      id: uuid()
    }).save(err => {
      if (err) return reject(err)
      return resolve()
    })
  })
}

/**
 * Wait for x amount of time
 * @returns {Promise} undefined
 */
const wait = (ms = 1000) => {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

/* eslint no-undef: 0 */
describe('Integration', async () => {
  afterEach(async () => {
    const client = await getClient()
    return cleanup(client)
  })

  it('should scale up a deployment when a job is present after 10 minutes', async () => {
    const client = await getClient()
    await createJob('convert')

    // wait for five minutes
    await wait(300000)

    let deployment = await client.apis.apps.v1.namespaces('default').deployments('triton-converter').get()
    assert.strictEqual(deployment.body.spec.replicas, 0)

    // wait for 6 minutes to be safe
    await wait(360000)

    deployment = await client.apis.apps.v1.namespaces('default').deployments('triton-converter').get()
    assert.strictEqual(deployment.body.spec.replicas, 1)
  })
})
