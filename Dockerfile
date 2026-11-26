# Multi-stage Dockerfile for #freeclass
# Stage 1: Build frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Production backend runtime
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Install backend production dependencies
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm ci --omit=dev

# Copy application files
WORKDIR /app
COPY backend/ ./backend/
COPY db/ ./db/
COPY data/ ./data/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

WORKDIR /app/backend
EXPOSE 3000

CMD ["node", "src/server.js"]
