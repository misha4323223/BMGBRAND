# Dockerfile for Yandex Serverless Containers
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Build frontend and backend
RUN npm run build

# Production image
FROM node:20-slim

WORKDIR /app

# Copy only necessary files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/1c_uploads ./1c_uploads
COPY --from=builder /app/attached_assets ./attached_assets

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Expose port
EXPOSE 8080

# Run the server
CMD ["node", "dist/index.cjs"]
