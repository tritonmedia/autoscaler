#!/usr/bin/env bash

set -e

EXEC_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"

if [[ -z "$KUBECONFIG" ]]; then
  exit 1
fi

if [[ ! -e "$EXEC_DIR/.charts" ]]; then
  mkdir "$EXEC_DIR/.charts"
  git clone https://github.com/tritonmedia/charts "$EXEC_DIR/.charts/charts"
fi

echo " -> Installing tiller"
kubectl create serviceaccount -n kube-system tiller
kubectl create clusterrolebinding tiller-binding --clusterrole=cluster-admin --serviceaccount kube-system:tiller
helm init --service-account tiller --wait

tmp_install=$(mktemp)
cat > "$tmp_install" <<EOF
usePassword: false
image: redis:alpine
persistence: # don't persist jobs
  enabled: false
EOF

echo " -> Installing redis"
helm install --name media "$EXEC_DIR/.charts/charts/media-stack/charts/redis" -f "$tmp_install"
rm "$tmp_install"

echo " -> Deploying the autoscaler"
kubectl apply -f ./deploy/crd.yaml
kubectl apply -f ./test/integration/testdata/autoscalerwatcher.yaml
kubectl apply -f ./test/integration/testdata/deployment.yaml