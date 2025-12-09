{{/*
Validation helpers for aiobs-app
*/}}

{{/*
Validate required fields for RAG deployment
Fails the Helm release if HuggingFace token is not provided when RAG is enabled
*/}}
{{- define "aiobs-app.validateRag" -}}
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
    {{- fail "\n\nERROR: HuggingFace token is required when RAG is enabled.\nPlease provide 'aiobs-app.rag.llm-service.secret.hf_token' in your CR spec.\nGet a token at: https://huggingface.co/settings/tokens\n" }}
  {{- end }}
{{- end }}
{{- end }}

