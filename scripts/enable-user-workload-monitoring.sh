#!/bin/bash
# Enable cluster-level user workload monitoring for OpenShift
# This script configures the cluster-monitoring-config ConfigMap to enable
# user workload monitoring, which is required for Intel Gaudi metrics and
# custom application metrics collection.
#
# Prerequisites:
# - oc CLI logged in to OpenShift cluster with cluster-admin privileges
# - yq CLI tool for YAML manipulation
# - jq CLI tool for JSON manipulation

# Source common utilities for colors and prerequisite checks
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Constants
readonly CM_NAME="cluster-monitoring-config"
readonly CM_NAMESPACE="openshift-monitoring"

# Main function
main() {
    echo -e "${BLUE}→ Enabling cluster-level user workload monitoring...${NC}"
    echo ""

    # Step 1: Check prerequisites
    check_openshift_prerequisites
    check_tool_exists "yq"
    check_tool_exists "jq"

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
    local config_yaml

    # Get the config.yaml from the ConfigMap
    config_yaml=$(oc get configmap "$CM_NAME" -n "$CM_NAMESPACE" \
        -o jsonpath='{.data.config\.yaml}' 2>/dev/null)

    # If ConfigMap doesn't exist or is empty, user workload is not enabled
    if [ -z "$config_yaml" ] || [ "$config_yaml" = "null" ]; then
        [[ "$DEBUG" == "true" ]] && echo -e "${BLUE}  → ConfigMap not found or empty${NC}"
        return 1
    fi

    # Parse the YAML to check enableUserWorkload setting
    local enabled
    enabled=$(echo "$config_yaml" | yq eval '.enableUserWorkload // false' -)

    if [ "$enabled" = "true" ]; then
        return 0
    fi

    [[ "$DEBUG" == "true" ]] && echo -e "${BLUE}  → enableUserWorkload is currently: ${enabled}${NC}"
    return 1
}

# Enable user workload monitoring by updating ConfigMap
enable_user_workload() {
    # Get existing config or use empty object
    local current_config
    current_config=$(oc get configmap "$CM_NAME" -n "$CM_NAMESPACE" \
        -o jsonpath='{.data.config\.yaml}' 2>/dev/null)

    # If empty or null, start with empty YAML object
    if [ -z "$current_config" ] || [ "$current_config" = "null" ]; then
        current_config="{}"
    fi

    # Add or update enableUserWorkload using yq
    local new_config
    new_config=$(echo "$current_config" | yq eval '.enableUserWorkload = true' -)

    # Check if ConfigMap exists
    if oc get configmap "$CM_NAME" -n "$CM_NAMESPACE" >/dev/null 2>&1; then
        # ConfigMap exists - patch it
        oc patch configmap "$CM_NAME" -n "$CM_NAMESPACE" \
            --type merge \
            -p "$(echo '{"data":{"config.yaml":""}}' | jq --arg config "$new_config" '.data."config.yaml" = $config')" \
            || {
                echo -e "${RED}❌ Failed to patch ConfigMap${NC}"
                return 1
            }
    else
        # ConfigMap doesn't exist - create it
        cat <<EOF | oc apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${CM_NAME}
  namespace: ${CM_NAMESPACE}
data:
  config.yaml: |
    enableUserWorkload: true
EOF
        if [ $? -ne 0 ]; then
            echo -e "${RED}❌ Failed to create ConfigMap${NC}"
            return 1
        fi
    fi

    echo -e "${GREEN}  ✅ ConfigMap updated with enableUserWorkload: true${NC}"
    return 0
}

# Run main function
main "$@"
