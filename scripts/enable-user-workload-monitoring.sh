#!/bin/bash
# Enable cluster-level user workload monitoring for OpenShift
# This script configures the cluster-monitoring-config ConfigMap to enable
# user workload monitoring, which is required for Intel Gaudi metrics and
# custom application metrics collection.
#
# Also enables Alertmanager for user workload monitoring to support alerting.
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
readonly UWM_CM_NAME="user-workload-monitoring-config"
readonly UWM_CM_NAMESPACE="openshift-user-workload-monitoring"

# Main function
main() {
    echo -e "${BLUE}→ Enabling cluster-level user workload monitoring...${NC}"
    echo ""

    # Step 1: Check prerequisites
    check_openshift_prerequisites
    check_file "$CONFIG_FILE" "Cluster monitoring config"
    check_tool_exists "yq"
    check_tool_exists "jq"

    # Step 2: Check if already enabled (idempotency)
    local uwm_already_enabled=false
    if is_user_workload_enabled; then
        echo -e "${GREEN}  ✅ User workload monitoring already enabled - skipping${NC}"
        uwm_already_enabled=true
    else
        # Step 3: Enable user workload monitoring
        echo -e "${BLUE}  → Enabling user workload monitoring...${NC}"
        enable_user_workload || exit 1
    fi

    # Step 4: Enable Alertmanager for user workload monitoring
    echo ""
    echo -e "${BLUE}→ Enabling Alertmanager for user workload monitoring...${NC}"
    if is_alertmanager_enabled; then
        echo -e "${GREEN}  ✅ Alertmanager already enabled - skipping${NC}"
    else
        echo -e "${BLUE}  → Enabling Alertmanager...${NC}"
        enable_alertmanager || exit 1
    fi

    echo ""
    if [ "$uwm_already_enabled" = true ]; then
        echo -e "${GREEN}✅ User workload monitoring configuration verified!${NC}"
    else
        echo -e "${GREEN}✅ User workload monitoring enabled successfully!${NC}"
    fi
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

# Check if Alertmanager is enabled for user workload monitoring
is_alertmanager_enabled() {
    # Get the config.yaml from the user-workload-monitoring-config ConfigMap
    local config_yaml
    config_yaml=$(oc get configmap "$UWM_CM_NAME" -n "$UWM_CM_NAMESPACE" \
        -o jsonpath='{.data.config\.yaml}' 2>/dev/null)

    # If ConfigMap doesn't exist or is empty, Alertmanager is not enabled
    if [ -z "$config_yaml" ] || [ "$config_yaml" = "null" ]; then
        [[ "$DEBUG" == "true" ]] && echo -e "${BLUE}  → ConfigMap not found or empty${NC}"
        return 1
    fi

    # Check if alertmanager.enabled is set to true
    if echo "$config_yaml" | yq eval '.alertmanager.enabled' - 2>/dev/null | grep -q "true"; then
        return 0
    fi

    [[ "$DEBUG" == "true" ]] && echo -e "${BLUE}  → alertmanager.enabled not found or not true${NC}"
    return 1
}

# Enable Alertmanager for user workload monitoring
enable_alertmanager() {
    # Ensure the namespace exists
    if ! oc get namespace "$UWM_CM_NAMESPACE" >/dev/null 2>&1; then
        echo -e "${BLUE}  → Creating namespace $UWM_CM_NAMESPACE...${NC}"
        oc create namespace "$UWM_CM_NAMESPACE" || {
            echo -e "${RED}❌ Failed to create namespace $UWM_CM_NAMESPACE${NC}"
            return 1
        }
    fi

    # Get current config or start with empty object
    local current_config
    current_config=$(oc get configmap "$UWM_CM_NAME" -n "$UWM_CM_NAMESPACE" \
        -o jsonpath='{.data.config\.yaml}' 2>/dev/null)

    if [ -z "$current_config" ]; then
        current_config="{}"
    fi

    # Use yq to enable Alertmanager
    local new_config
    new_config=$(echo "$current_config" | yq eval '. as $item ireduce ({}; . * $item) |
        .alertmanager = (.alertmanager // {}) |
        .alertmanager.enabled = true |
        .alertmanager.enableAlertmanagerConfig = true' -)

    # Patch or create the ConfigMap
    if oc get configmap "$UWM_CM_NAME" -n "$UWM_CM_NAMESPACE" >/dev/null 2>&1; then
        # ConfigMap exists, patch it
        oc patch configmap "$UWM_CM_NAME" -n "$UWM_CM_NAMESPACE" \
            --type merge \
            -p "$(echo '{"data":{"config.yaml":""}}' | jq --arg config "$new_config" '.data."config.yaml" = $config')" || {
            echo -e "${RED}❌ Failed to patch ConfigMap${NC}"
            return 1
        }
    else
        # ConfigMap doesn't exist, create it
        oc create configmap "$UWM_CM_NAME" -n "$UWM_CM_NAMESPACE" \
            --from-literal=config.yaml="$new_config" || {
            echo -e "${RED}❌ Failed to create ConfigMap${NC}"
            return 1
        }
    fi

    echo -e "${GREEN}  ✅ Alertmanager enabled for user workload monitoring${NC}"
    echo -e "${BLUE}  → alertmanager.enabled = true${NC}"
    echo -e "${BLUE}  → alertmanager.enableAlertmanagerConfig = true${NC}"
    return 0
}

# Run main function
main "$@"
