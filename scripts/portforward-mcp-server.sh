#!/bin/bash

# AI Observability Metric Summarizer - MCP Server Port Forward Script
# This script sets up port-forwarding ONLY for the MCP server deployed in OpenShift

# Source common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Configuration
MCP_PORT=${MCP_PORT:-8085}
MCP_REMOTE_PORT=8085

echo -e "${BLUE}🚀 MCP Server Port Forward Setup${NC}"
echo "=============================================================="

# Function to display usage
usage() {
    echo "Usage: $0 -n NAMESPACE [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -n/-N NAMESPACE              Namespace where MCP server is deployed (required)"
    echo "  -p/-P PORT                   Local port for MCP server (default: 8085)"
    echo "  -h                           Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 -n my-namespace                    # Port forward MCP server on default port 8085"
    echo "  $0 -N my-namespace                    # Same as above (uppercase option)"
    echo "  $0 -n my-namespace -p 9000            # Port forward MCP server on port 9000"
    echo ""
    echo "After port-forwarding is established, you can test the MCP server with:"
    echo "  python scripts/chatbot_mcp_cli_example.py --test llama --mcp-url http://localhost:8085"
}

# Function to parse command line arguments
parse_args() {
    # Check if no arguments provided
    if [ $# -eq 0 ]; then
        usage
        exit 2
    fi

    NAMESPACE=""

    # Parse standard arguments using getopts
    while getopts "n:N:p:P:h" opt; do
        case $opt in
            n|N) NAMESPACE="$OPTARG"
                 ;;
            p|P) MCP_PORT="$OPTARG"
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
    if [ -z "$NAMESPACE" ]; then
        echo -e "${RED}❌ Namespace is required. Please specify using -n or -N${NC}"
        usage
        exit 1
    fi
}

# Function to cleanup on exit
cleanup() {
    # Prevent multiple cleanup calls
    if [ "$CLEANUP_DONE" = "true" ]; then
        return
    fi
    CLEANUP_DONE=true

    echo -e "\n${YELLOW}🧹 Cleaning up port-forward...${NC}"
    pkill -f "oc port-forward.*$MCP_RESOURCE_NAME" || true
    echo -e "${GREEN}✅ Cleanup complete${NC}"
}

# Function to check prerequisites
check_prerequisites() {
    echo -e "${BLUE}🔍 Checking prerequisites...${NC}"
    check_tool_exists "oc"
    check_openshift_login
    echo -e "${GREEN}✅ Prerequisites check passed${NC}"
}

# Ensure a TCP port is free by terminating any process listening on it
ensure_port_free() {
    local port=$1
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  Port $port is in use. Attempting to free it...${NC}"
        # Try graceful termination first
        lsof -nP -iTCP:"$port" -sTCP:LISTEN -t | xargs -r kill || true
        sleep 1
        # Force kill if still listening
        if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
            lsof -nP -iTCP:"$port" -sTCP:LISTEN -t | xargs -r kill -9 || true
        fi
        if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
            echo -e "${RED}❌ Could not free port $port. Please free it and retry.${NC}"
            exit 1
        fi
        echo -e "${GREEN}✅ Port $port is now free${NC}"
    fi
}

# Function to find and start MCP server port forward
start_mcp_port_forward() {
    echo -e "${BLUE}🔍 Finding MCP server and starting port-forward...${NC}"

    MCP_RESOURCE_NAME=$(oc get services -n "$NAMESPACE" -o name | grep mcp-server)

    if [ -z "$MCP_RESOURCE_NAME" ]; then
        echo -e "${RED}❌ No MCP server service found in namespace: $NAMESPACE${NC}"
        echo -e "${YELLOW}Please verify the namespace and that the MCP server is deployed${NC}"
        echo -e "${YELLOW}Available services in namespace:${NC}"
        oc get svc -n "$NAMESPACE"
        exit 1
    fi

    echo -e "${GREEN}✅ Found MCP server service: $MCP_RESOURCE_NAME${NC}"

    # Ensure port is free before starting port-forward
    ensure_port_free "$MCP_PORT"

    # Create port-forward
    echo -e "${BLUE}🔗 Starting port-forward on port $MCP_PORT...${NC}"
    oc port-forward "$MCP_RESOURCE_NAME" "$MCP_PORT:$MCP_REMOTE_PORT" -n "$NAMESPACE" >/dev/null 2>&1 &
    PF_PID=$!

    # Wait for port-forward to establish
    sleep 3

    # Test MCP server health
    if curl -s --connect-timeout 5 "http://localhost:$MCP_PORT/health" | grep -q '"status"'; then
        echo -e "${GREEN}✅ MCP Server port-forward established successfully${NC}"
        echo -e "${GREEN}   🧩 MCP Server (health): http://localhost:$MCP_PORT/health${NC}"
        echo -e "${GREEN}   🧩 MCP HTTP Endpoint: http://localhost:$MCP_PORT/mcp${NC}"
    else
        echo -e "${YELLOW}⚠️  Port-forward started but health check failed${NC}"
        echo -e "${YELLOW}   The MCP server might still be starting up${NC}"
        echo -e "${YELLOW}   You can verify manually: curl http://localhost:$MCP_PORT/health${NC}"
    fi
}

# Main execution
main() {
    parse_args "$@"
    check_prerequisites

    # Set cleanup trap
    trap cleanup EXIT INT TERM

    echo ""
    echo -e "${BLUE}--------------------------------${NC}"
    echo -e "${BLUE}Configuration:${NC}"
    echo -e "${BLUE}  NAMESPACE: $NAMESPACE${NC}"
    echo -e "${BLUE}  MCP_PORT: $MCP_PORT${NC}"
    echo -e "${BLUE}--------------------------------${NC}\n"

    start_mcp_port_forward

    echo -e "\n${GREEN}🎉 Port-forward setup complete!${NC}"
    echo -e "\n${BLUE}📋 Next Steps:${NC}"
    echo -e "   1. Keep this terminal open to maintain the port-forward"
    echo -e "   2. In another terminal, run the chatbot example:"
    echo -e "      ${YELLOW}python scripts/chatbot_mcp_cli_example.py --test llama --mcp-url http://localhost:$MCP_PORT${NC}"
    echo -e "      OR run the following to see all the options"
    echo -e "      ${YELLOW}python scripts/chatbot_mcp_cli_example.py --help${NC}"
    echo -e "\n${YELLOW}📝 Note: Press Ctrl+C to stop the port-forward${NC}"

    # Keep script running
    wait
}

# Run main function
main "$@"
