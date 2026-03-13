# GitOps / Argo CD template (sample)

This folder is a **learning template** that shows how to deploy this repo with **Argo CD** using Helm charts under `deploy/helm/`.

## What Argo CD does (one-liner)
Argo CD continuously applies the desired Kubernetes state from Git (Helm/Kustomize/YAML) into the cluster and can self-heal drift.

## Why keep the Makefile?
You **do not need to delete** the `Makefile`.

- **Makefile** is great for: local dev, manual installs, quick demos, bootstrapping a cluster.
- **Argo CD** is for: continuous, repeatable, auditable deployments driven by Git.

In GitOps, the *equivalent* of `make install ...` is: **commit a values change** → Argo syncs → cluster updates.

## Your namespaces/operators concern (how this works)
- Argo CD can deploy into **any namespace** you specify per Application (subject to Argo permissions).
- Your app can still query **Thanos/Prometheus** from `openshift-monitoring` because that is an existing OpenShift component; you just need the **RBAC bindings** (your `mcp-server` chart already includes ClusterRoleBindings).
- Operators (Tempo/Loki/OTel/COO) are usually a **platform prerequisite**. Argo CD typically deploys the *CRs/charts that rely on those operators*, not necessarily the operators themselves (at least at first).

## Important GitOps adjustments vs the Makefile
Some Makefile logic is imperative (runs `oc` checks/cleanup). In GitOps, you avoid that by configuring Helm values so Argo can apply declaratively:

- `mcp-server`: set `rbac.createGrafanaRole=false` in Git (because Makefile conditionally creates it).
- `loki`: decide `rbac.collector.create` explicitly (Makefile auto-detects). For clusters where OpenShift Logging manages the collector SA, set it to `false`.

## Does this fully mimic `make install`?
**Almost**. `make install` does all of the following:
- Enables **user workload monitoring** (cluster-level ConfigMaps)
- Installs **operators** via OLM subscriptions
- Installs the **observability stack** (MinIO, Tempo, OTEL Collector, Loki, Korrel8r)
- Applies **OTel auto-instrumentation** for your app namespace
- Installs **RAG backend services** (llm-service, llama-stack, pgvector) unless `ENABLE_RAG=false`
- Installs **Metric UI** + **MCP server**
- Installs **Console Plugin** (or React UI if `DEV_MODE=true`)

This template now includes Argo CD Applications for those pieces, with two caveats:
- The `rag` chart has **remote Helm dependencies**; Argo CD must be able to build/vend them (see `gitops/environments/dev/rag-values.yaml`).
- The cluster-level items (operators + monitoring ConfigMaps) require Argo CD to have **cluster-admin-like permissions**.

Also note: some charts create custom resources (e.g., `TempoStack`, `LokiStack`). Those depend on operator-installed CRDs.
The template sets `SkipDryRunOnMissingResource=true` on the relevant Applications to reduce “CRD not found” sync failures during first install.

## Files
- `bootstrap/root.yaml`: the “app-of-apps” root Application (apply/create this once)
- `apps/platform/*.yaml`: platform/shared child Applications
- `apps/app/*.yaml`: app namespace child Applications
- `environments/dev/*.yaml` and `environments/prod/*.yaml`: example values overlays

## How to use this
1) Push this repo to Git (or reference it from your GitOps repo).
2) In Argo CD, create **one** Application pointing at `gitops/apps/root.yaml` (or apply it with `oc apply`).
3) Argo CD will create/sync the child Applications.

