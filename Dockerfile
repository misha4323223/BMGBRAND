# Dockerfile for Yandex Serverless Containers
FROM node:24-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json .npmrc ./
# Force the public npm registry: Replit's internal NPM_CONFIG_REGISTRY env var
# (package-firewall.replit.local) is not reachable outside Replit and would
# otherwise break this build if it ever leaks into package-lock.json again.
ENV NPM_CONFIG_REGISTRY=https://registry.npmjs.org
RUN npm install --registry=https://registry.npmjs.org

# Copy source code
COPY . .

# Build frontend and backend
RUN NODE_ENV=production npm run build

# Production image
FROM node:24-slim

WORKDIR /app

# Copy only necessary files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/attached_assets ./attached_assets

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Expose port
EXPOSE 8080

# Run the server
CMD ["node", "dist/index.cjs"]
