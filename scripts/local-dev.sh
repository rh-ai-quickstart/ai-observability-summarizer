#!/bin/bash

# AI Observability Metric Summarizer - Local Development Script

# Source common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Configuration
PROMETHEUS_NAMESPACE="openshift-monitoring"
OBSERVABILITY_NAMESPACE="observability-hub"
LOKI_NAMESPACE="openshift-logging"
KORREL8R_NAMESPACE="openshift-cluster-observability-operator"

# Service ports (what the cluster service exposes)
THANOS_SERVICE_PORT=9090
TEMPO_SERVICE_PORT=8080
LOKI_SERVICE_PORT=8080
KORREL8R_SERVICE_PORT=9443
LLAMASTACK_SERVICE_PORT=8321
LLAMA_MODEL_SERVICE_PORT=80

# Localhost ports (what you access via http://localhost:PORT)
THANOS_PORT_LOCALHOST=$THANOS_SERVICE_PORT
TEMPO_PORT_LOCALHOST=8082
LOKI_PORT_LOCALHOST=3100
KORREL8R_PORT_LOCALHOST=$KORREL8R_SERVICE_PORT
LLAMASTACK_PORT_LOCALHOST=$LLAMASTACK_SERVICE_PORT
LLAMA_MODEL_PORT_LOCALHOST=8080
UI_PORT_LOCALHOST=8501
REACT_UI_PORT_LOCALHOST=3000
MCP_PORT_LOCALHOST=${MCP_PORT:-8085}
PLUGIN_PORT_LOCALHOST=9001
CONSOLE_PORT_LOCALHOST=9000

# Arrays to track all spawned processes for cleanup
declare -a CLEANUP_PIDS=()
declare -a PORT_FORWARD_PIDS=()

# Health monitor log file
HEALTH_LOG_FILE="/tmp/summarizer-port-forward-health.log"

echo -e "${BLUE}🚀 AI Observability Metric Summarizer - Local Development Setup${NC}"
echo "=============================================================="

# Function to display usage
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -n/-N NAMESPACE              Default namespace for pods (required)"
    echo "  -m/-M NAMESPACE              Llama Model namespace (optional, use if model is in different namespace)"
    echo "  -c/-C CONFIG                 Model config source: 'local' or 'cluster' (default: local)"
    echo "  -l/-L LLM_MODEL              LLM model to generate config for (default: llama-3.2-3b-instruct, only used with -c local)"
    echo "  -p/-P                        Start OpenShift Console Plugin dev server (optional)"
    echo "  -o/-O                        Start OpenShift Console with plugin (requires -p, starts full local console)"
    echo ""
    echo "Examples:"
    echo "  $0 -n default-ns                       # Use local config with default LLM (llama-3.2-3b-instruct)"
    echo "  $0 -N default-ns                       # Same as above (uppercase option)"
    echo "  $0 -n default-ns -m model-ns           # Model in different namespace, use default LLM"
    echo "  $0 -n default-ns -c cluster            # Use cluster model config instead of local"
    echo "  $0 -n default-ns -l llama-3.2-1b-instruct  # Generate config for llama-3.2-1b-instruct"
    echo "  $0 -n default-ns -l llama-3.1-8b-instruct  # Generate config for llama-3.1-8b-instruct"
    echo "  $0 -n default-ns -p                    # Start with OpenShift Console Plugin dev server"
    echo "  $0 -n default-ns -p -o                 # Full local testing: MCP + Plugin + OpenShift Console"
}

# Function to parse command line arguments
parse_args() {
    # Check if no arguments provided
    if [ $# -eq 0 ]; then
        usage
        exit 2
    fi

    DEFAULT_NAMESPACE=""
    LLAMA_MODEL_NAMESPACE=""
    MODEL_CONFIG_SOURCE="local"  # Default to local
    LLM_MODEL=$(get_default_model)  # Optional LLM model for config generation
    START_PLUGIN="false"  # Whether to start the OpenShift Console Plugin dev server
    START_CONSOLE="false"  # Whether to start the OpenShift Console container

    # Parse standard arguments using getopts
    while getopts "n:N:m:M:c:C:l:L:pPoOh" opt; do
        case $opt in
            n|N) DEFAULT_NAMESPACE="$OPTARG"
                 ;;
            m|M) LLAMA_MODEL_NAMESPACE="$OPTARG"
                 ;;
            c|C) MODEL_CONFIG_SOURCE="$OPTARG"
                 ;;
            l|L) LLM_MODEL="$OPTARG"
                 ;;
            p|P) START_PLUGIN="true"
                 ;;
            o|O) START_CONSOLE="true"
                 ;;
            h) usage
               exit 0
               ;;
            *) echo -e "${RED}❌ INVALID option: [$OPTARG]${NC}"
               usage
               exit 1
               ;;
        esac
    done

    # Validate arguments
    if [ -z "$DEFAULT_NAMESPACE" ]; then
        echo -e "${RED}❌ Default namespace is required. Please specify using -n or -N${NC}"
        usage
        exit 1
    fi

    # Validate model config source
    if [[ "$MODEL_CONFIG_SOURCE" != "local" && "$MODEL_CONFIG_SOURCE" != "cluster" ]]; then
        echo -e "${RED}❌ Invalid model config source: $MODEL_CONFIG_SOURCE${NC}"
        echo -e "${YELLOW}   Valid options: 'local' or 'cluster'${NC}"
        usage
        exit 1
    fi

    # If console is requested, plugin must also be started
    if [ "$START_CONSOLE" = "true" ] && [ "$START_PLUGIN" = "false" ]; then
        echo -e "${YELLOW}⚠️  Console (-o) requires plugin (-p). Enabling plugin automatically.${NC}"
        START_PLUGIN="true"
    fi

    # Set llama model namespace to default if not provided
    if [ -z "$LLAMA_MODEL_NAMESPACE" ]; then
        LLAMA_MODEL_NAMESPACE="$DEFAULT_NAMESPACE"
    fi
}

# Function to check for existing script instances
check_existing_instances() {
    local script_name="local-dev.sh"
    local pid_file="/tmp/summarizer-local-dev.pid"

    # Check PID file first
    if [ -f "$pid_file" ]; then
        local old_pid=$(cat "$pid_file")
        if ps -p "$old_pid" > /dev/null 2>&1; then
            echo -e "${RED}❌ Another local-dev.sh instance is already running (PID: $old_pid)${NC}"
            echo -e "${YELLOW}   To stop it, run: kill $old_pid${NC}"
            echo -e "${YELLOW}   Or to force cleanup: pkill -9 -f 'local-dev.sh' && rm $pid_file${NC}"
            exit 1
        else
            # Stale PID file - remove it
            echo -e "${YELLOW}⚠️  Removing stale PID file (process $old_pid no longer exists)${NC}"
            rm -f "$pid_file"
        fi
    fi

    # Double-check for any bash processes running this script
    local existing_pids=$(ps -ef | grep "[/]bin/bash.*local-dev.sh" | grep -v "$$" | awk '{print $2}')

    if [ -n "$existing_pids" ]; then
        echo -e "${YELLOW}⚠️  Found existing local-dev.sh instances running:${NC}"
        echo "$existing_pids" | while read pid; do
            echo -e "${YELLOW}   PID: $pid${NC}"
        done
        echo -e "${RED}❌ Cannot start - another instance is running${NC}"
        echo -e "${YELLOW}   To force cleanup: pkill -9 -f 'local-dev.sh' && rm -f $pid_file${NC}"
        exit 1
    fi

    # Create PID file for this instance with exclusive lock
    echo "$$" > "$pid_file"
    echo -e "${GREEN}✅ Instance lock acquired (PID: $$)${NC}"
}

# Function to track application PIDs for cleanup
track_pid() {
    local pid=$1
    local description=$2
    CLEANUP_PIDS+=("$pid:$description")
}

# Function to track port-forward PIDs for cleanup
track_port_forward() {
    local pid=$1
    PORT_FORWARD_PIDS+=("$pid")
}

# Enhanced error handler
error_handler() {
    local line_no=$1
    local bash_lineno=$2
    local exit_code=$3

    echo -e "${RED}❌ Error on line $line_no (exit code: $exit_code)${NC}"
    echo -e "${RED}   Last command: $BASH_COMMAND${NC}"

    # Trigger cleanup
    cleanup
    exit $exit_code
}

# Stop all tracked port-forwards
stop_tracked_port_forwards() {
    if [ ${#PORT_FORWARD_PIDS[@]} -gt 0 ]; then
        echo -e "${BLUE}  → Stopping port-forwards...${NC}"
        for pid in "${PORT_FORWARD_PIDS[@]}"; do
            if kill -0 "$pid" 2>/dev/null; then
                kill -TERM "$pid" 2>/dev/null || true
            fi
        done
        sleep 1
        # Force kill any remaining
        for pid in "${PORT_FORWARD_PIDS[@]}"; do
            if kill -0 "$pid" 2>/dev/null; then
                kill -9 "$pid" 2>/dev/null || true
            fi
        done
    fi
}

# Stop all tracked application services with graceful shutdown
stop_tracked_services() {
    if [ ${#CLEANUP_PIDS[@]} -eq 0 ]; then
        return
    fi

    echo -e "${BLUE}  → Stopping application services gracefully...${NC}"
    for entry in "${CLEANUP_PIDS[@]}"; do
        pid="${entry%%:*}"
        description="${entry#*:}"
        if kill -0 "$pid" 2>/dev/null; then
            echo -e "${BLUE}    • Stopping $description (PID: $pid)${NC}"
            # Try graceful shutdown first
            kill -TERM "$pid" 2>/dev/null || true
        fi
    done

    # Wait up to 5 seconds for graceful shutdown
    echo -e "${BLUE}  → Waiting for graceful shutdown (max 5s)...${NC}"
    local waited=0
    while [ $waited -lt 5 ]; do
        local all_stopped=true
        for entry in "${CLEANUP_PIDS[@]}"; do
            pid="${entry%%:*}"
            if kill -0 "$pid" 2>/dev/null; then
                all_stopped=false
                break
            fi
        done
        if $all_stopped; then
            echo -e "${GREEN}  ✅ All services stopped gracefully${NC}"
            break
        fi
        sleep 1
        ((waited++))
    done

    # Force kill any remaining processes
    echo -e "${BLUE}  → Force stopping any remaining processes...${NC}"
    for entry in "${CLEANUP_PIDS[@]}"; do
        pid="${entry%%:*}"
        description="${entry#*:}"
        if kill -0 "$pid" 2>/dev/null; then
            echo -e "${YELLOW}    • Force killing $description (PID: $pid)${NC}"
            # Kill process and all children
            pkill -9 -P "$pid" 2>/dev/null || true
            kill -9 "$pid" 2>/dev/null || true
        fi
    done
}

# Pattern-based cleanup for any straggler processes
cleanup_straggler_processes() {
    echo -e "${BLUE}  → Cleaning up any straggler processes...${NC}"
    pkill -f "oc port-forward.*$THANOS_PORT_LOCALHOST" 2>/dev/null || true
    pkill -f "oc port-forward.*$TEMPO_PORT_LOCALHOST" 2>/dev/null || true
    pkill -f "oc port-forward.*$LOKI_PORT_LOCALHOST" 2>/dev/null || true
    pkill -f "oc port-forward.*$KORREL8R_PORT_LOCALHOST" 2>/dev/null || true
    pkill -f "oc port-forward.*$LLAMASTACK_PORT_LOCALHOST" 2>/dev/null || true
    pkill -f "oc port-forward.*$LLAMA_MODEL_PORT_LOCALHOST" 2>/dev/null || true
    pkill -f "mcp_server.main" 2>/dev/null || true
    pkill -f "streamlit run ui.py" 2>/dev/null || true
    pkill -f "webpack serve" 2>/dev/null || true
    pkill -f "yarn.*start" 2>/dev/null || true
    pkill -f "yarn run start-console" 2>/dev/null || true
}

# Ensure all ports are freed
free_all_ports() {
    echo -e "${BLUE}  → Ensuring ports are freed...${NC}"
    ensure_port_free "$MCP_PORT_LOCALHOST" "quiet"
    ensure_port_free "$UI_PORT_LOCALHOST" "quiet"
    ensure_port_free "$TEMPO_PORT_LOCALHOST" "quiet"
    ensure_port_free "$PLUGIN_PORT_LOCALHOST" "quiet"
    ensure_port_free "$CONSOLE_PORT_LOCALHOST" "quiet"
}

# Clean up PID file, old logs, and deactivate virtual environment
cleanup_files_and_venv() {
    # Clean up PID file
    rm -f /tmp/summarizer-local-dev.pid

    # Clean up old log files (keep only recent ones - older than 1 day)
    echo -e "${BLUE}  → Cleaning up old log files...${NC}"
    find /tmp -name "summarizer-*.log" -type f -mtime +1 -delete 2>/dev/null || true

    # Deactivate virtual environment
    if [ -n "$VIRTUAL_ENV" ]; then
        echo -e "${BLUE}  → Deactivating virtual environment...${NC}"
        deactivate 2>/dev/null || true
    fi
}

# Verify cleanup was successful
verify_cleanup() {
    echo -e "${BLUE}  → Verifying cleanup...${NC}"
    local issues=0

    if lsof -nP -iTCP:"$MCP_PORT_LOCALHOST" -sTCP:LISTEN >/dev/null 2>&1; then
        echo -e "${YELLOW}    ⚠️  Port $MCP_PORT_LOCALHOST still in use${NC}"
        ((issues++))
    fi

    if pgrep -f "mcp_server.main" >/dev/null 2>&1; then
        echo -e "${YELLOW}    ⚠️  MCP server still running${NC}"
        ((issues++))
    fi

    if [ $issues -eq 0 ]; then
        echo -e "${GREEN}✅ Cleanup complete - all resources freed${NC}"
    else
        echo -e "${YELLOW}⚠️  Cleanup complete with $issues warnings${NC}"
    fi
}

# Function to cleanup on exit
cleanup() {
    # Prevent multiple cleanup calls
    if [ "$CLEANUP_DONE" = "true" ]; then
        return
    fi
    CLEANUP_DONE=true

    echo -e "\n${YELLOW}🧹 Cleaning up services and port-forwards...${NC}"

    # 1. Stop tracked port-forwards first (network resources)
    stop_tracked_port_forwards

    # 2. Stop tracked application processes with graceful shutdown
    stop_tracked_services

    # 3. Fallback: Pattern-based cleanup for any stragglers
    cleanup_straggler_processes

    # 4. Ensure ports are freed
    free_all_ports

    # 5. Clean up PID file, old logs, and deactivate virtual environment
    cleanup_files_and_venv

    # 6. Verify cleanup was successful
    verify_cleanup
}

# Function to check prerequisites and activate virtual environment
check_prerequisites() {
    echo -e "${BLUE}🔍 Checking prerequisites...${NC}"

    # Check for virtual environment and activate it
    if [ -f ".venv/bin/activate" ]; then
        echo -e "${BLUE}🐍 Activating Python virtual environment...${NC}"
        source .venv/bin/activate
        echo -e "${GREEN}✅ Virtual environment activated${NC}"
    else
        echo -e "${YELLOW}⚠️  Virtual environment (.venv) not found${NC}"
        echo -e "${YELLOW}   Please create virtual environment by following README or DEV_GUIDE${NC}"
        exit 1
    fi

    check_tool_exists "oc"
    check_openshift_login

    echo -e "${GREEN}✅ Prerequisites check passed${NC}"
}

# Helper function to create port-forward command
create_port_forward() {
    local resource_name="$1"
    local local_port="$2"
    local remote_port="$3"
    local namespace="$4"
    local description="$5"
    local emoji="$6"
    local optional="${7:-false}"  # Default to false (required resource)

    # Check if resource name is found
    if [ -z "$resource_name" ]; then
        if [ "$optional" = "true" ]; then
            echo -e "${YELLOW}⚠️  $description resource NOT found in $namespace namespace (optional - skipping)${NC}"
            return 0
        else
            echo -e "${RED}❌️  $description resource NOT found in $namespace namespace. Exiting...${NC}"
            exit 1
        fi
    fi

    # Create port-forward and track PID with metadata for health monitoring
    oc port-forward "$resource_name" "$local_port:$remote_port" -n "$namespace" >/dev/null 2>&1 &
    local pf_pid=$!
    track_port_forward_with_metadata "$pf_pid" "$resource_name" "$local_port" "$remote_port" "$namespace" "$description"

    echo -e "${GREEN}✅ Found $description: $emoji (resource: $resource_name, namespace: $namespace, PID: $pf_pid) available at: http://localhost:$local_port${NC}"
}

# Function to find and start port forwards
start_port_forwards() {
    echo -e "${BLUE}🔍 Finding pods and starting port-forwards...${NC}"

    local THANOS_POD_LABEL='app.kubernetes.io/component=query-layer,app.kubernetes.io/instance=thanos-querier'
    local LLAMASTACK_SERVICE_LABEL='app.kubernetes.io/instance=rag, app.kubernetes.io/name=llamastack'
    local LLAMA_MODEL_SERVICE_LABEL="serving.kserve.io/inferenceservice=$LLM_MODEL, component=predictor"
    local TEMPO_SERVICE_LABEL='app.kubernetes.io/name=tempo,app.kubernetes.io/component=gateway'
    local KORREL8R_SERVICE_LABEL='app.kubernetes.io/name=korrel8r'

    THANOS_POD=$(oc get pods -n "$PROMETHEUS_NAMESPACE" -o name -l "$THANOS_POD_LABEL" | head -1)
    create_port_forward "$THANOS_POD" "$THANOS_PORT_LOCALHOST" "$THANOS_SERVICE_PORT" "$PROMETHEUS_NAMESPACE" "Thanos" "📊"

    # Find LlamaStack pod
    LLAMASTACK_SERVICE=$(oc get services -n "$LLAMA_MODEL_NAMESPACE" -o name -l "$LLAMASTACK_SERVICE_LABEL")
    create_port_forward "$LLAMASTACK_SERVICE" "$LLAMASTACK_PORT_LOCALHOST" "$LLAMASTACK_SERVICE_PORT" "$LLAMA_MODEL_NAMESPACE" "LlamaStack" "🦙"

    # Find Llama Model service
    LLAMA_MODEL_SERVICE=$(oc get services -n "$LLAMA_MODEL_NAMESPACE" -o name -l "$LLAMA_MODEL_SERVICE_LABEL")
    create_port_forward "$LLAMA_MODEL_SERVICE" "$LLAMA_MODEL_PORT_LOCALHOST" "$LLAMA_MODEL_SERVICE_PORT" "$LLAMA_MODEL_NAMESPACE" "Llama Model" "🤖"

    # Find Tempo gateway service
    TEMPO_SERVICE=$(oc get services -n "$OBSERVABILITY_NAMESPACE" -o name -l "$TEMPO_SERVICE_LABEL")
    create_port_forward "$TEMPO_SERVICE" "$TEMPO_PORT_LOCALHOST" "$TEMPO_SERVICE_PORT" "$OBSERVABILITY_NAMESPACE" "Tempo" "🔍"

    # Find Loki gateway service (optional - only if LokiStack is installed)
    LOKI_SERVICE=$(oc get services -n "$LOKI_NAMESPACE" -o name -l 'app.kubernetes.io/name=lokistack,app.kubernetes.io/component=lokistack-gateway' 2>/dev/null)
    if [ -n "$LOKI_SERVICE" ]; then
        create_port_forward "$LOKI_SERVICE" "$LOKI_PORT_LOCALHOST" "$LOKI_SERVICE_PORT" "$LOKI_NAMESPACE" "Loki" "📋"
    else
        echo -e "${YELLOW}⚠️  Loki gateway service NOT found in $LOKI_NAMESPACE namespace (optional - skipping)${NC}"
    fi

    # Find Korrel8r service (optional - may not be deployed)
    KORREL8R_SERVICE=$(oc get services -n "$KORREL8R_NAMESPACE" -o name -l "$KORREL8R_SERVICE_LABEL" 2>/dev/null | head -1)
    create_port_forward "$KORREL8R_SERVICE" "$KORREL8R_PORT_LOCALHOST" "$KORREL8R_SERVICE_PORT" "$KORREL8R_NAMESPACE" "Korrel8r" "🔗" "true"

    sleep 3  # Give port-forwards time to establish
}

# Ensure a TCP port is free by terminating any process listening on it
ensure_port_free() {
    local port=$1
    local quiet_mode="${2:-normal}"

    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
        [ "$quiet_mode" != "quiet" ] && echo -e "${YELLOW}⚠️  Port $port is in use. Attempting to free it...${NC}"

        # Get PID for logging
        local pid=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null)

        # Try graceful termination first
        lsof -nP -iTCP:"$port" -sTCP:LISTEN -t | xargs -r kill -TERM 2>/dev/null || true
        sleep 1

        # Force kill if still listening
        if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
            lsof -nP -iTCP:"$port" -sTCP:LISTEN -t | xargs -r kill -9 2>/dev/null || true
            sleep 0.5
        fi

        # Verify port is free
        if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
            echo -e "${RED}❌ Could not free port $port (PID: $pid). Please free it manually.${NC}"
            return 1
        fi
        [ "$quiet_mode" != "quiet" ] && echo -e "${GREEN}✅ Port $port is now free${NC}"
    fi
    return 0
}

# Array to store port-forward metadata for health monitoring
declare -a PORT_FORWARD_METADATA=()

# Track port-forward with metadata for health monitoring
track_port_forward_with_metadata() {
    local pid=$1
    local resource_name=$2
    local local_port=$3
    local remote_port=$4
    local namespace=$5
    local description=$6

    PORT_FORWARD_PIDS+=("$pid")
    PORT_FORWARD_METADATA+=("$pid:$resource_name:$local_port:$remote_port:$namespace:$description")
}

# Helper to log health events with timestamps
log_health_event() {
    local message="$1"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] $message" >> "$HEALTH_LOG_FILE"
}

# Health check and auto-restart for port-forwards
monitor_port_forwards() {
    echo -e "${BLUE}🏥 Starting port-forward health monitor (checks every 30s)...${NC}"
    echo -e "${BLUE}   Health events logged to: $HEALTH_LOG_FILE${NC}"

    # Initialize log file
    log_health_event "=== Health monitor started ==="

    while true; do
        sleep 30

        local failed_count=0
        local restarted_count=0

        for entry in "${PORT_FORWARD_METADATA[@]}"; do
            IFS=':' read -r pid resource_name local_port remote_port namespace description <<< "$entry"

            # Check if port-forward process is alive
            if ! ps -p "$pid" > /dev/null 2>&1; then
                ((failed_count++))
                log_health_event "⚠️  Port-forward for $description died (PID: $pid, port: $local_port)"

                # Restart the port-forward
                oc port-forward "$resource_name" "$local_port:$remote_port" -n "$namespace" >/dev/null 2>&1 &
                local new_pid=$!
                log_health_event "🔄 Restarting $description → new PID: $new_pid (resource: $resource_name, namespace: $namespace)"

                # Update metadata with new PID
                for i in "${!PORT_FORWARD_METADATA[@]}"; do
                    if [[ "${PORT_FORWARD_METADATA[$i]}" == "$entry" ]]; then
                        PORT_FORWARD_METADATA[$i]="$new_pid:$resource_name:$local_port:$remote_port:$namespace:$description"
                        break
                    fi
                done

                # Update tracked PIDs
                for i in "${!PORT_FORWARD_PIDS[@]}"; do
                    if [[ "${PORT_FORWARD_PIDS[$i]}" == "$pid" ]]; then
                        PORT_FORWARD_PIDS[$i]="$new_pid"
                        break
                    fi
                done

                # Verify the new port-forward is working (retry up to 3 times)
                local verify_attempts=0
                local max_attempts=3
                local verified=false

                while [ $verify_attempts -lt $max_attempts ]; do
                    sleep 2
                    ((verify_attempts++))

                    # Check if process is still alive
                    if ! ps -p "$new_pid" > /dev/null 2>&1; then
                        log_health_event "❌ Port-forward process died during verification (attempt $verify_attempts/$max_attempts)"
                        break
                    fi

                    # Check if port is listening
                    if lsof -nP -iTCP:"$local_port" -sTCP:LISTEN >/dev/null 2>&1; then
                        log_health_event "✅ Successfully restarted $description (verified on port $local_port)"
                        ((restarted_count++))
                        verified=true
                        break
                    fi
                done

                if ! $verified; then
                    log_health_event "❌ Failed to restart $description after $max_attempts attempts"
                fi
            fi
        done

        # Log summary and show on console only if there were failures
        if [ $failed_count -gt 0 ]; then
            log_health_event "📊 Health check summary: $failed_count failed, $restarted_count restarted"
            echo -e "${BLUE}🏥 Health check: $failed_count failed, $restarted_count restarted (details: $HEALTH_LOG_FILE)${NC}" >&2
        fi
    done
}

# This function sets "MODEL_CONFIG" environment variable from cluster deployment or dynamically generated config
set_model_config() {
    if [ "$MODEL_CONFIG_SOURCE" = "local" ]; then
        # Generate model config dynamically (LLM_MODEL is optional, will use default if not specified)
        # Script is already sourced in main(), just call the function
        if generate_model_config "$LLM_MODEL"; then
            return 0
        else
            echo -e "${RED}❌ Failed to generate MODEL_CONFIG${NC}"
            exit 1
        fi
    else
        # Use cluster config
        echo -e "${BLUE}🔧 Setting up MODEL_CONFIG from cluster...${NC}"
        local MCP_SERVER_APP="mcp-server-app"
        MCP_SERVER_APP_DEPLOYMENT=$(oc get deploy $MCP_SERVER_APP -n "$DEFAULT_NAMESPACE" 2>/dev/null)
        if [ -n "$MCP_SERVER_APP_DEPLOYMENT" ]; then
            echo -e "${YELLOW}✅ Found [$MCP_SERVER_APP] deployment:\n$MCP_SERVER_APP_DEPLOYMENT${NC}"
            export $(oc set env deployment/$MCP_SERVER_APP --list  -n "$DEFAULT_NAMESPACE" | grep MODEL_CONFIG)
            if [ -n "$MODEL_CONFIG" ]; then
              echo -e "${GREEN}✅ CLUSTER MODEL_CONFIG set successfully${NC}"
              echo -e "${BLUE}   Available models: $(echo "$MODEL_CONFIG" | jq -r 'keys | join(", ")')${NC}"
            else
              echo -e "${RED}❌ Unable to set MODEL_CONFIG environment variable. It is required to run the UI locally.${NC}"
              exit 1
            fi
        else
            echo -e "${RED}❌ $MCP_SERVER_APP deployment not found. It is required to set MODEL_CONFIG.${NC}"
            exit 1
        fi
    fi
}

# Function to start local services
start_local_services() {
    echo -e "${BLUE}🏃 Starting local services...${NC}"

    # Get service account token
    TOKEN=$(oc whoami -t)

    # Set environment variables
    export LOCAL_DEV="true"  # Mark as local development

    # Enable DEV_MODE for local development (saves API keys to browser localStorage instead of OCP secrets)
    export DEV_MODE="${DEV_MODE:-true}"

    export PROMETHEUS_URL="http://localhost:$THANOS_PORT_LOCALHOST"
    export TEMPO_URL="https://localhost:$TEMPO_PORT_LOCALHOST"
    export TEMPO_TENANT_ID="dev"
    export TEMPO_TOKEN="$TOKEN"
    export LOKI_URL="https://localhost:$LOKI_PORT_LOCALHOST"
    export LOKI_TOKEN="$TOKEN"
    export LLAMA_STACK_URL="http://localhost:$LLAMASTACK_PORT_LOCALHOST/v1/openai/v1"
    export THANOS_TOKEN="$TOKEN"
    export MCP_URL="http://localhost:$MCP_PORT_LOCALHOST"
    export PROM_URL="$PROMETHEUS_URL"
    # Set log level (override with PYTHON_LOG_LEVEL=DEBUG for more verbose logging)
    export PYTHON_LOG_LEVEL="${PYTHON_LOG_LEVEL:-INFO}"

    # SSL verification settings for Tempo HTTPS
    export VERIFY_SSL=false
    export PYTHONHTTPSVERIFY=0

    # macOS weasyprint support
    export DYLD_FALLBACK_LIBRARY_PATH="/opt/homebrew/lib:$DYLD_FALLBACK_LIBRARY_PATH"

    set_model_config

    # Start MCP server (HTTP transport)
    echo -e "${BLUE}🧩 Starting MCP Server (HTTP)...${NC}"
    ensure_port_free "$MCP_PORT_LOCALHOST"
    (cd src && \
      PYTHONPATH="$(pwd)/.." \
      MCP_TRANSPORT_PROTOCOL=http \
      MODEL_CONFIG="$MODEL_CONFIG" \
      PROMETHEUS_URL="$PROMETHEUS_URL" \
      TEMPO_URL="$TEMPO_URL" \
      TEMPO_TENANT_ID="$TEMPO_TENANT_ID" \
      TEMPO_TOKEN="$TEMPO_TOKEN" \
      LOKI_URL="$LOKI_URL" \
      LOKI_TOKEN="$LOKI_TOKEN" \
      LLAMA_STACK_URL="$LLAMA_STACK_URL" \
      KORREL8R_URL="https://localhost:$KORREL8R_PORT_LOCALHOST" \
      THANOS_TOKEN="$THANOS_TOKEN" \
      VERIFY_SSL="$VERIFY_SSL" \
      PYTHON_LOG_LEVEL="$PYTHON_LOG_LEVEL" \
      CORS_ORIGINS='["http://localhost:5173","http://localhost:3000","http://localhost:9000","http://localhost:9001","http://127.0.0.1:5173"]' \
      python3 -m mcp_server.main > /tmp/summarizer-mcp-server.log 2>&1) &
    MCP_SRV_PID=$!
    track_pid "$MCP_SRV_PID" "MCP Server"

    # Wait for MCP server to start
    echo "Waiting for MCP server to start..."
    sleep 5

    # Test MCP server health with retry logic
    echo "Testing MCP server health on port $MCP_PORT_LOCALHOST..."
    HEALTH_CHECK_RETRIES=5
    for i in $(seq 1 $HEALTH_CHECK_RETRIES); do
        echo "Health check attempt $i/$HEALTH_CHECK_RETRIES..."
        if curl -s --connect-timeout 5 "http://localhost:$MCP_PORT_LOCALHOST/health" | grep -q '"healthy"'; then
            echo -e "${GREEN}✅ MCP Server started successfully on port $MCP_PORT_LOCALHOST${NC}"
            break
        else
            if [ $i -eq $HEALTH_CHECK_RETRIES ]; then
                echo -e "${RED}❌ MCP Server failed to start after $HEALTH_CHECK_RETRIES attempts${NC}"
                echo "Server log output:"
                cat /tmp/summarizer-mcp-server.log
                exit 1
            else
                echo "Health check failed, waiting 2 seconds before retry..."
                sleep 2
            fi
        fi
    done

    # Start Streamlit UI
    echo -e "${BLUE}🎨 Starting Streamlit UI...${NC}"
    (cd src/ui && \
      MCP_SERVER_URL="http://localhost:$MCP_PORT_LOCALHOST" \
      PYTHON_LOG_LEVEL="$PYTHON_LOG_LEVEL" \
      streamlit run ui.py --server.port $UI_PORT_LOCALHOST --server.address 0.0.0.0 --server.headless true > /tmp/summarizer-ui.log 2>&1) &
    UI_PID=$!
    track_pid "$UI_PID" "Streamlit UI"

    # Wait for UI to start
    sleep 5

    # Start React-UI (OpenShift Console alternative UI)
    echo -e "${BLUE}🌐 Starting React-UI...${NC}"
    ensure_port_free "$REACT_UI_PORT_LOCALHOST"

    if [ -d "openshift-plugin" ]; then
        echo -e "${BLUE}  → Installing React-UI dependencies...${NC}"
        (cd openshift-plugin && yarn install --frozen-lockfile > /tmp/summarizer-react-ui-install.log 2>&1)

        echo -e "${BLUE}  → Starting React-UI dev server on port $REACT_UI_PORT_LOCALHOST...${NC}"
        (cd openshift-plugin && yarn start:react-ui > /tmp/summarizer-react-ui.log 2>&1) &
        REACT_UI_PID=$!
        track_pid "$REACT_UI_PID" "React-UI"

        # Wait for React-UI to start
        sleep 8

        # Test React-UI health
        if curl -s --connect-timeout 5 "http://localhost:$REACT_UI_PORT_LOCALHOST" | grep -q 'html'; then
            echo -e "${GREEN}✅ React-UI started successfully${NC}"
        else
            echo -e "${YELLOW}⚠️  React-UI may still be starting. Check /tmp/summarizer-react-ui.log${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️  openshift-plugin directory not found. Skipping React-UI.${NC}"
    fi

    # Show log file locations for debugging
    echo -e "${GREEN}📋 Log files for debugging (all in /tmp):${NC}"
    echo -e "   🔧 MCP Server: /tmp/summarizer-mcp-server.log"
    echo -e "   🎨 Streamlit UI: /tmp/summarizer-ui.log"
    echo -e "   🌐 React-UI: /tmp/summarizer-react-ui.log"
    echo -e "   🏥 Port-Forward Health: $HEALTH_LOG_FILE"
    if [ "$START_PLUGIN" = "true" ]; then
        echo -e "   🔌 Plugin Dev Server: /tmp/summarizer-plugin.log"
    fi
    if [ "$START_CONSOLE" = "true" ]; then
        echo -e "   🖥️  OpenShift Console: /tmp/summarizer-console.log"
    fi
    echo -e "   💡 To see live logs: tail -f /tmp/summarizer-*.log"

    # Start OpenShift Console Plugin dev server if requested
    if [ "$START_PLUGIN" = "true" ]; then
        echo -e "${BLUE}🔌 Starting OpenShift Console Plugin dev server...${NC}"
        ensure_port_free "$PLUGIN_PORT_LOCALHOST"
        
        # Check if plugin directory exists
        if [ -d "openshift-plugin" ]; then
            echo -e "${BLUE}  → Installing plugin dependencies...${NC}"
            (cd openshift-plugin && yarn install --frozen-lockfile)

            echo -e "${BLUE}  → Starting plugin dev server on port $PLUGIN_PORT_LOCALHOST...${NC}"
            (cd openshift-plugin && yarn start:plugin > /tmp/summarizer-plugin.log 2>&1) &
            PLUGIN_PID=$!
            track_pid "$PLUGIN_PID" "Plugin Dev Server"

            # Wait for plugin to start
            sleep 8
            
            # Test plugin health
            if curl -s --connect-timeout 5 "http://localhost:$PLUGIN_PORT_LOCALHOST/plugin-manifest.json" | grep -q '"name"'; then
                echo -e "${GREEN}✅ Plugin dev server started successfully on port $PLUGIN_PORT_LOCALHOST${NC}"
            else
                echo -e "${YELLOW}⚠️  Plugin dev server may still be starting. Check /tmp/summarizer-plugin.log${NC}"
            fi
        else
            echo -e "${RED}❌ openshift-plugin directory not found. Skipping plugin dev server.${NC}"
            START_CONSOLE="false"  # Can't start console without plugin
        fi
    fi

    # Start OpenShift Console using yarn script if requested
    if [ "$START_CONSOLE" = "true" ]; then
        echo -e "${BLUE}🖥️  Starting OpenShift Console...${NC}"
        ensure_port_free "$CONSOLE_PORT_LOCALHOST"
        
        # Check if plugin directory exists and yarn is available
        if [ -d "openshift-plugin" ]; then
            echo -e "${BLUE}  → Checking Podman connection...${NC}"
            # Ensure Podman connection is working
            if ! podman system connection default podman-machine-default 2>/dev/null; then
                echo -e "${YELLOW}⚠️  Setting Podman default connection...${NC}"
            fi
            
            # Test Podman connection and restart machine if needed
            if ! podman ps >/dev/null 2>&1; then
                echo -e "${YELLOW}⚠️  Podman connection failed, restarting machine...${NC}"
                podman machine stop >/dev/null 2>&1 || true
                podman machine start >/dev/null 2>&1
                echo -e "${GREEN}✅ Podman machine restarted${NC}"
            fi
            
            echo -e "${BLUE}  → Starting console with plugin integration...${NC}"
            echo -e "${YELLOW}⚠️  Security: Console bound to localhost only (127.0.0.1:$CONSOLE_PORT_LOCALHOST)${NC}"
            
            # Start console using yarn script in background
            (cd openshift-plugin && yarn run start-console > /tmp/summarizer-console.log 2>&1) &
            CONSOLE_PID=$!
            track_pid "$CONSOLE_PID" "OpenShift Console"

            # Wait for console to start
            sleep 8
            
            # Test console health
            if curl -s --connect-timeout 5 "http://localhost:$CONSOLE_PORT_LOCALHOST" | grep -q 'html'; then
                echo -e "${GREEN}✅ OpenShift Console started successfully on port $CONSOLE_PORT_LOCALHOST${NC}"
            else
                echo -e "${YELLOW}⚠️  Console may still be starting. Check /tmp/summarizer-console.log${NC}"
            fi
        else
            echo -e "${RED}❌ openshift-plugin directory not found. Cannot start console.${NC}"
            START_CONSOLE="false"
        fi
    fi

    echo -e "${GREEN}✅ All services started successfully!${NC}"
}

# Main execution
main() {
    # Source the shared script once (for model config generation and default model)
    source scripts/generate-model-config.sh

    parse_args "$@"
    check_existing_instances  # Prevent multiple simultaneous instances
    check_prerequisites

    # Set comprehensive cleanup traps only after successful prerequisite checks
    # Note: ERR trap not used as it interferes with expected failures (e.g., health check retries)
    trap cleanup EXIT INT TERM HUP QUIT

    echo ""
    echo -e "${BLUE}--------------------------------${NC}"
    echo -e "${BLUE}Configuration being used for setup:${NC}"
    echo -e "${BLUE}  DEFAULT_NAMESPACE: $DEFAULT_NAMESPACE${NC}"
    echo -e "${BLUE}  LLAMA_MODEL_NAMESPACE: $LLAMA_MODEL_NAMESPACE${NC}"
    echo -e "${BLUE}  MODEL_CONFIG_SOURCE: $MODEL_CONFIG_SOURCE${NC}"
    echo -e "${BLUE}  LLM_MODEL: $LLM_MODEL${NC}"
    echo -e "${BLUE}  START_PLUGIN: $START_PLUGIN${NC}"
    echo -e "${BLUE}  START_CONSOLE: $START_CONSOLE${NC}"
    echo -e "${BLUE}--------------------------------${NC}\n"

    start_port_forwards
    start_local_services

    # Start background health monitor for port-forwards
    monitor_port_forwards &
    MONITOR_PID=$!
    track_pid "$MONITOR_PID" "Port-forward Health Monitor"

    echo -e "\n${GREEN}🎉 Setup complete! All services are running.${NC}"
    echo -e "\n${BLUE}📋 Services Available:${NC}"
    echo -e "   ${YELLOW}🎨 Streamlit UI: http://localhost:$UI_PORT_LOCALHOST${NC}"
    echo -e "   ${YELLOW}🌐 React-UI: http://localhost:$REACT_UI_PORT_LOCALHOST${NC}"
    echo -e "   ${YELLOW}🧩 MCP Server (health): $MCP_URL/health${NC}"
    echo -e "   ${YELLOW}🧩 MCP HTTP Endpoint: $MCP_URL/mcp${NC}"
    echo -e "   ${YELLOW}📊 Prometheus: $PROMETHEUS_URL${NC}"
    echo -e "   ${YELLOW}🔍 TempoStack: $TEMPO_URL${NC}"
    if [ -n "$LOKI_SERVICE" ]; then
        echo -e "   ${YELLOW}📋 LokiStack: $LOKI_URL${NC}"
    fi
    echo -e "   ${YELLOW}🦙 LlamaStack: $LLAMA_STACK_URL${NC}"
    echo -e "   ${YELLOW}🤖 Llama Model: http://localhost:$LLAMA_MODEL_PORT_LOCALHOST${NC}"
    if [ "$START_PLUGIN" = "true" ]; then
        echo -e "   ${YELLOW}🔌 Plugin Dev Server: http://localhost:$PLUGIN_PORT_LOCALHOST${NC}"
        echo -e "   ${YELLOW}📄 Plugin Manifest: http://localhost:$PLUGIN_PORT_LOCALHOST/plugin-manifest.json${NC}"
    fi
    if [ "$START_CONSOLE" = "true" ]; then
        echo -e "   ${YELLOW}🖥️  OpenShift Console: http://localhost:$CONSOLE_PORT_LOCALHOST${NC}"
    fi
    
    # Show instructions based on what's running
    if [ "$START_CONSOLE" = "true" ]; then
        echo -e "\n${GREEN}🎯 OpenShift Console Plugin ready!${NC}"
        echo -e "   ${BLUE}Open: http://localhost:$CONSOLE_PORT_LOCALHOST${NC}"
        echo -e "   ${BLUE}Navigate to: Observe → AI Observability${NC}"
    elif [ "$START_PLUGIN" = "true" ]; then
        echo -e "\n${GREEN}💡 To test with OpenShift Console, run in a new terminal:${NC}"
        echo -e "   ${BLUE}cd openshift-plugin && yarn run start-console${NC}"
        echo -e "   ${BLUE}Then open: http://localhost:$CONSOLE_PORT_LOCALHOST${NC}"
        echo -e "\n${GREEN}   Or use the -o flag to start everything together:${NC}"
        echo -e "   ${BLUE}$0 -n $DEFAULT_NAMESPACE -p -o${NC}"
    else
        echo -e "\n${GREEN}🎯 Ready to use! Choose your UI:${NC}"
        echo -e "   ${BLUE}Streamlit UI: http://localhost:$UI_PORT_LOCALHOST${NC}"
        echo -e "   ${BLUE}React-UI: http://localhost:$REACT_UI_PORT_LOCALHOST${NC}"
    fi
    
    echo -e "\n${YELLOW}📝 Note: Keep this terminal open to maintain all services${NC}"
    echo -e "${YELLOW}Press Ctrl+C to stop all services and cleanup${NC}"

    # Keep script running
    wait
}

# Run main function
main "$@"
