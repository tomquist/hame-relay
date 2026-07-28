# Node 22 is the newest major we can use: Node 24 dropped the 32-bit ARM
# (linux-armv7l) builds, and there is no node:24-alpine armv7 image, but we
# publish a linux/arm/v7 image. Node 22 entered Maintenance LTS on 2025-10-21
# and reaches end-of-life on 2027-04-30, so it takes security fixes only. There
# is no newer major that still builds for armv7, so dropping the armv7 image is
# a prerequisite for moving off Node 22 before that date.
# Keep this in sync with hassio-addon/Dockerfile, the CI node-version and the
# @types/node major in package.json.
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

# Runtime stage
FROM node:22-alpine

WORKDIR /app

# Install Node.js (already included in base image)

# Copy package.json for reference
COPY package.json ./

# Copy production dependencies and built files from builder
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist/ ./dist/

# Copy brokers configuration
COPY brokers.json ./brokers.json

# Copy embedded certificates
COPY certs/ ./certs/

# Create config directory
RUN mkdir -p /app/config

# Set environment variables
ENV CONFIG_PATH=/app/config/config.json \
    CERT_PATH=/app/certs \
    NODE_ENV=production

# Expose health check port
EXPOSE 8080

# Add health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Run the application
CMD ["node", "dist/main.js"]