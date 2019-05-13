#!/usr/bin/env bash
#
# Setups up a machine for integration tests

EXEC_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"

out() {
  echo " --> $*"
}

if [[ ! -e "$EXEC_DIR/.images" ]]; then
  mkdir "$EXEC_DIR/.images"
fi

if [[ ! -e "$EXEC_DIR/.images/airgap.tar" ]]; then
  out "Downloading airgap images"
  wget -O "$EXEC_DIR/.images/airgap.tar" https://github.com/rancher/k3s/releases/download/v0.5.0/k3s-airgap-images-amd64.tar
fi