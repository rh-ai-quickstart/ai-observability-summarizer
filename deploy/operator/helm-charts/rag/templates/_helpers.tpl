{{/*
RAG Chart Helpers

This helper enables the selected model from the OLM UI dropdown.
The OLM UI sets .Values.selectedModel to the model name.
This template creates a ConfigMap that documents the selected model.
The actual model enablement happens via the global.models values.
*/}}

{{- define "rag.selectedModel" -}}
{{- .Values.selectedModel | default "llama-3-1-8b-instruct" -}}
{{- end -}}

{{- define "rag.deviceType" -}}
{{- (index .Values "llm-service").device | default "gpu" -}}
{{- end -}}

