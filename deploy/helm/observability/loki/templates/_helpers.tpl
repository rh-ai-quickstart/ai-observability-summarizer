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
*/}}
{{- define "loki-stack.namespace" -}}
{{- default .Values.global.namespace .Release.Namespace }}
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
