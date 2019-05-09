# autoscaler

`autoscaler` watches over Kue queue and scales k8s deployments off of pending jobs.

## Installation

See [charts/autoscaler](https://github.com/tritonmedia/charts).

Create the CRD and use the example `AutoScalerWatchers`:

```bash
$ kubectl create -f ./deploy
customresourcedefinition.apiextensions.k8s.io/autoscalerwatchers.tritonjs.com created
autoscalerwatcher.tritonjs.com/triton-downloader created
autoscalerwatcher.tritonjs.com/triton-converter created
```

If you're running the rest of the triton platform, it will now automatically scale converter
and downloader instances when jobs are available in the queue!

## Design

The autoscaler reads configuration from Kubernetes via the form of a [CRD (Custom Resource Definition)](https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/). This is used to configure the autoscaler on runtime, and dynamically configure watchers.

### Watcher

A watcher is a configuration of a queue that the autoscaler should listen on, currently only [Kue](https://github.com/Automattic/kue) is supported, but RabbitMQ and/or other queue technologies may be added in the future in the form of a adapters. These watchers create and a execute code based on Jobs.

### Job

A Job is used to tell the autoscaler what to do. These jobs are different from normal jobs because they, by default, are not active until a certain amount of time has passed and conditions are true for that entire time. (`promote_after_minutes`, and `timeout_seconds`). After `promote_after_minutes` passes, and `timeout_seconds` was never violated on `updated_at`, the job is automatically promoted to ready and the autoscaler then executes the operation.

### Operation

Operations are what the autoscaler does when a Job is ready. Currently only two operations are supported: `scaleUp` and `scaleDown`. These modify kubernetes resources accordingly.

## License

MIT
