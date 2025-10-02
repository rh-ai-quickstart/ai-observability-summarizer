FROM golang:1.22-alpine AS builder
WORKDIR /workspace
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /workspace/alert-example main.go

FROM gcr.io/distroless/base-debian12:nonroot
WORKDIR /
COPY --from=builder /workspace/alert-example /alert-example
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/alert-example"]

