SHELL := /bin/bash
TS_IP := $(shell tailscale ip -4 2>/dev/null | head -1)
VERSION := $(shell date +%Y.%m.%d-%H%M)

.PHONY: help web dev dev-api dev-web test up down logs restart status

help:
	@echo "make up       build and (re)start the container"
	@echo "make down     stop the container"
	@echo "make logs     follow container logs"
	@echo "make test     run backend and frontend tests"
	@echo "make dev      run API (:7778) + Vite (:7779) for development"
	@echo "Open http://$(TS_IP):7777 on the phone"

# Build the frontend into the Go embed directory (for running the binary outside Docker).
web:
	cd frontend && npm ci --no-audit --no-fund && npm run build
	rm -rf backend/web/dist && cp -r frontend/dist backend/web/dist

dev:
	@trap 'kill 0' EXIT; $(MAKE) -s dev-api & $(MAKE) -s dev-web & wait

dev-api:
	cd backend && set -a && source ../.env && set +a && \
	LISTEN_ADDR=:7778 DATA_DIR=$(CURDIR)/data DEV_TRUST_LOCAL=true go run ./cmd/nanoditor

dev-web:
	cd frontend && npx vite

test:
	cd backend && go vet ./... && go test ./...
	cd frontend && npx tsc --noEmit && npx vitest run

up:
	APP_VERSION=$(VERSION) docker compose up -d --build
	@echo "Nanoditor: http://$(TS_IP):7777"

down:
	docker compose down

restart:
	docker compose restart

logs:
	docker compose logs -f --tail=100

status:
	docker compose ps
