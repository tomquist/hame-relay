# Base image for the final stage, overridable by the Home Assistant builder.
# Declared in the global scope (before the first FROM) so it can be used in
# the final stage's FROM instruction without a BuildKit lint warning.
#
# NOTE: this base image also decides the *runtime* Node version, because the
# final stage installs Node from the base image's Alpine repositories (see
# `apk add nodejs` below). Base 17.2.1 is Alpine 3.21, which ships Node 22 on
# every arch we build, matching the builder stage below. Bumping the base
# image can therefore silently change the Node the add-on runs on.
ARG BUILD_FROM

# Build stage. Must stay on the same Node major as the runtime stage; see the
# armv7 note in the root Dockerfile for why that major is 22.
FROM node:22-alpine AS builder

WORKDIR /build

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDependencies)
RUN npm ci

# Copy source code
COPY src/ ./src/

# Build the application
RUN npm run build

# Install production dependencies
RUN npm ci --only=production

# Final stage
FROM ${BUILD_FROM:-ghcr.io/hassio-addons/base:17.2.1}

# Install Node.js from the base image's Alpine repositories. On Alpine 3.21
# (base 17.2.1) this is Node 22, matching the builder stage.
RUN apk add --no-cache nodejs

# Set work directory
WORKDIR /app

# Copy package file (for reference only)
COPY package.json ./

# Copy production dependencies and built application from builder
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist/ ./dist/

# Copy brokers configuration
COPY brokers.json ./brokers.json

# Copy certificates
COPY certs/ ./certs/

# Copy add-on files
COPY hassio-addon/run.sh /
RUN chmod a+x /run.sh

# Set environment variables
ENV CONFIG_PATH=/app/config/config.json \
    CERT_PATH=/app/certs

CMD [ "/run.sh" ]