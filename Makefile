HAS_K3D := $(shell command -v k3d;)
HAS_DOCKER := $(shell command -v docker;)
PWD := $(shell pwd;)

.PHONY: check-k3d
check-k3d:
ifndef HAS_K3D
	@echo "Missing k3d"
	@exit 1
endif
	@true

.PHONY: check-docker
check-docker:
ifndef HAS_DOCKER
	@echo "Missing docker"
	@exit 1
endif
	@true

.PHONY: setup-env
setup-env:
	@$(PWD)/hack/setup-env.sh

.PHONY: setup-integration-tests
setup-integration-tests: check-docker check-k3d

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
	@echo " ==> Exporting Docker Images for k3d <=="
	@mkdir -p "$(PWD)/.images"
	docker save autoscaler:canary redis:alpine gcr.io/kubernetes-helm/tiller:v2.13.1 -o "$(PWD)/.images/images.tar"
	@echo " --> Creating local kubernetes cluster"
	@docker-compose down >/dev/null 2>&1|| true 
	docker-compose up -d
	@echo " --> Waiting for Kubernetes (60s) "
	@sleep 60
	@echo " --> Setting up Kubernetes"
	@docker exec autoscaler_server_1 cat -- /output/kubeconfig.yaml > /tmp/kubeconfig.yaml
	KUBECONFIG="/tmp/kubeconfig.yaml" $(PWD)/hack/setup-k8s.sh
	@echo " --> Waiting for services to be up (20s)"
	@sleep 20
	KUBECONFIG="/tmp/kubeconfig.yaml" "$(PWD)/hack/setup-local.sh" &
	sleep 3
	KUBECONFIG="/tmp/kubeconfig.yaml" yarn test-integration