#!/usr/bin/env bash
# Exit on error
set -e

echo "=========================================================="
echo "  IBVAP — Intelligent Border Video Analytics Platform"
echo "  Render Native Build Script"
echo "=========================================================="

# 1. Build Vite React Frontend
echo "--> [1/4] Building Frontend bundle..."
if command -v npm &> /dev/null; then
    npm install
    npm run build
else
    echo "Warning: npm not found in path. If building from pre-built dist, proceeding."
fi

# 2. Upgrade pip and install lightweight CPU-only PyTorch
# (Avoids 2.5GB CUDA wheels that exceed Render build memory and disk)
echo "--> [2/4] Installing CPU-optimized PyTorch & Torchvision..."
python -m pip install --upgrade pip
python -m pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

# 3. Install Python requirements
echo "--> [3/4] Installing Backend Dependencies..."
python -m pip install --no-cache-dir -r backend/requirements.txt

# 4. Download pre-trained AI models
echo "--> [4/4] Verifying and downloading model weights..."
python backend/download_models.py

echo "=========================================================="
echo "  Build successful! Ready to launch IBVAP."
echo "=========================================================="
