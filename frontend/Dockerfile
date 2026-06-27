# Multi-stage Dockerfile for frontend (Vite + React)
# Build stage
FROM node:18-alpine as build
WORKDIR /app

# Copy package files and install dependencies
COPY frontend/package*.json ./
RUN npm ci

# Copy source
COPY frontend/ ./

# Build the production assets
RUN npm run build

# Production stage: serve with nginx
FROM nginx:stable-alpine
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
