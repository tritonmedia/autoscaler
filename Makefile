HAS_DOCKER := $(shell command -v docker;)
HAS_DOCKER_COMPOSE := $(shell command -v docker-compose;)
HAS_YARN := $(shell command -v yarn;)
HAS_NODE := $(shell command -v node;)
HAS_KUBECTL := $(shell command -v kubectl;)
HAS_HELM := $(shell command -v helm;)
PWD := $(shell pwd;)

.PHONY: check-docker
check-docker:
ifndef HAS_DOCKER
	@echo "Missing docker"
	@exit 1
endif
	@true

.PHONY: check-kubectl
check-kubectl:
ifndef HAS_KUBECTL
	@echo "Missing kubectl"
	@exit 1
endif
	@true

.PHONY: check-node
check-node:
ifndef HAS_NODE
	@echo "Missing node"
	@exit 1
endif
	@true

.PHONY: check-helm
check-helm:
ifndef HAS_HELM
	@echo "Missing helm"
	@exit 1
endif
	@true

.PHONY: check-docker-compose
check-docker-compose:
ifndef HAS_DOCKER_COMPOSE
	@echo "Missing docker-compose"
	@exit 1
endif
	@true

.PHONY: check-yarn
check-yarn: check-node
ifndef HAS_YARN
	@echo "Missing yarn"
	@exit 1
endif
	@true

.PHONY: setup-env
setup-env:
	@$(PWD)/hack/setup-env.sh

.PHONY: setup-integration-tests
setup-integration-tests: check-docker check-docker-compose check-yarn check-kubectl check-helm

.PHONY: build-docker
build-docker: check-docker
	@echo ""
	@echo " ==> Building Docker Image <=="
	@echo ""
	@docker build -t autoscaler:canary -f .circleci/Dockerfile .

.PHONY: tests-integration
tests-integration: setup-integration-tests build-docker
	@echo ""
	@echo " ==> Running Integration Tests <=="
	@echo ""
	@echo " ==> Exporting Docker Images for kubernetes <=="
	@mkdir -p "$(PWD)/.images"
	@docker pull redis:alpine || echo "Failed to pull (redis) container image, optimistically assuming on local machine"
	@docker pull gcr.io/kubernetes-helm/tiller:v2.13.1 || echo "Failed to pull (helm) container image, optimistically assuming on local machine"
	docker save autoscaler:canary redis:alpine gcr.io/kubernetes-helm/tiller:v2.13.1 -o "$(PWD)/.images/images.tar"
	@echo " --> Creating local kubernetes cluster"
	@docker-compose down >/dev/null 2>&1|| true 
	docker-compose up -d
	@echo " --> Waiting for Kubernetes (60s) "
	@sleep 60
	@echo " --> Setting up Kubernetes"
	@$(PWD)/hack/get-kube-config.sh > /tmp/kubeconfig.yaml
	KUBECONFIG="/tmp/kubeconfig.yaml" $(PWD)/hack/setup-k8s.sh
	@echo " --> Waiting for services to be up (20s)"
	@sleep 20
	KUBECONFIG="/tmp/kubeconfig.yaml" "$(PWD)/hack/setup-local.sh" &
	sleep 3
	KUBECONFIG="/tmp/kubeconfig.yaml" yarn test-integration