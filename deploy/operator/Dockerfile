# Build the manager binary
FROM quay.io/operator-framework/helm-operator:v1.37.0

ENV HOME=/opt/helm
COPY watches.yaml ${HOME}/watches.yaml

# Copy helm-charts - use tar to resolve symlinks
COPY helm-charts ${HOME}/helm-charts

WORKDIR ${HOME}
