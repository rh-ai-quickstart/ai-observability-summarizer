#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
helm_root="$repo_root/deploy/helm"
umbrella="$helm_root/aiobs-stack"

# The shared S4 chart and RAG dependencies are pinned packages. The remaining
# umbrella dependencies are local charts, so rebuild them from this checkout.
for package in \
  "$umbrella/charts/aws-compatible-storage-0.1.0.tgz" \
  "$helm_root/rag/charts/llm-service-0.5.9.tgz" \
  "$helm_root/rag/charts/llama-stack-0.8.6.tgz" \
  "$helm_root/rag/charts/pgvector-0.5.5.tgz"; do
  if [[ ! -f "$package" ]]; then
    printf 'Missing pinned Helm package: %s\n' "$package" >&2
    printf 'Restore the packaged chart from this repository before deploying.\n' >&2
    exit 1
  fi
done

# Remove archives from older local chart versions and the former storage charts.
# Helm can render an undeclared chart left in charts/, so keeping only the
# pinned shared S4 archive before repackaging also prevents a MinIO reappearance.
shopt -s nullglob
for package in \
  "$umbrella/charts"/aws-compatible-storage-*.tgz \
  "$umbrella/charts"/tempo-stack-*.tgz \
  "$umbrella/charts"/loki-stack-*.tgz \
  "$umbrella/charts"/otel-collector-*.tgz \
  "$umbrella/charts"/korrel8r-*.tgz \
  "$umbrella/charts"/mcp-server-*.tgz \
  "$umbrella/charts"/openshift-console-plugin-*.tgz \
  "$umbrella/charts"/alerts-*.tgz \
  "$umbrella/charts"/rag-*.tgz \
  "$umbrella/charts"/minio-*.tgz \
  "$umbrella/charts"/object-storage-*.tgz \
  "$umbrella/charts"/s4-*.tgz; do
  [[ "$package" == "$umbrella/charts/aws-compatible-storage-0.1.0.tgz" ]] && continue
  rm -f -- "$package"
done
for legacy_dir in \
  "$umbrella/charts/minio" \
  "$umbrella/charts/minio-observability-storage" \
  "$umbrella/charts/object-storage" \
  "$umbrella/charts/s4" \
  "$umbrella/charts/aws-compatible-storage"; do
  if [[ -d "$legacy_dir" ]]; then
    rm -rf -- "$legacy_dir"
  fi
done

for chart in \
  observability/tempo \
  observability/loki \
  observability/otel-collector \
  observability/korrel8r \
  mcp-server \
  openshift-console-plugin \
  alerting \
  rag; do
  helm package "$helm_root/$chart" --destination "$umbrella/charts" >/dev/null
done

# Helm validates every declared dependency even with --show-only. This render
# catches a missing or stale package before the S4 bucket Job is applied.
helm template aiobs-stack "$umbrella" \
  --namespace ai-observability \
  --set rag.enabled=false \
  --show-only templates/s4-bucket-bootstrap-job.yaml >/dev/null

printf 'Packaged aiobs-stack dependencies from local charts.\n'
