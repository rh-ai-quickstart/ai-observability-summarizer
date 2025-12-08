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

### One-Command Setup (Recommended)

Start **everything** with a single command:

```bash
# From the project root directory
./scripts/local-dev.sh -n <your-namespace> -p -o
```

This starts:
- ✅ MCP Server (port 8085)
- ✅ Plugin dev server (port 9001)
- ✅ OpenShift Console (port 9000)
- ✅ All required port-forwards

Then open: **http://localhost:9000** → Navigate to **Observe → AI Observability**

### Manual Setup (Alternative)

If you prefer more control, you can start services separately:

```bash
# Terminal 1: Start MCP server + port-forwards + plugin
./scripts/local-dev.sh -n <your-namespace> -p

# Terminal 2: Start OpenShift Console
cd openshift-plugin
oc login https://api.your-cluster.com:6443
yarn run start-console
```

### Plugin-Only Development

For frontend-only changes (no MCP integration):

```bash
cd openshift-plugin
yarn install
yarn run start          # Terminal 1
yarn run start-console  # Terminal 2 (after oc login)
```

> **Note:** The plugin auto-detects the environment:
> - **Local dev** (`localhost`): Connects to `http://localhost:8085/mcp`
> - **Production**: Uses the OpenShift Console proxy

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
