{{/*
Expand the name of the chart.
*/}}
{{- define "aiobs-stack.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "aiobs-stack.fullname" -}}
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
Common labels
*/}}
{{- define "aiobs-stack.labels" -}}
helm.sh/chart: {{ include "aiobs-stack.name" . }}
app.kubernetes.io/name: {{ include "aiobs-stack.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Validation helpers
*/}}

{{/*
Validate required fields for RAG deployment
Fails the Helm release if HuggingFace token is not provided when RAG is enabled
*/}}
{{- define "aiobs-stack.validateRag" -}}
{{- if .Values.rag.enabled }}
  {{- $hfToken := "" }}
  {{- if .Values.rag }}
    {{- if index .Values.rag "llm-service" }}
      {{- if index (index .Values.rag "llm-service") "secret" }}
        {{- $hfToken = index (index (index .Values.rag "llm-service") "secret") "hf_token" | default "" }}
      {{- end }}
    {{- end }}
  {{- end }}
  {{- if eq $hfToken "" }}
    {{- fail "\n\nERROR: HuggingFace token is required when RAG is enabled.\nPlease provide 'rag.llm-service.secret.hf_token' in your CR spec.\nGet a token at: https://huggingface.co/settings/tokens\n" }}
  {{- end }}
{{- end }}
{{- end }}

