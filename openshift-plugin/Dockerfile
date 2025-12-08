# Simple Dockerfile that uses pre-built assets from local yarn build
# The Makefile runs 'yarn build' before building the container image

FROM registry.access.redhat.com/ubi9/nginx-120:latest

# Copy pre-built plugin assets (built by Makefile before docker build)
COPY dist /usr/share/nginx/html

USER 1001

ENTRYPOINT ["nginx", "-g", "daemon off;"]
