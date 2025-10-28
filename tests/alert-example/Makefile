# Makefile for building and pushing the alert-example image to quay.io

REGISTRY ?= quay.io
ORG ?= jianrzha
IMAGE ?= alert-example
TAG ?= 0.1.0

IMG ?= $(REGISTRY)/$(ORG)/$(IMAGE):$(TAG)

DOCKER ?= podman
PLATFORM ?= linux/amd64
CONTEXT ?= ./app
KUBECTL ?= kubectl
NAMESPACE ?= default
K8S_DIR ?= ./k8s
KORREL8R_NS ?= korrel8r

.PHONY: help build push publish print-image deploy-app deploy-alert deploy set-image print-route deploy-korrel8r patch-configmap

help:
	@echo "Usage:"
	@echo "  make build           Build image $(IMG)"
	@echo "  make push            Push image $(IMG)"
	@echo "  make publish         Build and push"
	@echo "  make deploy-app      Apply ConfigMap, Deployment, Service to $(NAMESPACE)"
	@echo "  make set-image       Set deployment image to $(IMG) in $(NAMESPACE)"
	@echo "  make deploy-alert    Apply PrometheusRule to $(NAMESPACE)"
	@echo "  make deploy-korrel8r Deploy Korrel8r CR, RBAC, and config to $(KORREL8R_NS)"
	@echo "  make patch-configmap Patch the app ConfigMap using k8s/configmap_patch.yaml"
	@echo "  make print-route     Print the OpenShift Route URL"
	@echo "  make deploy          Deploy app and alert"
	@echo "Variables (override with VAR=value):"
	@echo "  REGISTRY=$(REGISTRY) ORG=$(ORG) IMAGE=$(IMAGE) TAG=$(TAG) PLATFORM=$(PLATFORM) NAMESPACE=$(NAMESPACE) KORREL8R_NS=$(KORREL8R_NS)"

print-image:
	@echo $(IMG)

build:
	$(DOCKER) build --platform=$(PLATFORM) -t $(IMG) $(CONTEXT)
push:
	$(DOCKER) push $(IMG)

publish: build push

deploy-app:
	$(KUBECTL) apply -n $(NAMESPACE) -f $(K8S_DIR)/configmap.yaml
	$(KUBECTL) apply -n $(NAMESPACE) -f $(K8S_DIR)/deployment.yaml
	$(KUBECTL) apply -n $(NAMESPACE) -f $(K8S_DIR)/service.yaml
	$(KUBECTL) apply -n $(NAMESPACE) -f $(K8S_DIR)/route.yaml
	$(MAKE) set-image
	$(KUBECTL) rollout status -n $(NAMESPACE) deployment/alert-example
	$(MAKE) print-route

set-image:
	$(KUBECTL) set image -n $(NAMESPACE) deployment/alert-example app=$(IMG) --record=true

deploy-alert:
	$(KUBECTL) apply -n $(NAMESPACE) -f $(K8S_DIR)/prometheusrule.yaml

deploy: deploy-app deploy-alert

print-route:
	@host=$$($(KUBECTL) get route alert-example -n $(NAMESPACE) -o jsonpath='{.spec.host}'); \
	if [ -n "$$host" ]; then \
		echo "Route URL: https://$$host"; \
	else \
		echo "Route not found in namespace $(NAMESPACE)"; \
	fi

patch-configmap:
	$(KUBECTL) apply -n $(NAMESPACE) -f $(K8S_DIR)/configmap_patch.yaml


