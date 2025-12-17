#!/bin/bash
# Enable cluster-level user workload monitoring for OpenShift
# This script configures the cluster-monitoring-config ConfigMap to enable
# user workload monitoring, which is required for Intel Gaudi metrics and
# custom application metrics collection.
#
# Prerequisites:
# - oc CLI logged in to OpenShift cluster with cluster-admin privileges

# Source common utilities for colors and prerequisite checks
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Constants
readonly CM_NAME="cluster-monitoring-config"
readonly CM_NAMESPACE="openshift-monitoring"
readonly CONFIG_FILE="$SCRIPT_DIR/ocp_config/cluster-monitoring-config.yaml"

# Main function
main() {
    echo -e "${BLUE}→ Enabling cluster-level user workload monitoring...${NC}"
    echo ""

    # Step 1: Check prerequisites
    check_openshift_prerequisites
    check_file "$CONFIG_FILE" "Cluster monitoring config"

    # Step 2: Check if already enabled (idempotency)
    if is_user_workload_enabled; then
        echo -e "${GREEN}  ✅ User workload monitoring already enabled - skipping${NC}"
        echo ""
        return 0
    fi

    # Step 3: Enable user workload monitoring
    echo -e "${BLUE}  → Enabling user workload monitoring...${NC}"
    enable_user_workload || exit 1

    echo ""
    echo -e "${GREEN}✅ User workload monitoring enabled successfully!${NC}"
    echo ""
}

# Check if user workload monitoring is already enabled
is_user_workload_enabled() {
    # Get the config.yaml from the ConfigMap
    local config_yaml
    config_yaml=$(oc get configmap "$CM_NAME" -n "$CM_NAMESPACE" \
        -o jsonpath='{.data.config\.yaml}' 2>/dev/null)

    # If ConfigMap doesn't exist or is empty, user workload is not enabled
    if [ -z "$config_yaml" ] || [ "$config_yaml" = "null" ]; then
        [[ "$DEBUG" == "true" ]] && echo -e "${BLUE}  → ConfigMap not found or empty${NC}"
        return 1
    fi

    # Check if enableUserWorkload is set to true (simple grep check)
    if echo "$config_yaml" | grep -q "enableUserWorkload: true"; then
        return 0
    fi

    [[ "$DEBUG" == "true" ]] && echo -e "${BLUE}  → enableUserWorkload not found or not true${NC}"
    return 1
}

# Enable user workload monitoring by applying ConfigMap
enable_user_workload() {
    # Apply the ConfigMap from YAML file
    oc apply -f "$CONFIG_FILE" || {
        echo -e "${RED}❌ Failed to apply ConfigMap${NC}"
        return 1
    }

    echo -e "${GREEN}  ✅ ConfigMap updated with enableUserWorkload: true${NC}"
    return 0
}

# Run main function
main "$@"
