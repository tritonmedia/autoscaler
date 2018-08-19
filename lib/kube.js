/**
 * Kubernetes Code
 *
 * @author Jared Allard <jaredallard@outlook.com>
 * @version 1
 * @license MIT
 */

const Client = require('kubernetes-client').Client
const kconfig = require('kubernetes-client').config
const path = require('path')
const logger = require('pino')({
  name: path.basename(__filename)
})

/**
 * Start listening
 *
 * @param {Object} conf triton config
 */
module.exports = async conf => {
  let config
  if (process.env.KUBERNETES) {
    config = kconfig.getInCluster()
  } else {
    config = kconfig.fromKubeconfig()
  }

  const client = new Client({
    config
  })

  await client.loadSpec()

  logger.info('successfully loaded spec from kubernetes cluster')

  return {
    /**
     * Scale up a deployment
     *
     * @param {String} deploymentName deployment to scale up
     */
    scaleUp: async function (deploymentName) {
      const child = logger.child({
        deployment: deploymentName
      })

      child.info('scale up')

      const replicas = await this.getReplicas(deploymentName)

      await client.apis.apps.v1.namespaces('default').deployment(deploymentName).patch({
        body: {
          spec: {
            replicas: replicas + 1
          }
        }
      })
    },

    /**
     * Get the # of replicas a deployment has
     *
     * @param {String} deploymentName deployment to get
     * @returns {Number} of replicas it has
     */
    getReplicas: async function (deploymentName) {
      const child = logger.child({
        deployment: deploymentName
      })

      const deployment = await client.apis.apps.v1.namespaces('default').deployments(deploymentName).get()
      const { replicas } = deployment.body.spec
      child.debug('has', replicas)

      return replicas
    },

    /**
     * Scale down a deployment
     *
     * @param {String} deploymentName
     */
    scaleDown: async function (deploymentName) {
      logger.info('scale down', deploymentName)

      const replicas = this.getReplicas(deploymentName)
      await client.apis.apps.v1.namespaces('default').deployment(deploymentName).patch({
        body: {
          spec: {
            replicas: replicas - 1
          }
        }
      })
    }
  }
}
