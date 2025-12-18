# Build the catalog image
FROM quay.io/operator-framework/opm:latest

# Copy the catalog
COPY catalog /configs

# Set the label for the catalog
LABEL operators.operatorframework.io.index.configs.v1=/configs

# Expose grpc port
EXPOSE 50051

# Set entrypoint
ENTRYPOINT ["/bin/opm"]
CMD ["serve", "/configs", "--cache-dir=/tmp/cache"]

