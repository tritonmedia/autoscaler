#!/usr/bin/env bash
#
# For running stuff outside of the cluster

declare -a pids

echo "retrieving k8s services ..."
services=$(kubectl get service -ogo-template='{{ range .items }}{{ .metadata.name }},{{ index (index .spec.ports 0) "port" }}{{ " " }}{{ end }}')

echo "$services"

echo "creating port-forward(s) ..."
for service in ${services}; do
  serviceName=$(awk -F ',' '{ print $1 }' <<< "$service")
  servicePort=$(awk -F ',' '{ print $2 }' <<< "$service")

  # skip k8s
  if [[ "$serviceName" == "kubernetes" ]]; then
    continue
  fi

  echo " --> $serviceName:$servicePort -> 127.0.0.1:$servicePort"
  kubectl port-forward "deployment/$serviceName" "$servicePort" >/dev/null &
  pids+=($!)

  sleep 3
done

function cleanup() {
  for pid in ${pids[@]}; do
    kill $pid
  done
}

echo "done. Waiting for ^C"
trap cleanup INT

# i love
cat