# TempoStack Helm Chart

This chart creates the TempoStack custom resource in `observability-hub`. Tempo stores traces in the S4 `tempo` bucket. The shared aws-compatible-storage (S4) chart runs in `ai-observability`, installed by the parent `aiobs-stack` chart or the standalone Make target.

## Storage configuration

- S3 service: `http://s4.ai-observability.svc.cluster.local:7480`
- Bucket: `tempo`
- Credentials: the `s4-tempo-credentials` Secret in `observability-hub`
- S4 credentials: the umbrella chart mirrors its `aws-compatible-storage.s3` values into the Tempo namespace; a standalone Tempo chart install creates the Secret from `s4.s3`
- S3 API Route: disabled; clients inside the cluster use the service endpoint

When installing components with Make, `helm_tempo_args` sets the credentials and S4 namespace endpoint. Re-running `make install` upgrades an existing Tempo release to use the S4 Secret; historical objects in MinIO are not copied.

## Install

Install the complete stack after its operators are ready:

```bash
make install-observability-stack NAMESPACE=your-namespace
```

For individual installs, deploy S4 first, then Tempo and the collector:

```bash
make install-s4
make install-observability
```

`make install-s4` creates the `tempo` and `loki` buckets with the parent chart's regular boto3 Job. The S4 chart requests a 10Gi PVC. Configure non-demo S3 and UI credentials before deploying to a shared cluster.

## Verify

```bash
oc get deployment s4 -n ai-observability
oc get pvc s4-data -n ai-observability
oc get tempostack -n observability-hub
oc get secret s4-tempo-credentials -n observability-hub
```

OpenShift Console users can view traces under **Observe → Traces** when the Cluster Observability Operator UI plugin is installed.

## Troubleshoot

Check Tempo and S4 separately:

```bash
oc get pods -n observability-hub
oc logs -n observability-hub deployment/tempo-tempostack-gateway --tail=50
oc get pods,pvc -n ai-observability | grep s4
```

If Tempo reports S3 authentication or connection errors, compare `s4-tempo-credentials` with `s4-credentials` and verify that the S4 Service is reachable on port `7480`. The default UI Route serves the S4 console on port `5000`; it does not expose the S3 API.
