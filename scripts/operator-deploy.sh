#!/bin/bash
# =============================================================================
# AI Observability Summarizer Operator - Deployment Script
# =============================================================================
# Usage:
#   ./operator-deploy.sh [command]
#
# Commands:
#   build      - Build operator, bundle, and catalog images
#   push       - Push all images to registry
#   deploy     - Deploy catalog source and install operator
#   cleanup    - Remove all operator resources
#   reinstall  - Cleanup and redeploy (full refresh)
#   status     - Check operator status
# =============================================================================

set -e

# Configuration
VERSION="${VERSION:-0.0.1}"
REGISTRY="${REGISTRY:-quay.io/ecosystem-appeng}"
OPERATOR_IMG="${REGISTRY}/aiobs-operator:v${VERSION}"
BUNDLE_IMG="${REGISTRY}/aiobs-operator-bundle:v${VERSION}"
CATALOG_IMG="${REGISTRY}/aiobs-operator-catalog:v${VERSION}"
OPERATOR_NAMESPACE="${OPERATOR_NAMESPACE:-ai-observability}"  # Recommended namespace
CATALOG_NAMESPACE="${CATALOG_NAMESPACE:-openshift-marketplace}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPERATOR_DIR="${SCRIPT_DIR}/../deploy/operator"
HELM_DIR="${SCRIPT_DIR}/../deploy/helm"

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# =============================================================================
# Helm Dependency Functions
# =============================================================================

update_helm_dependencies() {
    log_info "Updating Helm chart dependencies..."
    
    # Clean cached charts to ensure fresh build
    log_info "Cleaning cached charts..."
    rm -rf "${HELM_DIR}/aiobs-stack/charts/"* 2>/dev/null || true
    rm -f "${HELM_DIR}/aiobs-stack/Chart.lock" 2>/dev/null || true
    rm -rf "${HELM_DIR}/rag/charts/"* 2>/dev/null || true
    rm -f "${HELM_DIR}/rag/Chart.lock" 2>/dev/null || true
    
    # Update rag dependencies (includes llm-service, llama-stack, pgvector)
    log_info "Updating rag dependencies..."
    cd "${HELM_DIR}/rag"
    helm dependency update
    
    # Update aiobs-stack dependencies (umbrella chart)
    log_info "Updating aiobs-stack dependencies..."
    cd "${HELM_DIR}/aiobs-stack"
    helm dependency update
    
    log_info "Helm dependencies updated successfully!"
}

# =============================================================================
# Build Functions
# =============================================================================

prepare_helm_charts() {
    log_info "Preparing helm charts for operator build..."
    cd "${OPERATOR_DIR}"
    # Remove old helm-charts and copy fresh from deploy/helm
    rm -rf helm-charts
    cp -rL ../helm helm-charts
    log_info "Helm charts prepared!"
}

build_operator() {
    log_info "Building operator image: ${OPERATOR_IMG}"
    cd "${OPERATOR_DIR}"
    # Ensure helm-charts directory is fresh
    prepare_helm_charts
    make docker-build IMG="${OPERATOR_IMG}"
}

regenerate_bundle() {
    log_info "Regenerating bundle manifests..."
    cd "${OPERATOR_DIR}"
    make bundle
}

build_bundle() {
    log_info "Building bundle image: ${BUNDLE_IMG}"
    cd "${OPERATOR_DIR}"
    # Regenerate bundle manifests to pick up config changes
    make bundle
    make bundle-build BUNDLE_IMG="${BUNDLE_IMG}"
}

build_catalog() {
    log_info "Building catalog image: ${CATALOG_IMG}"
    cd "${OPERATOR_DIR}"
    make catalog-build CATALOG_IMG="${CATALOG_IMG}"
}

build_all() {
    log_info "Building all images..."
    update_helm_dependencies
    build_operator
    build_bundle
    build_catalog
    log_info "All images built successfully!"
}

# =============================================================================
# Push Functions
# =============================================================================

push_operator() {
    log_info "Pushing operator image: ${OPERATOR_IMG}"
    cd "${OPERATOR_DIR}"
    make docker-push IMG="${OPERATOR_IMG}"
}

push_bundle() {
    log_info "Pushing bundle image: ${BUNDLE_IMG}"
    cd "${OPERATOR_DIR}"
    make bundle-push BUNDLE_IMG="${BUNDLE_IMG}"
}

push_catalog() {
    log_info "Pushing catalog image: ${CATALOG_IMG}"
    cd "${OPERATOR_DIR}"
    make catalog-push CATALOG_IMG="${CATALOG_IMG}"
}

push_all() {
    log_info "Pushing all images..."
    push_operator
    push_bundle
    push_catalog
    log_info "All images pushed successfully!"
}

# =============================================================================
# Cleanup Functions
# =============================================================================

cleanup_operator() {
    log_info "Cleaning up operator resources..."
    
    # Delete subscription
    log_info "Deleting subscription..."
    oc delete subscription aiobs-operator -n "${OPERATOR_NAMESPACE}" --ignore-not-found 2>/dev/null || true
    
    # Delete CSV in operator namespace
    log_info "Deleting CSV in ${OPERATOR_NAMESPACE}..."
    oc delete csv aiobs-operator.v${VERSION} -n "${OPERATOR_NAMESPACE}" --ignore-not-found 2>/dev/null || true
    
    # Delete CSVs in all namespaces (for AllNamespaces mode)
    log_info "Deleting CSVs in all namespaces..."
    for ns in $(oc get csv -A -o jsonpath='{range .items[?(@.metadata.name=="aiobs-operator.v'"${VERSION}"'")]}{.metadata.namespace}{"\n"}{end}' 2>/dev/null); do
        oc delete csv "aiobs-operator.v${VERSION}" -n "$ns" --ignore-not-found 2>/dev/null &
    done
    wait
    
    # Delete operator deployment
    log_info "Deleting operator deployment..."
    oc delete deployment aiobs-operator-controller-manager -n "${OPERATOR_NAMESPACE}" --ignore-not-found 2>/dev/null || true
    
    # Delete install plans
    log_info "Deleting install plans..."
    oc delete installplan -n "${OPERATOR_NAMESPACE}" -l "operators.coreos.com/aiobs-operator.${OPERATOR_NAMESPACE}" --ignore-not-found 2>/dev/null || true
    
    # Wait for cleanup
    sleep 5
    
    log_info "Operator cleanup complete!"
}

cleanup_catalog() {
    log_info "Deleting catalog source..."
    oc delete catalogsource aiobs-operator-catalog -n "${CATALOG_NAMESPACE}" --ignore-not-found 2>/dev/null || true
    sleep 3
    log_info "Catalog cleanup complete!"
}

cleanup_all() {
    cleanup_operator
    cleanup_catalog
    log_info "Full cleanup complete!"
}

# =============================================================================
# Deploy Functions
# =============================================================================

create_namespace() {
    log_info "Ensuring namespace ${OPERATOR_NAMESPACE} exists..."
    oc get namespace "${OPERATOR_NAMESPACE}" >/dev/null 2>&1 || \
        oc new-project "${OPERATOR_NAMESPACE}" --display-name="AI Observability" >/dev/null 2>&1 || \
        oc create namespace "${OPERATOR_NAMESPACE}" >/dev/null 2>&1
    log_info "Namespace ${OPERATOR_NAMESPACE} ready"
}

deploy_catalog() {
    log_info "Deploying catalog source..."
    
    # Use the catalog-source.yaml template with variable substitution
    local catalog_file="${SCRIPT_DIR}/../deploy/operator/catalog-source.yaml"
    if [[ -f "${catalog_file}" ]]; then
        sed -e "s|namespace: openshift-marketplace|namespace: ${CATALOG_NAMESPACE}|" \
            -e "s|image: quay.io/ecosystem-appeng/aiobs-operator-catalog:v0.0.1|image: ${CATALOG_IMG}|" \
            "${catalog_file}" | oc apply -f -
    else
        # Fallback to inline definition
        oc apply -f - <<EOF
apiVersion: operators.coreos.com/v1alpha1
kind: CatalogSource
metadata:
  name: aiobs-operator-catalog
  namespace: ${CATALOG_NAMESPACE}
spec:
  sourceType: grpc
  image: ${CATALOG_IMG}
  displayName: AI Observability Operator
  publisher: RH AI Quickstart
  priority: -500
  updateStrategy:
    registryPoll:
      interval: 10m
EOF
    fi

    log_info "Waiting for catalog to be ready..."
    sleep 15
    
    # Check catalog status
    local status=$(oc get catalogsource aiobs-operator-catalog -n "${CATALOG_NAMESPACE}" -o jsonpath='{.status.connectionState.lastObservedState}' 2>/dev/null)
    if [[ "${status}" == "READY" ]]; then
        log_info "Catalog is ready!"
    else
        log_warn "Catalog status: ${status} (may still be starting)"
    fi
}

deploy_operator() {
    log_info "Installing operator via subscription..."
    
    # Ensure namespace exists
    create_namespace
    
    # Create OperatorGroup for global (AllNamespaces) mode
    # Empty spec allows the operator to watch resources across all namespaces
    log_info "Ensuring OperatorGroup exists (global mode)..."
    oc get operatorgroup aiobs-operator-group -n "${OPERATOR_NAMESPACE}" >/dev/null 2>&1 || \
    oc apply -f - <<EOF
apiVersion: operators.coreos.com/v1
kind: OperatorGroup
metadata:
  name: aiobs-operator-group
  namespace: ${OPERATOR_NAMESPACE}
spec: {}
EOF
    
    oc apply -f - <<EOF
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: aiobs-operator
  namespace: ${OPERATOR_NAMESPACE}
spec:
  channel: alpha
  name: aiobs-operator
  source: aiobs-operator-catalog
  sourceNamespace: ${CATALOG_NAMESPACE}
  installPlanApproval: Automatic
EOF

    log_info "Waiting for operator to install..."
    sleep 20
    
    # Check CSV status
    local csv_status=$(oc get csv "aiobs-operator.v${VERSION}" -n "${OPERATOR_NAMESPACE}" -o jsonpath='{.status.phase}' 2>/dev/null)
    if [[ "${csv_status}" == "Succeeded" ]]; then
        log_info "Operator installed successfully!"
    else
        log_warn "CSV status: ${csv_status}"
    fi
}

deploy_all() {
    deploy_catalog
    deploy_operator
    log_info "Deployment complete!"
}

# =============================================================================
# Status Functions
# =============================================================================

check_status() {
    echo ""
    log_info "=== Catalog Source ==="
    oc get catalogsource aiobs-operator-catalog -n "${CATALOG_NAMESPACE}" 2>/dev/null || echo "Not found"
    
    echo ""
    log_info "=== Catalog Pod ==="
    oc get pods -n "${CATALOG_NAMESPACE}" -l olm.catalogSource=aiobs-operator-catalog 2>/dev/null || echo "Not found"
    
    echo ""
    log_info "=== Subscription ==="
    oc get subscription aiobs-operator -n "${OPERATOR_NAMESPACE}" 2>/dev/null || echo "Not found"
    
    echo ""
    log_info "=== CSV ==="
    oc get csv -n "${OPERATOR_NAMESPACE}" 2>/dev/null | grep -i aiobs || echo "Not found"
    
    echo ""
    log_info "=== Operator Pod ==="
    oc get pods -n "${OPERATOR_NAMESPACE}" 2>/dev/null | grep -i aiobs || echo "Not found"
    
    echo ""
    log_info "=== AIObservabilitySummarizer Instances ==="
    oc get aiobservabilitysummarizers -A 2>/dev/null || echo "None found"
}

# =============================================================================
# Main
# =============================================================================

usage() {
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  build         - Build operator, bundle, and catalog images (includes helm dep update)"
    echo "  push          - Push all images to registry"
    echo "  deploy        - Deploy catalog source and install operator"
    echo "  cleanup       - Remove all operator resources"
    echo "  reinstall     - Cleanup and redeploy (full refresh)"
    echo "  status        - Check operator status"
    echo "  build-push    - Build and push all images"
    echo "  full          - Build, push, and deploy"
    echo "  helm-update   - Update Helm chart dependencies only"
    echo ""
    echo "Environment Variables:"
    echo "  VERSION              - Operator version (default: 0.0.1)"
    echo "  REGISTRY             - Container registry (default: quay.io/ecosystem-appeng)"
    echo "  OPERATOR_NAMESPACE   - Namespace for operator (default: ai-observability)"
    echo ""
    echo "Examples:"
    echo "  $0 build-push        # Build and push all images"
    echo "  $0 reinstall         # Clean reinstall"
    echo "  VERSION=0.0.2 $0 full # Full deploy with custom version"
}

case "${1:-}" in
    build)
        build_all
        ;;
    push)
        push_all
        ;;
    build-push)
        build_all
        push_all
        ;;
    deploy)
        deploy_all
        ;;
    cleanup)
        cleanup_all
        ;;
    reinstall)
        cleanup_all
        sleep 5
        deploy_all
        check_status
        ;;
    full)
        build_all
        push_all
        cleanup_all
        sleep 5
        deploy_all
        check_status
        ;;
    status)
        check_status
        ;;
    helm-update)
        update_helm_dependencies
        ;;
    *)
        usage
        exit 1
        ;;
esac

