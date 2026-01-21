# OpenShift AI Observability - React UI Helm Chart

This Helm chart deploys the React UI web application for OpenShift AI Observability as a standalone application with OpenShift OAuth authentication.

## Prerequisites

- OpenShift cluster (4.12+)
- Helm 3.x
- MCP Server deployed and accessible

## Installation

### Quick Start

```bash
helm install ai-obs-react-ui . -n openshift-ai-observability --create-namespace
```

### Custom Configuration

```bash
helm install ai-obs-react-ui . -n openshift-ai-observability \
  --set app.image.tag=v1.0.0 \
  --set app.replicas=3 \
  --set route.host=ai-obs.apps.example.com
```

### With Custom Values File

```bash
helm install ai-obs-react-ui . -f custom-values.yaml -n openshift-ai-observability
```

## Configuration

### Application Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `app.name` | Application name | `ai-observability-ui` |
| `app.replicas` | Number of replicas | `2` |
| `app.image.repository` | Image repository | `quay.io/ecosystem-appeng/aiobs-react-ui` |
| `app.image.tag` | Image tag | `latest` |
| `app.image.pullPolicy` | Image pull policy | `Always` |
| `app.port` | Application port | `8080` |
| `app.resources.limits.cpu` | CPU limit | `500m` |
| `app.resources.limits.memory` | Memory limit | `512Mi` |
| `app.resources.requests.cpu` | CPU request | `100m` |
| `app.resources.requests.memory` | Memory request | `128Mi` |

### Service Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `service.type` | Service type | `ClusterIP` |
| `service.port` | Service port | `8080` |
| `service.targetPort` | Target port | `8080` |

### Route Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `route.enabled` | Enable OpenShift Route | `true` |
| `route.host` | Route hostname (auto-generated if empty) | `""` |
| `route.path` | Route path | `/` |
| `route.tls.enabled` | Enable TLS | `true` |
| `route.tls.termination` | TLS termination type (auto-set to reencrypt when OAuth enabled) | `edge` |
| `route.tls.insecureEdgeTerminationPolicy` | Insecure traffic policy | `Redirect` |

### OAuth Proxy Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `oauth.enabled` | Enable OAuth proxy | `true` |
| `oauth.image.repository` | OAuth proxy image | `quay.io/openshift/origin-oauth-proxy` |
| `oauth.image.tag` | OAuth proxy tag | `4.14` |
| `oauth.port` | OAuth proxy port | `8443` |
| `oauth.cookieSecret` | Cookie secret (auto-generated if empty) | `""` |
| `oauth.cookieExpire` | Cookie expiration | `24h` |

### MCP Server Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `mcpServer.serviceName` | MCP server service name | `mcp-server-svc` |
| `mcpServer.port` | MCP server port | `8085` |
| `mcpServer.namespace` | MCP server namespace (uses release namespace if empty) | `""` |

## Architecture

### Deployment Components

```
┌─────────────────────────────────────────┐
│  OpenShift Route (HTTPS)                │
│  https://ai-obs.apps.cluster.com        │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Service (ClusterIP)                    │
│  - Port 8443 (OAuth Proxy)              │
│  - Port 8080 (React UI)                 │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Deployment (2 replicas)                │
│  ┌───────────────────────────────────┐  │
│  │  Pod                              │  │
│  │  ┌─────────────┐  ┌─────────────┐│  │
│  │  │ OAuth Proxy │  │  React UI   ││  │
│  │  │  (Sidecar)  │  │  (nginx)    ││  │
│  │  │  Port 8443  │─▶│  Port 8080  ││  │
│  │  └─────────────┘  └─────────────┘│  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  MCP Server                             │
│  http://mcp-server-svc:8085/mcp         │
└─────────────────────────────────────────┘
```

### Authentication Flow

1. User accesses Route URL
2. OAuth Proxy intercepts request
3. User redirected to OpenShift OAuth login
4. After authentication, OAuth Proxy sets secure cookie
5. Requests forwarded to React UI app
6. React UI communicates with MCP Server

## Accessing the Application

### Get Route URL

```bash
oc get route aiobs-react-ui -n openshift-ai-observability -o jsonpath='{.spec.host}'
```

### Access in Browser

```bash
echo "https://$(oc get route aiobs-react-ui -n openshift-ai-observability -o jsonpath='{.spec.host}')"
```

## Uninstallation

```bash
helm uninstall ai-obs-react-ui -n openshift-ai-observability
```

## Troubleshooting

### Check Pod Status

```bash
oc get pods -n openshift-ai-observability -l app=aiobs-react-ui
```

### View Logs

```bash
# React UI logs
oc logs -n openshift-ai-observability -l app=aiobs-react-ui -c ui

# OAuth Proxy logs
oc logs -n openshift-ai-observability -l app=aiobs-react-ui -c oauth-proxy
```

### Check Route

```bash
oc describe route aiobs-react-ui -n openshift-ai-observability
```

### Test Health Endpoint

```bash
oc exec -n openshift-ai-observability deployment/aiobs-react-ui -c ui -- curl localhost:8080/health
```

### Common Issues

**Issue: OAuth login loop**
- Check service account annotations
- Verify OAuth proxy cookie secret is set
- Check Route TLS configuration

**Issue: Cannot connect to MCP Server**
- Verify MCP Server service name and namespace
- Check network policies
- Test connectivity: `oc exec deployment/aiobs-react-ui -c ui -- curl http://mcp-server-svc:8085/mcp`

**Issue: 404 on page refresh**
- Nginx configuration should serve index.html for all routes (already configured)
- Check nginx logs for routing issues

## Upgrading

```bash
helm upgrade ai-obs-react-ui . -n openshift-ai-observability
```

## Development

### Build and Push Image

```bash
# From openshift-plugin directory
docker build -f Dockerfile.react-ui -t quay.io/ecosystem-appeng/aiobs-react-ui:v1.0.0 .
docker push quay.io/ecosystem-appeng/aiobs-react-ui:v1.0.0
```

### Install with Custom Image

```bash
helm install ai-obs-react-ui . -n openshift-ai-observability \
  --set app.image.repository=quay.io/myorg/aiobs-react-ui \
  --set app.image.tag=dev \
  --set app.image.pullPolicy=Always
```

## Support

For issues and questions, please refer to the main project documentation.
