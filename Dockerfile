FROM python:3.10-slim

# Prevent Python from writing pyc files and buffer stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7860 \
    HOME=/home/user

# Install system libraries needed by OpenCV, video streams, and OCR
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Hugging Face Spaces requires running as non-root user (UID 1000)
RUN useradd -m -u 1000 user

WORKDIR /app

# Create required project folders with correct permissions
RUN mkdir -p /app/models /app/snapshots /app/backend && \
    chown -R user:user /app /home/user

USER user
ENV PATH=/home/user/.local/bin:$PATH \
    PYTHONPATH=/app

# Copy dependencies and install
COPY --chown=user:user backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /app/backend/requirements.txt

# Copy backend code
COPY --chown=user:user backend /app/backend

# Pre-download YOLO & ONNX models so container starts instantly
RUN python backend/download_models.py

# Hugging Face Space port
EXPOSE 7860

# Start server using backend/run.py
CMD ["python", "backend/run.py", "--host", "0.0.0.0", "--port", "7860"]
