{{/*
Expand the name of the chart.
*/}}
{{- define "loki-stack.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "loki-stack.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "loki-stack.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "loki-stack.labels" -}}
helm.sh/chart: {{ include "loki-stack.chart" . }}
{{ include "loki-stack.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/component: loki
app.kubernetes.io/part-of: observability
{{- end }}

{{/*
Selector labels
*/}}
{{- define "loki-stack.selectorLabels" -}}
app.kubernetes.io/name: {{ include "loki-stack.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
MinIO labels for Loki storage components
*/}}
{{- define "loki-stack.minioLabels" -}}
helm.sh/chart: {{ include "loki-stack.chart" . }}
app.kubernetes.io/name: minio-loki
app.kubernetes.io/instance: {{ .Release.Name }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/component: storage
app.kubernetes.io/part-of: observability
{{- end }}

{{/*
MinIO selector labels for Loki
*/}}
{{- define "loki-stack.minioSelectorLabels" -}}
app.kubernetes.io/name: minio-loki
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the namespace to use
Priority: .Values.global.namespace > .Release.Namespace
*/}}
{{- define "loki-stack.namespace" -}}
{{- default .Release.Namespace .Values.global.namespace }}
{{- end }}

{{/*
Create a cluster-scoped resource name that includes namespace to avoid conflicts.
This is used for ClusterRole and ClusterRoleBinding names to ensure uniqueness
across different Helm releases and namespaces.
*/}}
{{- define "loki-stack.clusterResourceName" -}}
{{- $fullname := include "loki-stack.fullname" . -}}
{{- $namespace := include "loki-stack.namespace" . -}}
{{- printf "%s-%s" $namespace $fullname | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Detect storage class to use for LokiStack.
Tries multiple strategies in order:
1. Use explicitly provided value (if not empty or "auto")
2. Detect cluster default storage class using lookup
3. Fall back to "gp3" (AWS default)

Usage: {{ include "loki-stack.storageClass" . }}
*/}}
{{- define "loki-stack.storageClass" -}}
{{- $providedSC := .Values.lokiStack.storageClassName -}}
{{- if and $providedSC (ne $providedSC "auto") (ne $providedSC "") -}}
  {{- $providedSC -}}
{{- else -}}
  {{- $defaultSC := "" -}}
  {{- $storageClasses := lookup "storage.k8s.io/v1" "StorageClass" "" "" -}}
  {{- if $storageClasses -}}
    {{- range $storageClasses.items -}}
      {{- if and .metadata.annotations (or (eq (index .metadata.annotations "storageclass.kubernetes.io/is-default-class") "true") (eq (index .metadata.annotations "storageclass.beta.kubernetes.io/is-default-class") "true")) -}}
        {{- $defaultSC = .metadata.name -}}
      {{- end -}}
    {{- end -}}
  {{- end -}}
  {{- if $defaultSC -}}
    {{- $defaultSC -}}
  {{- else -}}
    gp3
  {{- end -}}
{{- end -}}
{{- end }}
