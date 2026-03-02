# Argo CD / GitOps deployment for AI Observability Summarizer

This document captures **what we changed**, **what Argo CD will deploy**, and **what permissions/prereqs you need** to make the deployment equivalent to `make install`.

It is intended to be **meeting-ready** so you can share it with the Argo CD / OpenShift GitOps team.

---

## What Argo CD is doing (in one paragraph)

Argo CD runs in the cluster and continuously reconciles your desired Kubernetes state from Git into the cluster. You define one or more Argo CD `Application` objects that point at a Git repo path (raw YAML, Helm chart, or Kustomize overlay). Argo CD renders/apply those manifests to the target cluster/namespace, detects drift, and can self-heal/prune resources to match Git.

---

## What we added to this repo

We added a `gitops/` folder containing:

- **Bootstrap root app (app-of-apps)**: `gitops/bootstrap/root.yaml`
  - You create/apply this **once** in Argo CD (or `oc apply -f` it).
  - It points Argo CD at `gitops/apps/` which contains child `Application` YAMLs.

- **Child Argo CD Applications** (the real deployment units):
  - Platform/shared: `gitops/apps/platform/*.yaml`
  - App namespace: `gitops/apps/app/*.yaml`

- **Environment values (dev example)**: `gitops/environments/dev/*.yaml`
  - These are Helm `valueFiles` used by the Argo CD Applications.

- **Extra raw manifests** (things Makefile applied with `oc apply/patch`):
  - Cluster monitoring config: `gitops/manifests/cluster-monitoring/*`
  - Operator subscriptions: `gitops/manifests/operators/*`
  - OTel instrumentation + namespace annotation: `gitops/manifests/tracing/*`

---

## Repo structure (quick view)

```text
gitops/
  bootstrap/
    root.yaml                       # app-of-apps root Application
  apps/
    platform/
      cluster-monitoring.yaml       # enables UWM + Alertmanager for UWM
      operators.yaml                # installs operators via OLM Subscriptions (optional in prod)
      minio.yaml
      tempo.yaml
      otel-collector.yaml
      loki.yaml
      korrel8r.yaml
    app/
      tracing.yaml                  # Instrumentation CR + namespace injection annotation
      rag.yaml                      # llm-service + llama-stack + pgvector (optional)
      mcp-server.yaml
      metric-ui.yaml
      console-plugin.yaml           # OpenShift Console plugin (default path)
      react-ui.yaml                 # standalone React UI (dev/demo alternative)
      alerting.yaml                 # optional (if you enable alerts)
  environments/
    dev/
      *.yaml                        # sample values overrides
  manifests/
    cluster-monitoring/
      cluster-monitoring-config.yaml
      user-workload-monitoring.yaml
    operators/
      cluster-observability.yaml
      opentelemetry.yaml
      tempo.yaml
      logging.yaml
      loki.yaml
    tracing/
      namespace.yaml
      instrumentation.yaml
```

---

## “Does this match `make install`?” (mapping)

Your `Makefile` target:

```make
install: namespace enable-user-workload-monitoring depend validate-llm install-operators install-observability-stack install-metric-ui install-mcp-server delete-jobs
  ... then console-plugin OR react-ui
  ... then rag unless ENABLE_RAG=false
  ... then alerting if ALERTS=TRUE
```

Argo CD mapping (what we created):

| Makefile step | GitOps equivalent (Argo CD Application) | Notes |
|---|---|---|
| `enable-user-workload-monitoring` | `gitops/apps/platform/cluster-monitoring.yaml` | Applies ConfigMaps in `openshift-monitoring` and `openshift-user-workload-monitoring`. **Cluster-admin required**. |
| `install-operators` | `gitops/apps/platform/operators.yaml` | Applies OLM `Subscription` + `OperatorGroup` YAMLs. **Cluster-admin required** and depends on `openshift-marketplace`. Optional if platform team already manages operators. |
| `install-minio` | `gitops/apps/platform/minio.yaml` | Deploys MinIO in `observability-hub`. |
| `setup-tracing` | `gitops/apps/app/tracing.yaml` | Creates `Instrumentation` + annotates namespace for python injection. |
| `install-observability` (Tempo + OTEL + Loki) | `gitops/apps/platform/{tempo,otel-collector,loki}.yaml` | These create CRs like `TempoStack`/`LokiStack`. Operator CRDs must exist. We set `SkipDryRunOnMissingResource=true`. |
| `install-korrel8r` | `gitops/apps/platform/korrel8r.yaml` | Deploys Korrel8r chart in `openshift-cluster-observability-operator`. |
| `install-metric-ui` | `gitops/apps/app/metric-ui.yaml` | Deploys Streamlit UI chart. |
| `install-mcp-server` | `gitops/apps/app/mcp-server.yaml` | Deploys MCP server chart + ClusterRoleBindings for Thanos/Loki/Korrel8r access. |
| `install-console-plugin` | `gitops/apps/app/console-plugin.yaml` | Chart includes a patch job that enables the plugin in `consoles.operator.openshift.io/cluster`. |
| `install-react-ui` (DEV_MODE=true) | `gitops/apps/app/react-ui.yaml` | Separate UI path (OAuth proxy). Not mutually exclusive in GitOps unless you choose so. |
| `install-rag` (unless ENABLE_RAG=false) | `gitops/apps/app/rag.yaml` | **Helm dependencies must be handled for Argo CD** (see “RAG dependency caveat”). |
| `install-alerts` (ALERTS=TRUE) | `gitops/apps/app/alerting.yaml` | Requires Slack secret to exist. |

### What we did NOT fully “mimic” (on purpose)

The Makefile contains imperative cleanup and conditional logic that GitOps usually avoids:

- **Conditional “if exists then set value” checks**:
  - Example: Makefile checks whether `grafana-prometheus-reader` ClusterRole exists and toggles `rbac.createGrafanaRole`.
  - In GitOps we set this explicitly in `gitops/environments/dev/mcp-server-values.yaml` (`rbac.createGrafanaRole: false`).

- **Imperative cleanup**:
  - Example: Makefile deletes “broken upstream routes” for MinIO and deletes old Loki ClusterRoles.
  - In GitOps you normally **do not** run “cleanup commands”; instead you ensure the charts render the correct desired state and prune removes owned resources. (Manual cleanup may still be required for legacy conflicts.)

- **Console plugin enablement for logs/traces menus**:
  - Makefile patches the OpenShift console to enable `distributed-tracing-console-plugin` and `logging-console-plugin`.
  - We did not add GitOps ownership of those console plugin toggles in this template (it’s cluster-wide and usually platform-owned). Your **AIObs console plugin chart** does enable **your** plugin via its patch job.

---

## Namespaces and where things land

Argo CD can deploy to multiple namespaces. Each child `Application` has its own `spec.destination.namespace`.

In this template:

- **App namespace**: `openshift-ai-observability`
  - `mcp-server`, `metric-ui`, `rag`, `alerting`, console plugin release, tracing injection.

- **Observability stack**: `observability-hub`
  - MinIO, TempoStack, OTel Collector.

- **Logging stack**: `openshift-logging`
  - LokiStack CR.

- **Korrel8r**: `openshift-cluster-observability-operator`

- **Operators (OLM subscriptions)**:
  - `openshift-cluster-observability-operator`, `openshift-opentelemetry-operator`, `openshift-tempo-operator`, `openshift-logging`, `openshift-operators-redhat`.

---

## RBAC / permissions (what Argo CD must be allowed to do)

To be equivalent to `make install`, Argo CD (OpenShift GitOps) needs to be able to create:

- **Cluster-scoped resources**:
  - `ClusterRole`, `ClusterRoleBinding` (from charts like `mcp-server`, `openshift-console-plugin` patcher RBAC, and sometimes Loki).
  - `Subscription`, `OperatorGroup` (OLM) for operator installation.
  - Patch `consoles.operator.openshift.io/cluster` (console plugin enablement job).

- **Namespace-scoped resources** across multiple namespaces:
  - `openshift-ai-observability`, `observability-hub`, `openshift-logging`, `openshift-cluster-observability-operator`, etc.

If the Argo CD team does **not** want to grant these permissions, the common split is:

- **Platform team GitOps** manages: operators, cluster-monitoring config, observability stack namespaces/CRDs.
- **App team GitOps** manages: `mcp-server`, UIs, alerting, and app namespace resources.

---

## CRDs/operators sequencing (why sync waves + SkipDryRun are used)

Some charts create CRs like:
- `TempoStack` (`tempo.grafana.com/v1alpha1`)
- `LokiStack` (`loki.grafana.com/...`)
- OpenTelemetry `Instrumentation` (`opentelemetry.io/...`)

Those CRDs are provided by operators installed via OLM.

To avoid first-sync failures while CRDs are still coming up:
- We used **sync waves** (`argocd.argoproj.io/sync-wave`) so operators/config come earlier than CRs.
- We enabled `SkipDryRunOnMissingResource=true` on apps that apply CRs (Tempo/Loki/OTel/RAG) to reduce “CRD not found” errors during initial convergence.

---

## Secrets (what must NOT be plain text in Git)

The sample dev values include placeholders. For production GitOps you should use **ExternalSecrets** or **SealedSecrets** for:

- `alerting` Slack webhook secret (`alerts-secrets/slack-webhook-url`)
- `react-ui-app` OAuth `cookieSecret`
- Any API keys or model tokens (HF token, external LLM keys, etc.)

---

## RAG dependency caveat (important for Argo CD)

The `rag` chart has Helm dependencies from an external repo (see `deploy/helm/rag/Chart.yaml`).

For Argo CD to render/install it, you must do one of:

1) **Vendor dependencies**:
   - Run `helm dependency build deploy/helm/rag`
   - Commit `deploy/helm/rag/charts/` to Git

2) Configure Argo CD repo-server to build dependencies (platform choice).

Without this, `aiobs-app-rag` will fail to sync even though `make install` works (because Make runs `helm dependency update`).

---

## Answer: “Looking at `operators.yaml` — does it deploy itself?”

No. `gitops/apps/platform/operators.yaml` is an **Argo CD Application definition**.

How it works:

1) You create **one** root Application: `gitops/bootstrap/root.yaml`.
2) The root Application points Argo CD at `gitops/apps/`.
3) Argo CD reads the child Application YAMLs there, including `gitops/apps/platform/operators.yaml`.
4) That child Application tells Argo CD: “apply the YAML files found at `gitops/manifests/operators/` into the cluster”.

So the `path: gitops/manifests/operators` is **not** referencing the Application itself. It is referencing the directory that contains **OLM Subscription manifests** for operators.

---

## What you need to tell the Argo CD team (checklist)

- **Repo access**: Argo CD must be able to read this repo + branch.
- **Permissions**:
  - Do you allow Argo CD to create ClusterRoles/ClusterRoleBindings?
  - Do you allow Argo CD to manage OLM Subscriptions/OperatorGroups?
  - Do you allow Argo CD to patch `consoles.operator.openshift.io cluster` (console plugins)?
  - If not, define a platform/app split.
- **Helm dependency handling** for `deploy/helm/rag`.
- **Namespace policy**: allow Argo CD to deploy to `openshift-*` namespaces (or not).
- **Secrets solution**: ExternalSecrets / SealedSecrets / Vault integration.

---

## Quick “how to run” (high-level)

1) Update `repoURL` and `targetRevision` in `gitops/bootstrap/root.yaml` and in child apps under `gitops/apps/**`.
2) Decide which child apps you actually want enabled (console plugin vs react-ui, alerting on/off, rag on/off).
3) Ensure Argo CD has the required permissions (or split ownership).
4) Create the root application (in OpenShift GitOps UI or apply YAML).
5) Watch sync waves converge (operators/CRDs first, then CRs, then app).

