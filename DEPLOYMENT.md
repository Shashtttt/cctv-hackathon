# Deploying IBVAP on Render

This guide provides step-by-step instructions to deploy the **IBVAP (Intelligent Border Video Analytics Platform)** to [Render](https://render.com).

---

## Method 1: 1-Click Blueprint (Recommended & Easiest)

Render Blueprints automatically configure the service using the included [`render.yaml`](file:///c:/Users/SHASHVAT%20RAI/Desktop/new_sih%20hackathon/render.yaml).

1. **Push your repository to GitHub / GitLab**.
2. Log into your [Render Dashboard](https://dashboard.render.com).
3. Click **New +** at the top right and select **Blueprint**.
4. Connect your GitHub repository (`cctv-hackathon` / `new_sih hackathon`).
5. Render will detect `render.yaml` and display:
   - **Service**: `ibvap-surveillance`
   - **Runtime**: Docker
   - **Plan**: Free
   - **Health Check**: `/api/health`
6. Click **Apply**.
7. Render will build the multi-stage Docker container (compiling the React frontend, downloading AI models, and launching FastAPI) and provide your live URL (e.g., `https://ibvap-surveillance.onrender.com`).

---

## Method 2: Manual Docker Web Service

If you prefer configuring via the Render web UI:

1. In Render Dashboard, click **New +** -> **Web Service**.
2. Connect your Git repository.
3. Configure the settings:
   - **Name**: `ibvap-surveillance` (or your preferred name)
   - **Region**: Any (e.g., Oregon or Frankfurt)
   - **Branch**: `main`
   - **Runtime**: **Docker**
   - **Dockerfile Path**: `./Dockerfile`
   - **Instance Type**: **Free**
4. Expand **Advanced Settings**:
   - **Health Check Path**: `/api/health`
   - Add Environment Variables:
     - `ENV` = `development`
     - `USE_GPU` = `false`
     - `GPU_DEVICE` = `cpu`
     - `ALLOWED_ORIGINS` = `*`
5. Click **Create Web Service**.

---

## Method 3: Native Python Web Service (Without Docker)

If you prefer Render's native Python runtime:

1. In Render Dashboard, click **New +** -> **Web Service**.
2. Choose **Python** as the runtime.
3. Configure:
   - **Build Command**: `chmod +x ./render-build.sh && ./render-build.sh`
   - **Start Command**: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
   - **Health Check Path**: `/api/health`
4. In Environment Variables:
   - `ENV` = `development`
   - `PYTHON_VERSION` = `3.11.9`
   - `USE_GPU` = `false`
   - `GPU_DEVICE` = `cpu`
   - `ALLOWED_ORIGINS` = `*`
5. Click **Create Web Service**.

---

## Architecture Details

### Unified Single Service
FastAPI serves the REST API routes (`/api/v1/...`), real-time WebSocket streams (`/ws/alerts`, `/ws/stream/{cam_id}`), and mounts the compiled Vite React frontend (`dist/`) directly.
- **No CORS conflicts**: Both frontend and backend share the identical origin.
- **WebSockets connect immediately**: Automatically detects `wss://` over the active host.
- **100% Free**: Fits completely within Render's single free web service allocation (750 hours/month).

### Default Demo Credentials
When the platform boots:
- **Commander**: `commander` / `password123`
- **Operator**: `operator` / `password123`

---

## Important Render Free-Tier Notes

1. **Cold Starts**: On Render's Free tier, the service automatically spins down after 15 minutes of inactivity. When a new request arrives, it may take 30–50 seconds to wake up.
2. **Ephemeral Disk**: On the free tier, newly captured snapshot images and custom user registrations will reset to default seeded cameras upon cold restart. For persistent data, attach a Render Persistent Disk (`/var/data`) and set `DATABASE_PATH=/var/data/ibvap.db`.
3. **PyTorch CPU Optimization**: The build configurations explicitly use PyTorch CPU wheels (`torch torchvision --index-url https://download.pytorch.org/whl/cpu`), preventing Render from downloading 2.5GB CUDA packages that cause memory/timeout errors during builds.
