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

    # Check if operator is installed
    local is_installed=false
    check_operator "$OPERATOR_NAME" && is_installed=true

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
            if [ "$is_installed" = false ]; then
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

# Function to check if an operator exists
check_operator() {
    local operator_name="$1"
    [[ "$DEBUG" == "true" ]] && echo -e "${BLUE}📋 Checking operator: $operator_name${NC}"
    if oc get operator "$operator_name" >/dev/null 2>&1; then
        return 0  # Operator exists
    else
        return 1  # Operator does not exist
    fi
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
    local csv_name=$(oc get subscription "$subscription_name" -n "$namespace" -o jsonpath='{.status.installedCSV}' 2>/dev/null)

    echo -e "${BLUE}  📋 Step 1: Deleting Subscription (and OperatorGroup only in dedicated namespaces)...${NC}"
    echo -e "${BLUE}     → This prevents OLM from recreating the operator${NC}"
    if [ -z "$subscription_name" ]; then
        echo -e "${RED}❌ Could not parse Subscription metadata.name from $yaml_path${NC}"
        exit 1
    fi
    # Delete only this Subscription — never `subscription --all` in shared catalog namespaces.
    oc delete subscription "$subscription_name" -n "$namespace" --ignore-not-found=true
    if [ "$namespace" = "$SHARED_REDHAT_OPERATORS_NS" ]; then
        echo -e "${YELLOW}     ⚠️  Namespace $namespace is shared by many Red Hat operators.${NC}"
        echo -e "${BLUE}     → Skipping OperatorGroup bulk delete (would remove other teams' operators).${NC}"
        # If multiple OperatorGroups exist (e.g. from a previous install that created a duplicate),
        # OLM deadlocks. Clean up duplicates, keeping only the oldest one.
        local og_count=$(oc get operatorgroup -n "$namespace" --no-headers 2>/dev/null | wc -l | tr -d ' ')
        if [ "$og_count" -gt 1 ]; then
            echo -e "${YELLOW}     ⚠️  Found $og_count OperatorGroups in $namespace (expected 1). Cleaning up duplicates...${NC}"
            local oldest_og=$(oc get operatorgroup -n "$namespace" --sort-by=.metadata.creationTimestamp -o name 2>/dev/null | head -1)
            for og in $(oc get operatorgroup -n "$namespace" -o name 2>/dev/null); do
                if [ "$og" != "$oldest_og" ]; then
                    echo -e "${BLUE}     → Deleting duplicate: $og (keeping $oldest_og)${NC}"
                    oc delete "$og" -n "$namespace" --ignore-not-found=true 2>/dev/null ||:
                fi
            done
        fi
    else
        oc delete operatorgroup --all -n "$namespace" --ignore-not-found=true
    fi

    echo -e "${BLUE}  📋 Step 2: Deleting ClusterServiceVersion (CSV)...${NC}"
    if [ -n "$csv_name" ] && [ "$csv_name" != "null" ]; then
        echo -e "${BLUE}     → Deleting CSV: $csv_name${NC}"
        oc delete csv "$csv_name" -n "$namespace" --ignore-not-found=true
    else
        echo -e "${YELLOW}     ⚠️  No CSV found for subscription $subscription_name${NC}"
        echo -e "${BLUE}     → You can manually delete CSVs by running:${NC}"
        echo -e "${BLUE}       oc delete csv -n $namespace --all --ignore-not-found=true${NC}"
    fi

    # CRDs are intentionally NOT deleted during uninstall. This follows standard OLM
    # practice: CRD deletion is cascading (deletes all custom resources cluster-wide),
    # CRDs may be shared across operators, and keeping them preserves data for reinstall.
    # Previously, deleting CRDs here caused collateral damage — e.g., deleting
    # servicemonitors.monitoring.rhobs also resolved to servicemonitors.monitoring.coreos.com,
    # wiping GPU operator DCGM ServiceMonitors and all platform ServiceMonitors.

    echo -e "${BLUE}  📋 Step 3: Deleting operator resource: $operator_name${NC}"
    # Delete the operator resource directly
    oc delete operator "$operator_name" --ignore-not-found=true --wait=false

    # Wait for OLM to clean up the operator resource (max 2 minutes)
    echo -e "${BLUE}     → Waiting for OLM to clean up operator resource...${NC}"
    local wait_attempts=24  # 2 minutes with 5-second intervals
    local wait_count=0
    while [ $wait_count -lt $wait_attempts ]; do
        if ! oc get operator "$operator_name" >/dev/null 2>&1; then
            echo -e "${GREEN}     ✅ Operator resource removed${NC}"
            break
        fi
        wait_count=$((wait_count + 1))
        if [ $wait_count -lt $wait_attempts ]; then
            sleep 5
        fi
    done

    if [ $wait_count -eq $wait_attempts ]; then
        echo -e "${YELLOW}     ⚠️  Operator resource still exists after 2 minutes${NC}"
        echo -e "${YELLOW}     ⚠️  OLM will eventually clean it up (can take 30-60 minutes)${NC}"
        echo -e "${YELLOW}     ⚠️  The operator is functionally removed (no pods/deployments running)${NC}"
    fi

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
        if oc get subscription "$subscription_name" -n "$namespace" >/dev/null 2>&1; then
            break
        fi
        attempts=$((attempts + 1))
        sleep 10
    done

    if ! oc get subscription "$subscription_name" -n "$namespace" >/dev/null 2>&1; then
        echo -e "${YELLOW}  ⚠️  Subscription $subscription_name not found; skipping InstallPlan approval${NC}"
        return 0
    fi

    local approval
    approval=$(oc get subscription "$subscription_name" -n "$namespace" -o jsonpath='{.spec.installPlanApproval}' 2>/dev/null || echo "")
    if [ "$(echo "$approval" | tr '[:upper:]' '[:lower:]')" != "manual" ]; then
        [[ "$DEBUG" == "true" ]] && echo -e "${BLUE}  📋 Install plan approval is '$approval' (not Manual); nothing to approve${NC}"
        return 0
    fi

    local target_csv
    target_csv=$(oc get subscription "$subscription_name" -n "$namespace" -o jsonpath='{.spec.startingCSV}' 2>/dev/null || echo "")
    if [ -z "$target_csv" ] || [ "$target_csv" = "null" ]; then
        echo -e "${YELLOW}  ⚠️  Subscription has Manual approval but no startingCSV set; will approve first pending InstallPlan${NC}"
    else
        echo -e "${BLUE}  📋 Manual approval required; target CSV: ${target_csv}${NC}"
    fi

    # Wait for the InstallPlan to be created and referenced by the Subscription
    attempts=0
    local installplan_name=""
    while [ $attempts -lt $max_attempts ]; do
        installplan_name=$(oc get subscription "$subscription_name" -n "$namespace" \
            -o jsonpath='{.status.installplan.name}' 2>/dev/null)
        if [ -z "$installplan_name" ] || [ "$installplan_name" = "null" ]; then
            installplan_name=$(oc get subscription "$subscription_name" -n "$namespace" \
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
        csv_list=$(oc get installplan "$installplan_name" -n "$namespace" -o jsonpath='{.spec.clusterServiceVersionNames[*]}' 2>/dev/null || echo "")
        if ! echo "$csv_list" | tr ' ' '\n' | grep -q "^${target_csv}\$"; then
            echo -e "${YELLOW}  ⚠️  InstallPlan does not include expected CSV '${target_csv}'. Planned CSV(s): ${csv_list}${NC}"
            echo -e "${YELLOW}  ⚠️  Skipping auto-approval to avoid unintended upgrades${NC}"
            return 1
        fi
    fi

    # Approve the InstallPlan
    echo -e "${BLUE}  ✍️  Approving InstallPlan: $installplan_name${NC}"
    oc patch installplan "$installplan_name" -n "$namespace" --type merge -p '{"spec":{"approved":true}}' >/dev/null

    # Optionally, wait briefly for the plan to move forward
    attempts=0
    while [ $attempts -lt 12 ]; do  # up to ~2 minutes
        local phase
        phase=$(oc get installplan "$installplan_name" -n "$namespace" -o jsonpath='{.status.phase}' 2>/dev/null || echo "")
        if [ "$phase" = "Complete" ]; then
            echo -e "${GREEN}  ✅ InstallPlan $installplan_name completed${NC}"
            break
        fi
        attempts=$((attempts + 1))
        sleep 10
    done
}

# Function to install an operator
install_operator() {
    local operator_name="$1"
    local yaml_file="$2"
    local namespace="$3"
    echo -e "${BLUE}📦 → Installing $operator_name...${NC}"

    local yaml_path=$(get_yaml_path "$yaml_file")

    # Namespace creation is handled by validate_namespace function

    # Use envsubst to substitute the NAMESPACE variable
    # Note: We use 'oc create' instead of 'oc apply' because the YAML uses 'generateName' for OperatorGroup
    # which is only supported by 'create'. We add --save-config to enable future kubectl apply operations.
    # Suppress "AlreadyExists" errors for namespaces since uninstall preserves them by design.
    export NAMESPACE="$namespace"

    # In shared namespaces (e.g. openshift-operators-redhat), an OperatorGroup likely already exists
    # from other operators. Creating a second one causes OLM to deadlock (no InstallPlans created).
    # Strip the entire OperatorGroup document from the YAML if one already exists.
    if [ "$namespace" = "$SHARED_REDHAT_OPERATORS_NS" ]; then
        local existing_og=$(oc get operatorgroup -n "$namespace" -o name 2>/dev/null | head -1)
        if [ -n "$existing_og" ]; then
            echo -e "${BLUE}     → OperatorGroup already exists in shared namespace $namespace ($existing_og). Skipping creation.${NC}"
            # python3: splits multi-doc YAML and drops OperatorGroup (see file header).
            envsubst < "$yaml_path" | python3 -c "
import sys
docs = sys.stdin.read().split('---')
for doc in docs:
    if 'kind: OperatorGroup' not in doc and doc.strip():
        print('---')
        print(doc, end='')
" | oc create --save-config -f - 2>&1 | grep -v "namespaces.*already exists" || true
        else
            envsubst < "$yaml_path" | oc create --save-config -f - 2>&1 | grep -v "namespaces.*already exists" || true
        fi
    else
        envsubst < "$yaml_path" | oc create --save-config -f - 2>&1 | grep -v "namespaces.*already exists" || true
    fi

    echo -e "${GREEN}  ✅ $operator_name installation initiated${NC}"

    # Get the subscription name to manage InstallPlan approval if needed
    local subscription_name=$(grep -A2 "kind: Subscription" "$yaml_path" | grep "name:" | awk '{print $2}')

    # If approval is Manual, auto-approve InstallPlan for the startingCSV
    approve_install_plan_if_manual "$subscription_name" "$namespace" || true

    # Wait for operator to be installed (operator resource exists)
    echo -e "${BLUE}  ⏳ Waiting for operator resource to be created...${NC}"

    local max_attempts=60  # 10 minutes with 10-second intervals
    local attempt=0

    while [ $attempt -lt $max_attempts ]; do
        if check_operator "$operator_name"; then
            echo -e "${GREEN}  ✅ Operator resource created${NC}"
            break
        fi

        attempt=$((attempt + 1))
        if [ $attempt -lt $max_attempts ]; then
            echo -e "${BLUE}  ⏳ Attempt $attempt/$max_attempts - waiting 10 seconds...${NC}"
            sleep 10
        fi
    done

    if [ $attempt -eq $max_attempts ]; then
        echo -e "${RED}  ❌ Operator resource was not created after 10 minutes${NC}"
        exit 1
    fi

    # Wait for CSV to reach Succeeded phase
    echo -e "${BLUE}  ⏳ Waiting for CSV to reach Succeeded phase...${NC}"
    attempt=0
    max_attempts=60  # 10 minutes

    while [ $attempt -lt $max_attempts ]; do
        local csv_phase=$(oc get subscription "$subscription_name" -n "$namespace" -o jsonpath='{.status.installedCSV}' 2>/dev/null)
        if [ -n "$csv_phase" ] && [ "$csv_phase" != "null" ]; then
            local phase=$(oc get csv "$csv_phase" -n "$namespace" -o jsonpath='{.status.phase}' 2>/dev/null)
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

    if [ $attempt -eq $max_attempts ]; then
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
