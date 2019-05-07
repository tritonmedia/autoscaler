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
const find = require('lodash.find')
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
  if (process.env.KUBERNETES_SERVICE_PORT) {
    logger.debug('loading kube-spec from in cluster')
    config = kconfig.getInCluster()
  } else {
    logger.debug('loading kube-spec from kube config')
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
     * Check if a deployment has any currently pending deployments, or any "unavailable"
     * instances. Unavailable instances are available to pick up Jobs in Triton
     *
     * @param {String} deploymentName deployment to check
     * @returns {Boolean} false if can't scale, true if can
     */
    canScale: async function (deploymentName) {
      const deployment = await client.apis.apps.v1.namespaces('default').deployments(deploymentName).get()
      const { conditions } = deployment.body.status
      const isAvailable = find(conditions, {
        type: 'Available'
      })

      if (!isAvailable || typeof isAvailable !== 'object') return true

      // if true, then allow it to scale up
      if (isAvailable.status) return true

      return false
    },

    /**
     * Scale down a deployment
     *
     * @param {String} deploymentName
     */
    scaleDown: async function (deploymentName) {
      logger.info('scale down', deploymentName)

      const replicas = await this.getReplicas(deploymentName)
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
