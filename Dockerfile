# syntax=docker/dockerfile:1

# 1. Build the React frontend.
FROM node:22-alpine AS web
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# 2. Build the Go server with the frontend embedded.
FROM golang:1.26-alpine AS server
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=web /src/frontend/dist ./web/dist
ARG APP_VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/nanoditor ./cmd/nanoditor

# 3. Small runtime with the real git and ssh.
FROM alpine:3.20
RUN apk add --no-cache git openssh-client ripgrep ca-certificates tzdata \
 && git config --system safe.directory '*' \
 # ssh refuses to run for a uid without a passwd entry, so mirror the host user.
 && adduser -D -u 1000 -h /home/ken -s /bin/sh ken
COPY --from=server /out/nanoditor /usr/local/bin/nanoditor
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
USER 1000:1000
EXPOSE 7777
ENTRYPOINT ["/usr/local/bin/nanoditor"]
