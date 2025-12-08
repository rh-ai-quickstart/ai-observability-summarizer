# OpenShift AI Observability Console Plugin

An OpenShift Console dynamic plugin that provides AI-powered observability for vLLM and OpenShift workloads.

## Features

- **Overview Dashboard** – Quick status cards, health indicators, and navigation
- **vLLM Metrics** – GPU utilization, inference throughput, latency, KV cache metrics with sparklines
- **OpenShift Metrics** – Cluster-wide and namespace-scoped metrics across 11 categories
- **AI Analysis** – LLM-powered insights using configurable AI models
- **Settings** – Configure internal or external AI models with API key support

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Yarn](https://yarnpkg.com/) 1.22+
- [Podman](https://podman.io/) 3.2+ or [Docker](https://www.docker.com/)
- [oc CLI](https://console.redhat.com/openshift/downloads)
- Access to an OpenShift 4.12+ cluster

## Local Development

### Quick Start

```bash
# 1. Install dependencies
cd openshift-plugin
yarn install

# 2. Start the plugin dev server (Terminal 1)
yarn run start

# 3. Login to your OpenShift cluster (Terminal 2)
oc login https://api.your-cluster.com:6443

# 4. Start the local OpenShift Console (Terminal 2)
yarn run start-console

# 5. Open browser
open http://localhost:9000
```

The plugin will be available at **Observe → AI Observability** in the console.

### Testing with MCP Server

For full functionality (metrics, AI analysis), you need the MCP server running locally:

```bash
# From the project root directory (not openshift-plugin)
cd ..

# Option A: Use the local-dev script (recommended)
./scripts/local-dev.sh -n <your-namespace> -p

# Option B: Start MCP server manually
uv run python -m mcp_server.api
```

The MCP server runs on `http://localhost:8085`.

> **How does this work?** The plugin automatically detects the environment:
> - **Local dev** (`localhost:9000`): Connects directly to `http://localhost:8085/mcp`
> - **Production** (OpenShift): Uses the Console proxy at `/api/proxy/plugin/.../mcp`
>
> No code changes needed—just start the MCP server locally!

### What Each Terminal Does

| Terminal | Command | Purpose |
|----------|---------|---------|
| 1 | `yarn run start` | Webpack dev server for plugin (port 9001) |
| 2 | `yarn run start-console` | OpenShift Console container (port 9000) |
| 3 | `./scripts/local-dev.sh -n <ns> -p` | MCP server + port forwards (port 8085) |

### Apple Silicon (M1/M2/M3) Setup

If using Podman on Apple Silicon, you may need to enable x86 emulation:

```bash
podman machine ssh
sudo -i
rpm-ostree install qemu-user-static
systemctl reboot
```

### Troubleshooting Local Dev

**Plugin not loading in console?**
- Ensure `yarn run start` is running and shows no errors
- Check http://localhost:9001/plugin-manifest.json returns valid JSON
- Restart `yarn run start-console`

**MCP Server disconnected?**
- Verify MCP server is running: `curl http://localhost:8085/health`
- Check browser console for connection errors

**Console container fails to start?**
- Ensure `oc login` was successful: `oc whoami`
- Check Podman/Docker is running: `podman ps` or `docker ps`

## Building & Deployment

### Build the Plugin Image

```bash
# From project root
make build-console-plugin

# Or manually
cd openshift-plugin
yarn install && yarn build
podman build -t quay.io/your-org/aiobs-console-plugin:latest .
```

### Push to Registry

```bash
make push-console-plugin

# Or manually
podman push quay.io/your-org/aiobs-console-plugin:latest
```

### Deploy to OpenShift

```bash
# Using Makefile (recommended)
make install-console-plugin NAMESPACE=your-namespace

# Or using Helm directly
helm upgrade -i openshift-ai-observability \
  charts/openshift-console-plugin \
  -n your-namespace \
  --create-namespace \
  --set plugin.image=quay.io/your-org/aiobs-console-plugin:latest
```

### Enable the Plugin

After deployment, enable the plugin in the OpenShift Console:

1. Go to **Administration → Cluster Settings → Configuration → Console**
2. Click **Console plugins** tab
3. Enable **openshift-ai-observability**

Or via CLI:
```bash
oc patch console.operator.openshift.io cluster \
  --type=merge \
  --patch='{"spec":{"plugins":["openshift-ai-observability"]}}'
```

## Project Structure

```
openshift-plugin/
├── src/
│   ├── pages/           # Main page components
│   │   ├── AIObservabilityPage.tsx   # Overview dashboard
│   │   ├── VLLMMetricsPage.tsx       # vLLM metrics
│   │   ├── OpenShiftMetricsPage.tsx  # OpenShift metrics
│   │   └── AIChatPage.tsx            # AI chat interface
│   ├── components/      # Reusable components
│   └── services/
│       └── mcpClient.ts # MCP server communication
├── charts/              # Helm chart for deployment
├── console-extensions.json  # Plugin extension points
└── package.json         # Plugin metadata & dependencies
```

## Configuration

### MCP Server Proxy

The plugin communicates with the MCP server through the OpenShift Console proxy. This is configured in the Helm chart:

```yaml
# charts/openshift-console-plugin/values.yaml
plugin:
  proxy:
    - alias: mcp
      endpoint:
        service:
          name: mcp-server-svc
          namespace: "{{ .Release.Namespace }}"
          port: 8085
        type: Service
```

### AI Model Settings

Users can configure AI models in the plugin's Settings modal:
- **Internal models**: LlamaStack models running in-cluster
- **External models**: OpenAI, Anthropic, Google with API keys

Settings are stored in browser localStorage.

## Development Notes

- Uses **React 17** (required by OpenShift Console)
- Uses **PatternFly 5** for UI components
- TypeScript strict mode enabled
- Webpack module federation for dynamic loading

## References

- [Console Dynamic Plugin SDK](https://github.com/openshift/console/tree/master/frontend/packages/console-dynamic-plugin-sdk)
- [PatternFly 5 Documentation](https://www.patternfly.org/v5/)
- [OpenShift Console Plugin Template](https://github.com/openshift/console-plugin-template)
