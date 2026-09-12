# ==============================================================================
# Stage 1: Build React/Vite Frontend
# ==============================================================================
FROM node:20-bullseye-slim AS frontend-builder
WORKDIR /app

# Install frontend dependencies
COPY package*.json ./
RUN npm install

# Copy source and build static bundle
COPY index.html vite.config.js ./
COPY public/ ./public/
COPY src/ ./src/
RUN npm run build

# ==============================================================================
# Stage 2: Production Python Runtime
# ==============================================================================
FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ENV=development \
    PORT=8000

WORKDIR /app

# Install system dependencies needed by OpenCV headless, ffmpeg, curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ffmpeg \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install PyTorch CPU-only wheel first (saves ~2.3GB download and avoids build timeouts)
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Install backend dependencies
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy project files
COPY backend/ ./backend/

# Create required directories for models and snapshots
RUN mkdir -p models snapshots

# Download and verify AI models (falls back gracefully if offline)
RUN python backend/download_models.py || true

# Copy compiled frontend from Stage 1 into /app/dist
COPY --from=frontend-builder /app/dist ./dist

EXPOSE 8000

# Start Uvicorn bound to Render dynamic $PORT
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
