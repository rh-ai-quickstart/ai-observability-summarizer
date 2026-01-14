# Simple Dockerfile that uses pre-built assets from local yarn build
# The Makefile runs 'yarn build' before building the container image

FROM registry.access.redhat.com/ubi9/nginx-120:latest

# Switch to root to set up files and permissions
USER 0

# Copy pre-built plugin assets (built by Makefile before docker build)
COPY dist /usr/share/nginx/html

# Ensure the html directory is writable by user 1001
RUN chown -R 1001:0 /usr/share/nginx/html && \
    chmod -R g+w /usr/share/nginx/html

# Switch back to non-root user
USER 1001

# Start nginx
# Runtime config is fetched from MCP server's /config endpoint instead
CMD ["nginx", "-g", "daemon off;"]
