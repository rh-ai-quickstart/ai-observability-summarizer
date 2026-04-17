# Claude Desktop Integration Guide

>  **Official MCP Documentation**: For MCP setup and configuration, see the [Model Context Protocol User Guide](https://modelcontextprotocol.io/quickstart/user)

## 🚀 Quick Start

### 1. Automated Setup (Recommended)

**One-Command Setup:**
```bash
# Navigate to MCP server directory
cd src/mcp_server

# Run automated setup script (auto-detects all paths)
python setup_integration.py
```

This will automatically:
- 🔍 Detect your project paths and virtual environment
- 📁 Backup any existing Claude Desktop configuration
- ⚙️ Generate the configuration with the MCP functions  
- ✅ Validate the JSON and test the MCP server
- 📋 Show you the next steps

### 2. Manual Configuration (Alternative)

If you prefer manual setup or need to customize the configuration:

**Copy existing config:**
```bash
cp src/mcp_server/integrations/claude-desktop-config.json \
   ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

**Manual JSON (replace `$OBS_BASE_DIR` with your project path). Tool list shown should match registered tools (`list_models`, `list_vllm_namespaces`, `get_model_config`, `analyze_vllm`). Include these env vars:**

```json
{
  "mcpServers": {
    "ai-observability": {
      "command": "$OBS_BASE_DIR/.venv/bin/obs-mcp-server",
      "args": ["--local"],
      "env": {
        "PROMETHEUS_URL": "http://localhost:9090",
        "LLAMA_STACK_URL": "http://localhost:8321/v1",
        "MODEL_CONFIG": "<your model config JSON>",
        "THANOS_TOKEN": "<oc whoami -t>"
      },
      "autoApprove": [
        "list_models",
        "list_vllm_namespaces",
        "get_model_config",
        "analyze_vllm"
      ],
      "alwaysAllow": [
        "list_models",
        "list_vllm_namespaces",
        "get_model_config",
        "analyze_vllm"
      ],
      "disabled": false
    }
  }
}
```

**⚠️ Important Notes:**
- Replace `$OBS_BASE_DIR` with your actual project path (e.g., `/home/user/projects/openshift-ai-observability-summarizer`)
- Make sure the `.venv/bin/obs-mcp-server` file exists and is executable
- The configuration includes all MCP functions with auto-approval

### Portable Path Detection

The setup script automatically detects your project location and generates portable paths. It will:
- 🔍 Find your project root by looking for `pyproject.toml` and `src/` directory
- 🎯 Detect your virtual environment (`.venv` or `venv`)
- 🔧 Generate the correct executable path for your operating system
- ✅ Work regardless of where you've placed the project on your system

No manual path configuration needed!

### 3. Claude Desktop Configuration Location

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

### 4. Test the Integration

1. **Start development environment** (in terminal):
   ```bash
   cd $OBS_BASE_DIR
   scripts/local-dev.sh
   ```

2. **Restart Claude Desktop** to load the new configuration

3. **Test in Claude** with queries like:
   - "What models are available?"
   - "What namespaces exist?"
   - "List models in namespace m3"
   - "Analyze model 'myns | llama-3' for the last hour"
   - "Get GPU metrics for the last hour"
   - "Show me vLLM metrics"
   - "Get OpenShift metrics for 30 minutes"
   - "Show me critical alerts in namespace 'm3'"
   - "What alerts are firing?"
   - "Get warning alerts from last 24 hours"
   - "What is the latency in the past 5 hours?"
   - "GPU usage trends for my model"
   - "Are there any performance issues?"



### Quick Verification (if you used setup_integration.py)
The setup script already validated everything! Just check the output showed:
- ✅ Configuration file is valid JSON  
- ✅ MCP server test successful
- ✅ All components working

### Manual Verification (if needed)
```bash
# Check configuration file exists and is valid JSON
ls -la ~/Library/Application\ Support/Claude/claude_desktop_config.json
python -m json.tool ~/Library/Application\ Support/Claude/claude_desktop_config.json

# Test MCP server
cd src/mcp_server && python setup_integration.py

# Test Prometheus connectivity  
curl -s http://localhost:9090/api/v1/query?query=up | python -m json.tool
```

**Expected Output:**
- ✅ Configuration file exists and is valid JSON
- ✅ MCP server starts without errors
- ✅ All 5 functions test successfully 
- ✅ Prometheus returns metric data

## 🔧 Troubleshooting

### Server Not Starting
```bash
# Test configuration
obs-mcp-server --test-config

# Check server startup
obs-mcp-server --local
```

### No Data Available
- Ensure Prometheus port forwarding is running: `scripts/local-dev.sh`
- Check that vLLM models are deployed and generating metrics
- Verify `PROMETHEUS_URL=http://localhost:9090` is accessible

### Claude Desktop Issues
- Check Claude Desktop logs for connection errors
- Verify the configuration file path and syntax
- Restart Claude Desktop after configuration changes

