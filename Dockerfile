FROM node:18.19.1-alpine AS builder

WORKDIR /build

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDependencies)
RUN npm ci

# Copy source code
COPY src/ ./src/

# Copy certificates during build
COPY certs/ca.crt certs/client.crt certs/client.key ./src/certs/

# Build the application
RUN npm run build

# Install production dependencies
RUN npm ci --only=production

# Runtime stage
FROM node:20-alpine

WORKDIR /app

# Install Node.js (already included in base image)

# Copy package.json for reference
COPY package.json ./

# Copy production dependencies and built files from builder
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist/ ./dist/

# Copy embedded certificates
COPY --from=builder /build/src/certs/ ./certs/

# Create config directory
RUN mkdir -p /app/config

# Set environment variables
ENV CONFIG_PATH=/app/config/config.json \
    CERT_PATH=/app/certs

# Run the application
CMD ["node", "dist/forwarder.js"]