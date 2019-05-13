const assert = require('assert')
const Client = require('kubernetes-client').Client
const kconfig = require('kubernetes-client').config

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

/* eslint no-undef: 0 */
describe('Integration', () => {
  it('should scale up a deployment when a job is present', async () => {
    const client = await getClient()
  })
})
