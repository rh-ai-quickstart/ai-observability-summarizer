#!/bin/bash

# OpenShift Operator Management Script
# Handles installation/uninstallation and checking of OpenShift operators
#
# Requirements:
# - python3 on PATH when installing into openshift-operators-redhat while an
#   OperatorGroup already exists (YAML is filtered to avoid duplicate OGs).

# Source common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Operator name constants
readonly OPERATOR_OBSERVABILITY="observability"
readonly OPERATOR_OBSERVABILITY_ALT="cluster-observability"
readonly OPERATOR_OTEL="otel"
readonly OPERATOR_OTEL_ALT="opentelemetry"
readonly OPERATOR_TEMPO="tempo"
readonly OPERATOR_LOGGING="logging"
readonly OPERATOR_LOGGING_ALT="cluster-logging"
readonly OPERATOR_LOKI="loki"
readonly OPERATOR_LOKI_ALT="loki-operator"

# Full operator names (subscription.namespace format)
readonly FULL_NAME_OBSERVABILITY="cluster-observability-operator.openshift-cluster-observability"
readonly FULL_NAME_OTEL="opentelemetry-product.openshift-opentelemetry-operator"
readonly FULL_NAME_TEMPO="tempo-product.openshift-tempo-operator"
readonly FULL_NAME_LOGGING="cluster-logging.openshift-logging"
readonly FULL_NAME_LOKI="loki-operator.openshift-operators-redhat"

# YAML file names
readonly YAML_OBSERVABILITY="cluster-observability.yaml"
readonly YAML_OTEL="opentelemetry.yaml"
readonly YAML_TEMPO="tempo.yaml"
readonly YAML_LOGGING="logging.yaml"
readonly YAML_LOKI="loki.yaml"

readonly OPERATOR_ACTION_CHECK="check"
readonly OPERATOR_ACTION_INSTALL="install"
readonly OPERATOR_ACTION_UNINSTALL="uninstall"

# Fully-qualified OLM resource names to avoid conflicts (e.g. ACM Subscription CRD)
readonly OLM_OPERATOR_RESOURCE="operators.operators.coreos.com"
readonly OLM_SUBSCRIPTION_RESOURCE="subscriptions.operators.coreos.com"
readonly OLM_INSTALLPLAN_RESOURCE="installplans.operators.coreos.com"
readonly OLM_CSV_RESOURCE="clusterserviceversions.operators.coreos.com"
readonly OLM_OPERATORGROUP_RESOURCE="operatorgroups.operators.coreos.com"

# Shared Red Hat OperatorHub namespace: multiple unrelated Subscriptions coexist here.
# Never run `operatorgroup --all` in this namespace — it breaks every operator installed there.
readonly SHARED_REDHAT_OPERATORS_NS="openshift-operators-redhat"

readonly OBSERVABILITY_CRDS="monitoring.rhobs perses.dev observability.openshift.io"
readonly OTEL_CRDS="opentelemetry.io"
readonly TEMPO_CRDS="tempo.grafana.com"
readonly LOGGING_CRDS="logging.openshift.io"
readonly LOKI_CRDS="loki.grafana.com"

# Function to display usage
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -c/-C OPERATOR_NAME          Check if operator is installed"
    echo "  -i/-I OPERATOR_NAME          Install operator (simple names supported)"
    echo "  -u/-U OPERATOR_NAME          Uninstall operator (simple names supported)"
    echo "  -f/-F YAML_FILE              YAML file for operator install/uninstall (optional)"
    echo "  -n/-N NAMESPACE              Namespace for operator install/uninstall (REQUIRED)"
    echo "  -d/-D                        Debug mode"
    echo "  -h, --help                   Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 -c observability              # Check Cluster Observability Operator"
    echo "  $0 -i observability -n openshift-cluster-observability-operator  # Install Cluster Observability Operator"
    echo "  $0 -u observability -n openshift-cluster-observability-operator  # Uninstall Cluster Observability Operator"
    echo "  $0 -i otel -n openshift-opentelemetry-operator  # Install OpenTelemetry Operator"
    echo "  $0 -u otel -n openshift-opentelemetry-operator  # Uninstall OpenTelemetry Operator"
    echo "  $0 -i tempo -n openshift-tempo-operator  # Install Tempo Operator"
    echo "  $0 -u tempo -n openshift-tempo-operator  # Uninstall Tempo Operator"
    echo "  $0 -i tempo -n custom-namespace  # Install Tempo Operator in custom namespace"
    echo "  $0 -u tempo -n custom-namespace  # Uninstall Tempo Operator in custom namespace"
    echo "  $0 -i custom-operator -n custom-namespace -f custom.yaml  # Install with custom YAML in custom namespace"
    echo "  $0 -u custom-operator -n custom-namespace -f custom.yaml  # Uninstall with custom YAML in custom namespace"
    echo ""
    echo "Available operators (simple names):"
    echo "  observability - Cluster Observability Operator"
    echo "  otel          - Red Hat build of OpenTelemetry Operator"
    echo "  tempo         - Tempo Operator"
    echo "  logging       - Red Hat OpenShift Logging Operator"
    echo "  loki          - Loki Operator"
}

# Function to parse command line arguments
parse_args() {
    # Check if no arguments provided
    if [ $# -eq 0 ]; then
        usage
        exit 2
    fi

    # Initialize variables
    local OPERATOR_NAME=""
    local OPERATOR_FULL_NAME=""
    local YAML_FILE=""
    local ACTION=""
    local NAMESPACE=""

    # Parse standard arguments using getopts
    while getopts "c:C:i:I:u:U:f:F:n:N:dD:hH" opt; do
        case $opt in
            c|C) ACTION="$OPERATOR_ACTION_CHECK"
                 OPERATOR_NAME="$OPTARG"
                 OPERATOR_FULL_NAME=$(get_operator_full_name "$OPERATOR_NAME") || exit 1
                 ;;
            i|I) ACTION="$OPERATOR_ACTION_INSTALL"
                 OPERATOR_NAME="$OPTARG"
                 ;;
            u|U) ACTION="$OPERATOR_ACTION_UNINSTALL"
                 OPERATOR_NAME="$OPTARG"
                 ;;
            f|F) YAML_FILE="$OPTARG"
                 ;;
            n|N) NAMESPACE="$OPTARG"
                 ;;
            d|D) DEBUG="true"
                 ;;
            h|H) usage
               exit 0
               ;;
        esac
    done

    # Validate arguments
    if [ -z "$ACTION" ]; then
        echo -e "${RED}❌ No action specified. Please use -c to check or -i to install${NC}"
        usage
        exit 1
    fi

    if [ -z "$OPERATOR_NAME" ]; then
        echo -e "${RED}❌ Operator name is required${NC}"
        usage
        exit 1
    fi


    # Determine operator details if YAML file not provided
    if [ -z "$YAML_FILE" ]; then
        [[ "$DEBUG" == "true" ]] && echo -e "${BLUE} **** 📋 Auto-detecting operator and YAML file for: $OPERATOR_NAME${NC}"
        OPERATOR_NAME=$(get_operator_full_name "$OPERATOR_NAME") || exit 1
        YAML_FILE=$(get_operator_yaml "$OPERATOR_NAME") || exit 1
        [[ "$DEBUG" == "true" ]] && echo -e "${BLUE}📋 Auto-detected operator: $OPERATOR_NAME${NC}"
        [[ "$DEBUG" == "true" ]] && echo -e "${BLUE}📋 Auto-detected YAML file: $YAML_FILE${NC}"
    fi

    # Check if operator is installed (pass NAMESPACE if available from -n flag)
    local is_installed=false
    check_operator "$OPERATOR_NAME" "$NAMESPACE" && is_installed=true

    # Execute check/install/uninstall action based on operator status
    case "$ACTION" in
        "$OPERATOR_ACTION_CHECK")
            if [ "$is_installed" = true ]; then
              if [ "$DEBUG" == "true" ]; then
                echo -e "${GREEN}✅ Operator $OPERATOR_NAME is installed${NC}"
              else
                echo -e "${GREEN}✅ Installed${NC}"
              fi
            else
              if [ "$DEBUG" == "true" ]; then
                echo -e "${RED}❌ Operator $OPERATOR_NAME is not installed${NC}"
              else
                echo -e "${RED}❌ Not installed${NC}"
              fi
            fi
            exit 0
            ;;
        "$OPERATOR_ACTION_INSTALL")
            validate_namespace "$OPERATOR_ACTION_INSTALL"
            if [ "$is_installed" = true ]; then
                echo -e "${GREEN}✅ $OPERATOR_NAME already installed${NC}"
                exit 0
            fi
            install_operator "$OPERATOR_NAME" "$YAML_FILE" "$NAMESPACE"
            ;;
        "$OPERATOR_ACTION_UNINSTALL")
            validate_namespace "$OPERATOR_ACTION_UNINSTALL"
            # For uninstall, check if a Subscription exists — don't require CSV Succeeded.
            # check_operator() requires CSV Succeeded phase, which is too strict for uninstall:
            # if a Subscription exists but OLM couldn't resolve it (e.g., channel removed from
            # catalog), check_operator() returns false and uninstall skips the operator entirely,
            # leaving orphaned Subscriptions and OperatorGroups that cause deadlocks on reinstall.
            local sub_info=$(get_subscription_info "$OPERATOR_NAME")
            local unsub_name="${sub_info%%:*}"
            local unsub_ns="${NAMESPACE:-${sub_info##*:}}"
            local has_subscription=false
            if [ -n "$unsub_name" ] && oc get "$OLM_SUBSCRIPTION_RESOURCE" "$unsub_name" -n "$unsub_ns" >/dev/null 2>&1; then
                has_subscription=true
            fi
            if [ "$is_installed" = false ] && [ "$has_subscription" = false ]; then
                echo -e "${YELLOW}⚠️  Operator $OPERATOR_NAME is not installed${NC}"
                exit 0
            fi
            uninstall_operator "$OPERATOR_NAME" "$YAML_FILE" "$NAMESPACE"
            ;;
    esac
}

# Function to validate namespace for install/uninstall operations
validate_namespace() {
    local action="$1"

    if [ -z "$NAMESPACE" ]; then
        echo -e "${RED}❌ Namespace is required for install/uninstall operations${NC}"
        echo -e "${YELLOW}   Please specify namespace with -n NAMESPACE${NC}"
        # usage
        exit 1
    fi

    if [ "$action" = "$OPERATOR_ACTION_INSTALL" ]; then
        # For install: namespace will be created by the YAML if it doesn't exist
        [[ "$DEBUG" == "true" ]] && echo -e "${BLUE}  📋 Installing in namespace: $NAMESPACE${NC}"
    elif [ "$action" = "$OPERATOR_ACTION_UNINSTALL" ]; then
        # For uninstall: namespace must exist
        if ! oc get namespace "$NAMESPACE" >/dev/null 2>&1; then
            echo -e "${RED}❌ Namespace '$NAMESPACE' does not exist${NC}"
            echo -e "${YELLOW}   Cannot uninstall from non-existent namespace${NC}"
            exit 1
        else
            [[ "$DEBUG" == "true" ]] && echo -e "${BLUE}  📋 Using namespace: $NAMESPACE${NC}"
        fi
    fi
}

# Function to get subscription name and namespace from operator full name.
# Note: OLM operator resource names do NOT always match "subscription.namespace" format.
# E.g., the OLM resource is "cluster-observability-operator.openshift-cluster-observability"
# but the actual namespace is "openshift-cluster-observability-operator".
get_subscription_info() {
    local operator_name="$1"
    case "$operator_name" in
        "$FULL_NAME_OBSERVABILITY")
            echo "cluster-observability-operator:openshift-cluster-observability-operator"
            ;;
        "$FULL_NAME_OTEL")
            echo "opentelemetry-product:openshift-opentelemetry-operator"
            ;;
        "$FULL_NAME_TEMPO")
            echo "tempo-product:openshift-tempo-operator"
            ;;
        "$FULL_NAME_LOGGING")
            echo "cluster-logging:openshift-logging"
            ;;
        "$FULL_NAME_LOKI")
            echo "loki-operator:openshift-operators-redhat"
            ;;
        *)
            echo ""
            ;;
    esac
}

# Function to check if an operator is actively installed.
# Uses Subscription presence (+ CSV Succeeded phase) rather than the OLM `operator`
# resource, because `operator` resources are phantom aggregation objects that persist
# as long as CRDs exist — even after a clean uninstall. Checking them causes false
# positives ("already installed") and blocks reinstall.
#
# Args:
#   $1 - Full operator name (e.g., "cluster-logging.openshift-logging")
#   $2 - (optional) Namespace override. If not provided, uses get_subscription_info().
check_operator() {
    local operator_name="$1"
    local ns_override="${2:-}"
    [[ "$DEBUG" == "true" ]] && echo -e "${BLUE}📋 Checking operator: $operator_name${NC}"

    # Get subscription name and namespace
    local sub_info=$(get_subscription_info "$operator_name")
    local subscription_name=""
    local namespace=""
    if [ -z "$sub_info" ]; then
        # Fallback: try to extract from operator name (format: subscription.namespace)
        namespace="${ns_override:-${operator_name##*.}}"
        subscription_name="${operator_name%%.*}"
    else
        subscription_name="${sub_info%%:*}"
        namespace="${ns_override:-${sub_info##*:}}"
    fi

    [[ "$DEBUG" == "true" ]] && echo -e "${BLUE}   → Looking for subscription '$subscription_name' in namespace '$namespace'${NC}"

    # Check if subscription exists
    if ! oc get "$OLM_SUBSCRIPTION_RESOURCE" "$subscription_name" -n "$namespace" >/dev/null 2>&1; then
        [[ "$DEBUG" == "true" ]] && echo -e "${BLUE}   → Subscription does not exist${NC}"
        return 1  # Subscription missing
    fi

    # Check if CSV exists and is in Succeeded phase
    local csv_name=$(oc get "$OLM_SUBSCRIPTION_RESOURCE" "$subscription_name" -n "$namespace" -o jsonpath='{.status.installedCSV}' 2>/dev/null)
    if [ -z "$csv_name" ] || [ "$csv_name" = "null" ]; then
        [[ "$DEBUG" == "true" ]] && echo -e "${BLUE}   → CSV not yet installed${NC}"
        return 1  # CSV not installed
    fi

    local csv_phase=$(oc get "$OLM_CSV_RESOURCE" "$csv_name" -n "$namespace" -o jsonpath='{.status.phase}' 2>/dev/null)
    if [ "$csv_phase" != "Succeeded" ]; then
        [[ "$DEBUG" == "true" ]] && echo -e "${BLUE}   → CSV phase is '$csv_phase' (expected 'Succeeded')${NC}"
        return 1  # CSV not ready
    fi

    [[ "$DEBUG" == "true" ]] && echo -e "${BLUE}   → Operator fully installed (CSV: $csv_name, Phase: $csv_phase)${NC}"
    return 0  # Operator fully installed
}

# Function to get full operator name from simple name
get_operator_full_name() {
    local operator_name="$1"

    case "$operator_name" in
        "$OPERATOR_OBSERVABILITY"|"$OPERATOR_OBSERVABILITY_ALT"|"$FULL_NAME_OBSERVABILITY")
            echo "$FULL_NAME_OBSERVABILITY"
            ;;
        "$OPERATOR_OTEL"|"$OPERATOR_OTEL_ALT")
            echo "$FULL_NAME_OTEL"
            ;;
        "$OPERATOR_TEMPO"|"$FULL_NAME_TEMPO")
            echo "$FULL_NAME_TEMPO"
            ;;
        "$OPERATOR_LOGGING"|"$OPERATOR_LOGGING_ALT"|"$FULL_NAME_LOGGING")
            echo "$FULL_NAME_LOGGING"
            ;;
        "$OPERATOR_LOKI"|"$OPERATOR_LOKI_ALT"|"$FULL_NAME_LOKI")
            echo "$FULL_NAME_LOKI"
            ;;
        *)
            echo -e "${RED}❌ Unknown operator: $operator_name${NC}" >&2
            echo -e "${YELLOW}   Available operators: observability, otel, tempo, logging, loki${NC}" >&2
            exit 1
            ;;
    esac
}

# Function to get YAML file name from simple operator name
get_operator_yaml() {
    local operator_name="$1"

    case "$operator_name" in
        "$OPERATOR_OBSERVABILITY"|"$OPERATOR_OBSERVABILITY_ALT"|"$FULL_NAME_OBSERVABILITY")
            echo "$YAML_OBSERVABILITY"
            ;;
        "$OPERATOR_OTEL"|"$OPERATOR_OTEL_ALT"|"$FULL_NAME_OTEL")
            echo "$YAML_OTEL"
            ;;
        "$OPERATOR_TEMPO"|"$FULL_NAME_TEMPO")
            echo "$YAML_TEMPO"
            ;;
        "$OPERATOR_LOGGING"|"$OPERATOR_LOGGING_ALT"|"$FULL_NAME_LOGGING")
            echo "$YAML_LOGGING"
            ;;
        "$OPERATOR_LOKI"|"$OPERATOR_LOKI_ALT"|"$FULL_NAME_LOKI")
            echo "$YAML_LOKI"
            ;;
        *)
            echo -e "${RED}❌ Unknown operator: $operator_name${NC}" >&2
            echo -e "${YELLOW}   Available operators: observability, otel, tempo, logging, loki${NC}" >&2
            exit 1
            ;;
    esac
}

# Function to get full YAML path and validate it exists
get_yaml_path() {
    local yaml_file="$1"
    local yaml_path="$SCRIPT_DIR/operators/$yaml_file"

    if [ ! -f "$yaml_path" ]; then
        echo -e "${RED}❌ Error: YAML file not found: $yaml_path${NC}" >&2
        exit 1
    fi

    echo "$yaml_path"
}

# Function to get CRD patterns for an operator
get_operator_crds() {
    local operator_name="$1"

    case "$operator_name" in
        "$FULL_NAME_OBSERVABILITY")
            echo "$OBSERVABILITY_CRDS"
            ;;
        "$FULL_NAME_OTEL")
            echo "$OTEL_CRDS"
            ;;
        "$FULL_NAME_TEMPO")
            echo "$TEMPO_CRDS"
            ;;
        "$FULL_NAME_LOGGING")
            echo "$LOGGING_CRDS"
            ;;
        "$FULL_NAME_LOKI")
            echo "$LOKI_CRDS"
            ;;
        *)
            echo ""
            ;;
    esac
}

# Function to delete an operator
uninstall_operator() {
    local operator_name="$1"
    local yaml_file="$2"
    local namespace="$3"
    local yaml_path=$(get_yaml_path "$yaml_file")

    echo -e "${YELLOW}🗑️  Uninstalling $operator_name (using YAML file: $yaml_path)...${NC}"

    # Namespace validation is already done by validate_namespace function

    # Get the subscription name from YAML to find the specific CSV
    local subscription_name=$(grep -A2 "kind: Subscription" "$yaml_path" | grep "name:" | awk '{print $2}')
    echo -e "${BLUE}  📋 Found subscription: $subscription_name${NC}"

    # Get the CSV name from subscription status BEFORE deleting subscription
    # Example CSVs: cluster-observability-operator.v1.2.2, opentelemetry-operator.v0.135.0-1, tempo-operator.v0.18.0-1
    local csv_name=$(oc get "$OLM_SUBSCRIPTION_RESOURCE" "$subscription_name" -n "$namespace" -o jsonpath='{.status.installedCSV}' 2>/dev/null)

    echo -e "${BLUE}  📋 Step 1: Deleting Subscription (and OperatorGroup only in dedicated namespaces)...${NC}"
    echo -e "${BLUE}     → This prevents OLM from recreating the operator${NC}"
    if [ -z "$subscription_name" ]; then
        echo -e "${RED}❌ Could not parse Subscription metadata.name from $yaml_path${NC}"
        exit 1
    fi
    # Delete only this Subscription — never `subscription --all` in shared catalog namespaces.
    oc delete "$OLM_SUBSCRIPTION_RESOURCE" "$subscription_name" -n "$namespace" --ignore-not-found=true
    if [ "$namespace" = "$SHARED_REDHAT_OPERATORS_NS" ]; then
        echo -e "${YELLOW}     ⚠️  Namespace $namespace is shared by many Red Hat operators.${NC}"
        echo -e "${BLUE}     → Skipping OperatorGroup bulk delete (would remove other teams' operators).${NC}"
        # If multiple OperatorGroups exist (e.g. from a previous install that created a duplicate),
        # OLM deadlocks. Clean up duplicates, keeping only the oldest one.
        local og_count=$(oc get "$OLM_OPERATORGROUP_RESOURCE" -n "$namespace" --no-headers 2>/dev/null | wc -l | tr -d ' ')
        if [ "$og_count" -gt 1 ]; then
            echo -e "${YELLOW}     ⚠️  Found $og_count OperatorGroups in $namespace (expected 1). Cleaning up duplicates...${NC}"
            local oldest_og=$(oc get "$OLM_OPERATORGROUP_RESOURCE" -n "$namespace" --sort-by=.metadata.creationTimestamp -o name 2>/dev/null | head -1)
            for og in $(oc get "$OLM_OPERATORGROUP_RESOURCE" -n "$namespace" -o name 2>/dev/null); do
                if [ "$og" != "$oldest_og" ]; then
                    echo -e "${BLUE}     → Deleting duplicate: $og (keeping $oldest_og)${NC}"
                    oc delete "$og" -n "$namespace" --ignore-not-found=true 2>/dev/null ||:
                fi
            done
        fi
    else
        oc delete "$OLM_OPERATORGROUP_RESOURCE" --all -n "$namespace" --ignore-not-found=true
    fi

    echo -e "${BLUE}  📋 Step 2: Deleting ClusterServiceVersion (CSV)...${NC}"
    if [ -n "$csv_name" ] && [ "$csv_name" != "null" ]; then
        echo -e "${BLUE}     → Deleting CSV: $csv_name${NC}"
        oc delete "$OLM_CSV_RESOURCE" "$csv_name" -n "$namespace" --ignore-not-found=true
    else
        echo -e "${YELLOW}     ⚠️  No CSV found for subscription $subscription_name${NC}"
        echo -e "${BLUE}     → You can manually delete CSVs by running:${NC}"
        echo -e "${BLUE}       oc delete $OLM_CSV_RESOURCE -n $namespace --all --ignore-not-found=true${NC}"
    fi

    # CRDs are intentionally NOT deleted during uninstall. This follows standard OLM
    # practice: CRD deletion is cascading (deletes all custom resources cluster-wide),
    # CRDs may be shared across operators, and keeping them preserves data for reinstall.
    # Previously, deleting CRDs here caused collateral damage — e.g., deleting
    # servicemonitors.monitoring.rhobs also resolved to servicemonitors.monitoring.coreos.com,
    # wiping GPU operator DCGM ServiceMonitors and all platform ServiceMonitors.

    echo -e "${BLUE}  📋 Step 3: Cleaning up operator resource: $operator_name${NC}"
    # Best-effort cleanup of the OLM operator resource. Since CRDs are preserved
    # (see comment above), OLM may regenerate this resource. This is harmless —
    # check_operator() uses Subscription presence, not the operator resource.
    oc delete "$OLM_OPERATOR_RESOURCE" "$operator_name" --ignore-not-found=true --wait=false 2>/dev/null || true

    echo -e "${GREEN}✅ $operator_name deletion completed!${NC}"
    echo -e "${BLUE}  ℹ️  Note: Namespace '$namespace' was preserved${NC}"
}

# Approve a pending InstallPlan for a Subscription when approval is Manual
approve_install_plan_if_manual() {
    local subscription_name="$1"
    local namespace="$2"

    # Ensure subscription exists before querying it
    local attempts=0
    local max_attempts=60  # up to 10 minutes
    while [ $attempts -lt $max_attempts ]; do
        if oc get "$OLM_SUBSCRIPTION_RESOURCE" "$subscription_name" -n "$namespace" >/dev/null 2>&1; then
            break
        fi
        attempts=$((attempts + 1))
        sleep 10
    done

    if ! oc get "$OLM_SUBSCRIPTION_RESOURCE" "$subscription_name" -n "$namespace" >/dev/null 2>&1; then
        echo -e "${YELLOW}  ⚠️  Subscription $subscription_name not found; skipping InstallPlan approval${NC}"
        return 0
    fi

    local approval
    approval=$(oc get "$OLM_SUBSCRIPTION_RESOURCE" "$subscription_name" -n "$namespace" -o jsonpath='{.spec.installPlanApproval}' 2>/dev/null || echo "")
    if [ "$(echo "$approval" | tr '[:upper:]' '[:lower:]')" != "manual" ]; then
        [[ "$DEBUG" == "true" ]] && echo -e "${BLUE}  📋 Install plan approval is '$approval' (not Manual); nothing to approve${NC}"
        return 0
    fi

    local target_csv
    target_csv=$(oc get "$OLM_SUBSCRIPTION_RESOURCE" "$subscription_name" -n "$namespace" -o jsonpath='{.spec.startingCSV}' 2>/dev/null || echo "")
    if [ -z "$target_csv" ] || [ "$target_csv" = "null" ]; then
        echo -e "${YELLOW}  ⚠️  Subscription has Manual approval but no startingCSV set; will approve first pending InstallPlan${NC}"
    else
        echo -e "${BLUE}  📋 Manual approval required; target CSV: ${target_csv}${NC}"
    fi

    # If the target CSV (or any newer version of the same package) is already Succeeded,
    # OLM will not create an InstallPlan. Skip the wait.
    # Retry a few times to handle brief OLM reconciliation delays after subscription creation.
    if [ -n "$target_csv" ] && [ "$target_csv" != "null" ]; then
        local existing_phase=""
        for _i in 1 2 3; do
            existing_phase=$(oc get "$OLM_CSV_RESOURCE" "$target_csv" -n "$namespace" \
                -o jsonpath='{.status.phase}' 2>/dev/null || echo "")
            if [ "$existing_phase" = "Succeeded" ]; then
                break
            fi
            # Also check if a newer version of the same package is already Succeeded.
            local csv_package="${target_csv%%.*}"
            local newer_csv
            newer_csv=$(oc get "$OLM_CSV_RESOURCE" -n "$namespace" --no-headers 2>/dev/null | \
                awk -v pkg="$csv_package" '$1 ~ "^"pkg"\\." && $NF == "Succeeded" {print $1}' | head -1)
            if [ -n "$newer_csv" ]; then
                existing_phase="Succeeded"
                target_csv="$newer_csv"
                break
            fi
            sleep 5
        done
        if [ "$existing_phase" = "Succeeded" ]; then
            echo -e "${GREEN}  ✅ CSV $target_csv already installed and Succeeded; no InstallPlan needed${NC}"
            return 0
        fi
    fi

    # Wait for the InstallPlan to be created and referenced by the Subscription
    attempts=0
    local installplan_name=""
    while [ $attempts -lt $max_attempts ]; do
        installplan_name=$(oc get "$OLM_SUBSCRIPTION_RESOURCE" "$subscription_name" -n "$namespace" \
            -o jsonpath='{.status.installplan.name}' 2>/dev/null)
        if [ -z "$installplan_name" ] || [ "$installplan_name" = "null" ]; then
            installplan_name=$(oc get "$OLM_SUBSCRIPTION_RESOURCE" "$subscription_name" -n "$namespace" \
                -o jsonpath='{.status.installPlanRef.name}' 2>/dev/null)
        fi

        if [ -n "$installplan_name" ] && [ "$installplan_name" != "null" ]; then
            break
        fi

        attempts=$((attempts + 1))
        echo -e "${BLUE}  ⏳ Waiting for InstallPlan to be created (attempt $attempts/$max_attempts)...${NC}"
        sleep 10
    done

    if [ -z "$installplan_name" ] || [ "$installplan_name" = "null" ]; then
        echo -e "${RED}  ❌ InstallPlan not found for subscription $subscription_name after waiting${NC}"
        return 1
    fi

    echo -e "${BLUE}  📋 Found InstallPlan: $installplan_name${NC}"

    # Validate the InstallPlan targets the desired CSV (if provided)
    if [ -n "$target_csv" ] && [ "$target_csv" != "null" ]; then
        local csv_list
        csv_list=$(oc get "$OLM_INSTALLPLAN_RESOURCE" "$installplan_name" -n "$namespace" -o jsonpath='{.spec.clusterServiceVersionNames[*]}' 2>/dev/null || echo "")
        if ! echo "$csv_list" | tr ' ' '\n' | grep -q "^${target_csv}\$"; then
            echo -e "${YELLOW}  ⚠️  InstallPlan does not include expected CSV '${target_csv}'. Planned CSV(s): ${csv_list}${NC}"
            echo -e "${YELLOW}  ⚠️  Skipping auto-approval to avoid unintended upgrades${NC}"
            return 1
        fi
    fi

    # Approve the InstallPlan
    echo -e "${BLUE}  ✍️  Approving InstallPlan: $installplan_name${NC}"
    oc patch "$OLM_INSTALLPLAN_RESOURCE" "$installplan_name" -n "$namespace" --type merge -p '{"spec":{"approved":true}}' >/dev/null

    # Optionally, wait briefly for the plan to move forward
    attempts=0
    while [ $attempts -lt 12 ]; do  # up to ~2 minutes
        local phase
        phase=$(oc get "$OLM_INSTALLPLAN_RESOURCE" "$installplan_name" -n "$namespace" -o jsonpath='{.status.phase}' 2>/dev/null || echo "")
        if [ "$phase" = "Complete" ]; then
            echo -e "${GREEN}  ✅ InstallPlan $installplan_name completed${NC}"
            break
        fi
        attempts=$((attempts + 1))
        sleep 10
    done
}

# Clean up stale OLM-managed dependency subscriptions for a package.
# When the aiobs operator is installed via OLM, it creates auto-dependency subscriptions
# (olm.managed=true) in openshift-operators. When the operator is uninstalled, OLM does
# NOT clean these up. If `make install` then tries to install the same package in a
# different namespace, OLM fails with "intersecting operatorgroups provide the same APIs".
# This function detects and removes those stale subscriptions before install.
cleanup_stale_operator_subscriptions() {
    local package_name="$1"
    local target_namespace="$2"

    [[ "$DEBUG" == "true" ]] && echo -e "${BLUE}  📋 Checking for stale subscriptions for package '$package_name' outside '$target_namespace'...${NC}"

    # Find subscriptions for the same package in other namespaces
    local stale_subs
    stale_subs=$(oc get "$OLM_SUBSCRIPTION_RESOURCE" -A -o json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
for item in data.get('items', []):
    ns = item['metadata']['namespace']
    name = item['metadata']['name']
    pkg = item.get('spec', {}).get('name', '')
    managed = item.get('metadata', {}).get('labels', {}).get('olm.managed', '')
    if pkg == '$package_name' and ns != '$target_namespace':
        print(f'{ns}/{name}/{managed}')
" 2>/dev/null)

    if [ -z "$stale_subs" ]; then
        [[ "$DEBUG" == "true" ]] && echo -e "${BLUE}  📋 No stale subscriptions found${NC}"
        return 0
    fi

    echo -e "${YELLOW}  ⚠️  Found stale subscription(s) for '$package_name' in other namespace(s):${NC}"
    while IFS='/' read -r sub_ns sub_name olm_managed; do
        echo -e "${BLUE}     → $sub_ns/$sub_name (olm.managed=$olm_managed)${NC}"

        # Get the installed CSV before deleting the subscription
        local stale_csv
        stale_csv=$(oc get "$OLM_SUBSCRIPTION_RESOURCE" "$sub_name" -n "$sub_ns" -o jsonpath='{.status.installedCSV}' 2>/dev/null)

        # Delete the stale subscription
        echo -e "${BLUE}     → Deleting stale Subscription: $sub_name in $sub_ns${NC}"
        oc delete "$OLM_SUBSCRIPTION_RESOURCE" "$sub_name" -n "$sub_ns" --ignore-not-found=true 2>/dev/null || true

        # Delete the associated CSV (in the stale namespace only)
        if [ -n "$stale_csv" ] && [ "$stale_csv" != "null" ]; then
            echo -e "${BLUE}     → Deleting stale CSV: $stale_csv in $sub_ns${NC}"
            oc delete "$OLM_CSV_RESOURCE" "$stale_csv" -n "$sub_ns" --ignore-not-found=true 2>/dev/null || true
        fi

        # Wait briefly for OLM to reconcile and remove Copied CSVs from other namespaces
        sleep 5
    done <<< "$stale_subs"

    # Also clean up any Copied CSVs for this package that linger in the target namespace
    # (OLM copies CSVs to all namespaces with matching OperatorGroups)
    local copied_csvs
    copied_csvs=$(oc get "$OLM_CSV_RESOURCE" -n "$target_namespace" -o json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
for item in data.get('items', []):
    name = item['metadata']['name']
    reason = item.get('status', {}).get('reason', '')
    if reason == 'Copied' and name.startswith('$package_name'):
        print(name)
" 2>/dev/null)

    if [ -n "$copied_csvs" ]; then
        while IFS= read -r csv_name; do
            echo -e "${BLUE}     → Deleting Copied CSV in target namespace: $csv_name${NC}"
            oc delete "$OLM_CSV_RESOURCE" "$csv_name" -n "$target_namespace" --ignore-not-found=true 2>/dev/null || true
        done <<< "$copied_csvs"
    fi

    echo -e "${GREEN}  ✅ Stale subscriptions cleaned up for '$package_name'${NC}"
}

# Function to install an operator
install_operator() {
    local operator_name="$1"
    local yaml_file="$2"
    local namespace="$3"
    echo -e "${BLUE}📦 → Installing $operator_name...${NC}"

    local yaml_path=$(get_yaml_path "$yaml_file")

    # Clean up stale OLM-managed subscriptions for the same package in other namespaces.
    # This handles the operator-to-make transition: aiobs operator creates auto-dependency
    # subscriptions that OLM doesn't clean up on uninstall.
    local package_name
    package_name=$(grep -A5 "kind: Subscription" "$yaml_path" | grep "^  name:" | head -1 | awk '{print $2}')
    if [ -n "$package_name" ]; then
        cleanup_stale_operator_subscriptions "$package_name" "$namespace"
    fi

    # Clean up a previous failed install attempt in the target namespace.
    # If a prior `make install` failed (e.g., due to stale OLM subscriptions), the
    # subscription and failed CSV may still exist. Delete them so `oc create` succeeds.
    local subscription_name_from_yaml
    subscription_name_from_yaml=$(grep -A2 "kind: Subscription" "$yaml_path" | grep "name:" | awk '{print $2}')
    if [ -n "$subscription_name_from_yaml" ] && oc get "$OLM_SUBSCRIPTION_RESOURCE" "$subscription_name_from_yaml" -n "$namespace" >/dev/null 2>&1; then
        local existing_csv
        existing_csv=$(oc get "$OLM_SUBSCRIPTION_RESOURCE" "$subscription_name_from_yaml" -n "$namespace" -o jsonpath='{.status.installedCSV}' 2>/dev/null)
        local existing_phase=""
        if [ -n "$existing_csv" ] && [ "$existing_csv" != "null" ]; then
            existing_phase=$(oc get "$OLM_CSV_RESOURCE" "$existing_csv" -n "$namespace" -o jsonpath='{.status.phase}' 2>/dev/null)
        fi
        if [ "$existing_phase" = "Failed" ] || [ "$existing_phase" = "" ]; then
            local cleanup_reason="phase: ${existing_phase:-no CSV}"
            echo -e "${YELLOW}  ⚠️  Found previous failed install ($cleanup_reason). Cleaning up...${NC}"
            oc delete "$OLM_SUBSCRIPTION_RESOURCE" "$subscription_name_from_yaml" -n "$namespace" --ignore-not-found=true 2>/dev/null || true
            if [ -n "$existing_csv" ] && [ "$existing_csv" != "null" ]; then
                oc delete "$OLM_CSV_RESOURCE" "$existing_csv" -n "$namespace" --ignore-not-found=true 2>/dev/null || true
            fi
            echo -e "${GREEN}  ✅ Previous failed install cleaned up${NC}"
        fi
    fi

    # Namespace creation is handled by validate_namespace function

    # Use envsubst to substitute the NAMESPACE variable
    # Note: We use 'oc create' instead of 'oc apply' because the YAML uses 'generateName' for OperatorGroup
    # which is only supported by 'create'. We add --save-config to enable future kubectl apply operations.
    # Suppress "AlreadyExists" errors for namespaces since uninstall preserves them by design.
    export NAMESPACE="$namespace"
    export CHANNEL="${CHANNEL:-stable}"
    export STARTING_CSV="${STARTING_CSV:-}"

    # If the target CSV (or any newer version of the same package) is already Succeeded
    # in this namespace (e.g. installed via an AllNamespaces subscription elsewhere),
    # skip creating a duplicate subscription.
    if [ -n "$STARTING_CSV" ]; then
        local csv_phase
        csv_phase=$(oc get "$OLM_CSV_RESOURCE" "$STARTING_CSV" -n "$namespace" \
            -o jsonpath='{.status.phase}' 2>/dev/null || echo "")
        if [ "$csv_phase" = "Succeeded" ]; then
            echo -e "${GREEN}✅ $operator_name already installed${NC}"
            return 0
        fi
        # The exact startingCSV may not be present if a newer version was installed.
        # Check if any Succeeded CSV for the same package exists in the namespace.
        local csv_package="${STARTING_CSV%%.*}"
        local newer_csv
        newer_csv=$(oc get "$OLM_CSV_RESOURCE" -n "$namespace" --no-headers 2>/dev/null | \
            awk -v pkg="$csv_package" '$1 ~ "^"pkg"\\." && $NF == "Succeeded" {print $1}' | head -1)
        if [ -n "$newer_csv" ]; then
            echo -e "${GREEN}✅ $operator_name already installed ($newer_csv)${NC}"
            return 0
        fi
    fi

    # Check if an OperatorGroup already exists in the target namespace. Multiple
    # OperatorGroups cause OLM to deadlock (no InstallPlans created). This can happen
    # when reinstalling after an uninstall that preserved the namespace, because the
    # YAML uses generateName which creates a new OperatorGroup on every `oc create`.
    # Strip the OperatorGroup document from the YAML if one already exists.
    local existing_og=$(oc get "$OLM_OPERATORGROUP_RESOURCE" -n "$namespace" -o name 2>/dev/null | head -1)
    if [ -n "$existing_og" ]; then
        echo -e "${BLUE}     → OperatorGroup already exists in $namespace ($existing_og). Skipping creation.${NC}"
        # python3: splits multi-doc YAML and drops OperatorGroup (see file header).
        envsubst '${NAMESPACE} ${CHANNEL} ${STARTING_CSV}' < "$yaml_path" | python3 -c "
import sys
docs = sys.stdin.read().split('---')
for doc in docs:
    if 'kind: OperatorGroup' not in doc and doc.strip():
        print('---')
        print(doc, end='')
" | oc create --save-config -f - 2>&1 | grep -v "namespaces.*already exists" || true
    else
        envsubst '${NAMESPACE} ${CHANNEL} ${STARTING_CSV}' < "$yaml_path" | oc create --save-config -f - 2>&1 | grep -v "namespaces.*already exists" || true
    fi

    echo -e "${GREEN}  ✅ $operator_name installation initiated${NC}"

    # Get the subscription name to manage InstallPlan approval if needed
    local subscription_name=$(grep -A2 "kind: Subscription" "$yaml_path" | grep "name:" | awk '{print $2}')

    # If approval is Manual, auto-approve InstallPlan for the startingCSV
    approve_install_plan_if_manual "$subscription_name" "$namespace" || true

    # Verify Subscription was created successfully (lightweight check — CSV phase
    # is verified separately in the next loop, so we only check Subscription existence here)
    echo -e "${BLUE}  ⏳ Verifying Subscription was created...${NC}"

    local max_attempts=60  # 10 minutes with 10-second intervals
    local attempt=0

    while [ $attempt -lt $max_attempts ]; do
        if oc get "$OLM_SUBSCRIPTION_RESOURCE" "$subscription_name" -n "$namespace" >/dev/null 2>&1; then
            echo -e "${GREEN}  ✅ Subscription confirmed${NC}"
            break
        fi

        attempt=$((attempt + 1))
        if [ $attempt -lt $max_attempts ]; then
            echo -e "${BLUE}  ⏳ Attempt $attempt/$max_attempts - waiting 10 seconds...${NC}"
            sleep 10
        fi
    done

    if [ $attempt -eq $max_attempts ]; then
        echo -e "${RED}  ❌ Subscription was not created after 10 minutes${NC}"
        exit 1
    fi

    # Wait for CSV to reach Succeeded phase
    echo -e "${BLUE}  ⏳ Waiting for CSV to reach Succeeded phase...${NC}"
    attempt=0
    max_attempts=60  # 10 minutes

    # Short-circuit: if the startingCSV is already Succeeded, OLM may not populate
    # status.installedCSV immediately — check the CSV directly first.
    local starting_csv
    starting_csv=$(oc get "$OLM_SUBSCRIPTION_RESOURCE" "$subscription_name" -n "$namespace" -o jsonpath='{.spec.startingCSV}' 2>/dev/null || echo "")
    if [ -n "$starting_csv" ] && [ "$starting_csv" != "null" ]; then
        local starting_phase
        starting_phase=$(oc get "$OLM_CSV_RESOURCE" "$starting_csv" -n "$namespace" -o jsonpath='{.status.phase}' 2>/dev/null || echo "")
        if [ "$starting_phase" = "Succeeded" ]; then
            echo -e "${GREEN}  ✅ CSV $starting_csv is in Succeeded phase${NC}"
            attempt=$max_attempts  # skip the loop
        fi
    fi

    while [ $attempt -lt $max_attempts ]; do
        local csv_phase=$(oc get "$OLM_SUBSCRIPTION_RESOURCE" "$subscription_name" -n "$namespace" -o jsonpath='{.status.installedCSV}' 2>/dev/null)
        if [ -n "$csv_phase" ] && [ "$csv_phase" != "null" ]; then
            local phase=$(oc get "$OLM_CSV_RESOURCE" "$csv_phase" -n "$namespace" -o jsonpath='{.status.phase}' 2>/dev/null)
            if [ "$phase" = "Succeeded" ]; then
                echo -e "${GREEN}  ✅ CSV $csv_phase is in Succeeded phase${NC}"
                break
            fi
            echo -e "${BLUE}  ⏳ CSV phase: $phase (attempt $attempt/$max_attempts)${NC}"
        else
            echo -e "${BLUE}  ⏳ Waiting for CSV to be created (attempt $attempt/$max_attempts)${NC}"
        fi

        attempt=$((attempt + 1))
        if [ $attempt -lt $max_attempts ]; then
            sleep 10
        fi
    done

    if [ $attempt -eq $max_attempts ] && [ "$starting_phase" != "Succeeded" ]; then
        echo -e "${RED}  ❌ CSV did not reach Succeeded phase after 10 minutes${NC}"
        exit 1
    fi

    # Wait for CRDs to be created
    local crd_patterns=$(get_operator_crds "$operator_name")
    if [ -n "$crd_patterns" ]; then
        echo -e "${BLUE}  ⏳ Waiting for CRDs to be created...${NC}"
        attempt=0
        max_attempts=30  # 5 minutes with 10-second intervals

        local all_crds_created=false
        while [ $attempt -lt $max_attempts ]; do
            all_crds_created=true
            for pattern in $crd_patterns; do
                local crds=$(oc get crd -o name 2>/dev/null | grep "$pattern" || true)
                if [ -z "$crds" ]; then
                    echo -e "${BLUE}  ⏳ Waiting for CRDs matching pattern: $pattern (attempt $attempt/$max_attempts)${NC}"
                    all_crds_created=false
                    break
                fi
            done

            if [ "$all_crds_created" = true ]; then
                echo -e "${GREEN}  ✅ All CRDs created successfully${NC}"
                break
            fi

            attempt=$((attempt + 1))
            if [ $attempt -lt $max_attempts ]; then
                sleep 10
            fi
        done

        if [ $attempt -eq $max_attempts ]; then
            echo -e "${RED}  ❌ CRDs were not created after 5 minutes${NC}"
            exit 1
        fi
    fi

    echo -e "${GREEN}✅ $operator_name installation completed and fully ready!${NC}"
}



# Main execution
main() {
    [[ "$DEBUG" == "true" ]] && echo -e "${BLUE}🚀 OpenShift Operator Management${NC}"
    [[ "$DEBUG" == "true" ]] && echo "=================================="

    check_openshift_prerequisites

    # Check if envsubst is installed (required for variable substitution)
    check_tool_exists "envsubst"

    parse_args "$@"
}

# Run main function
main "$@"
