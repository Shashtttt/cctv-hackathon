<div align="center">

# 🛡️ IBVAP — Intelligent Border Video Analytics Platform
### *Real-Time Multi-Camera Neural Surveillance, Virtual Fence Intrusion Detection & Threat Intelligence*

[![FastAPI](https://img.shields.io/badge/FastAPI-0.110.0-009688.svg?style=for-the-badge&logo=FastAPI&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19.0-61DAFB.svg?style=for-the-badge&logo=react&logoColor=black)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-6.0-646CFF.svg?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![YOLOv8](https://img.shields.io/badge/YOLOv8-Ultralytics-00FFFF.svg?style=for-the-badge&logo=python&logoColor=white)](https://ultralytics.com/)
[![SQLite](https://img.shields.io/badge/SQLite-AioSQLite-003B57.svg?style=for-the-badge&logo=sqlite&logoColor=white)](https://sqlite.org)
[![Apple Silicon](https://img.shields.io/badge/GPU_Accel-Apple_MPS_/_CUDA-999999.svg?style=for-the-badge&logo=apple&logoColor=white)](https://developer.apple.com/metal/)

<p align="center">
  <b>IBVAP</b> is an enterprise-grade tactical surveillance operating system designed for perimeter defense, critical border corridors, and high-security installations. Powered by asynchronous Python multiprocessing, hardware-accelerated YOLOv8 pose and object recognition, YuNet face detection, and a high-frequency 60 FPS canvas HUD overlay.
</p>

</div>

---

## 📸 System Architecture & Features

```
                   ┌────────────────────────────────────────────────────────┐
                   │               IBVAP Tactical Web Console               │
                   │    (React 19 + Vite + Canvas HUD + Web Audio Alarm)    │
                   └─────────────────────────┬──────────────────────────────┘
                                             │
                       WebSocket Alerts (/ws/alerts) + REST APIs
                                             │
                   ┌─────────────────────────▼──────────────────────────────┐
                   │             FastAPI Asynchronous Gateway               │
                   └──────┬──────────────────┬──────────────────────┬───────┘
                          │                  │                      │
                          ▼                  ▼                      ▼
               ┌────────────────────┐ ┌──────────────┐   ┌───────────────────┐
               │ Multi-Worker Pool  │ │ SQLite DB    │   │ Direct AI Bridge  │
               │ (Process Isolation)│ │ (aiosqlite)  │   │ (GPU/MPS Ingest)  │
               └──────────┬─────────┘ └──────────────┘   └─────────┬─────────┘
                          │                                        │
                          └───────────────────┬────────────────────┘
                                              ▼
                    ┌─────────────────────────────────────────────────┐
                    │            Hardware AI Vision Pipeline          │
                    │  • YOLOv8-pose (Posture & Human Tracking)       │
                    │  • YOLOv8n (Object & Weapon / Tool Detection)   │
                    │  • Virtual Fence Polygon Ray-Casting            │
                    │  • YuNet + SFace Cosine Similarity (FRS)        │
                    │  • EasyOCR + Fuzzy Regex Matching (ANPR)        │
                    └─────────────────────────────────────────────────┘
```

---

## ⚡ Key Capabilities

### 1. 🎯 Neural Computer Vision Engine
- **Multi-Class Detection**: Real-time object tracking with confidence thresholds.
- **Unusual Item & Weapon Classification**: Instant alert trigger for suspicious handheld objects (`knife`, `tool`, `bottle`, `backpack`).
- **Pose & Behavior Analytics**: YOLOv8 keypoint skeleton estimation detects suspicious crouching, hands raised, loitering dwell times, and perimeter probing.
- **Hardware Acceleration**: Out-of-the-box support for Apple Silicon Metal (`mps`), Nvidia CUDA (`cuda`), and optimized CPU fallback.

### 2. 🚧 Virtual Fence & Tripwire Intrusion
- Interactive polygon boundary drawing directly on camera streams.
- Point-in-polygon ray-casting algorithm detects boundary crossings with sub-frame precision.
- Automatic threat escalation to `DEFCON 1 / CRITICAL` with dispatch logging.

### 3. 👤 Facial Recognition System (FRS)
- ONNX-based **YuNet** face detector + **SFace** 128D cosine distance embedding extractor.
- Real-time match verification against registered watchlists (`SECURITY_OFFICER`, `VIP`, `PERSON_OF_INTEREST`).

### 4. 🚗 Automatic Number Plate Recognition (ANPR)
- Automated vehicle plate localization with **EasyOCR** and Indian standard license plate regex parsing.
- Instant whitelist/blacklist matching (`AUTHORIZED`, `FLAGGED`, `SUSPECT`).

### 5. 🖥️ Tactical Dark Cyber Defense Interface
- **TrafficVision Live Integration**: Live Indian highway and perimeter feeds (Mumbai Sea Link, Delhi NH-48, Bengaluru Silk Board, Goa Mandovi Bridge).
- **Webcam AI Bridge**: Live frame sampling directly from your laptop camera with instantaneous bounding-box telemetry.
- **Expanded Camera Inspector**: Digital zoom (100%–300%), PTZ controls, optical telemetry, snapshot downloads, and fullscreen view.
- **Audio Alarm Engine**: Tactical Web Audio API alarm sound synthesizer.

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js**: v18.0 or higher
- **Python**: v3.10 or v3.11+
- **Git**

---

### Step 1: Clone the Repository
```bash
git clone https://github.com/Alansi2025/ibvap-surveillance.git
cd ibvap-surveillance
```

---

### Step 2: Backend Setup (FastAPI + AI Pipeline)

```bash
# 1. Create and activate a Python virtual environment
python3 -m venv backend/.venv
source backend/.venv/bin/activate

# 2. Install Python dependencies
pip install -r backend/requirements.txt

# 3. Download / verify AI neural network weights (YOLOv8 + YuNet)
python backend/download_models.py

# 4. Start the backend server
python backend/run.py
```
> The backend server will start on: **`http://127.0.0.1:8000`**  
> Interactive OpenAPI documentation available at: **`http://127.0.0.1:8000/docs`**

---

### Step 3: Frontend Setup (Vite + React)

Open a new terminal window:
```bash
# 1. Install NPM packages
npm install

# 2. Start the development server
npm run dev
```
> The web application will launch at: **`http://localhost:5173`**

---

## 📁 Repository Structure

```
ibvap-surveillance/
├── backend/                        # FastAPI Backend & AI Vision Pipeline
│   ├── ai/                         # Computer Vision Modules
│   │   ├── direct_analyzer.py      # Direct GPU-accelerated frame inference
│   │   ├── yolo_detector.py        # YOLOv8 object & pose inference
│   │   ├── face_detector.py        # YuNet ONNX face detection
│   │   ├── face_recognizer.py      # SFace embedding matcher
│   │   ├── anpr_engine.py          # EasyOCR License Plate recognition
│   │   └── loitering_tracker.py    # Centroid vector dwell-time tracker
│   ├── core/                       # Geometric & Security Algorithms
│   │   └── virtual_fence.py        # Polygon point-in-polygon ray-casting
│   ├── database/                   # SQLite persistence layer (aiosqlite)
│   │   ├── db.py                   # Async database CRUD & schemas
│   │   └── models.py               # Data models
│   ├── pipeline/                   # Multiprocessing Camera Worker Pool
│   │   ├── camera_worker.py        # Ring-buffer isolated worker processes
│   │   └── pipeline_manager.py     # Master stream orchestrator
│   ├── routers/                    # REST API Route Controllers
│   │   ├── alerts.py               # Alert acknowledgement & queries
│   │   ├── analytics.py            # Aggregated metrics & summary
│   │   ├── cameras.py              # Ingestion & MJPEG stream endpoints
│   │   ├── anpr.py                 # Plate watchlist CRUD
│   │   └── frs.py                  # Face watchlist CRUD
│   ├── config.py                   # Pydantic Settings & GPU configuration
│   └── run.py                      # Uvicorn entry point
├── models/                         # Pre-trained Neural Network Weights
│   ├── yolov8n-pose.pt             # YOLOv8 Pose Estimation
│   ├── yolov8n.pt                  # YOLOv8 Multi-class Object Detection
│   ├── face_detection_yunet.onnx   # YuNet Face Detector
│   └── face_recognition_sface.onnx # SFace Embedder
├── public/                         # Static Assets & Local Video Feeds
│   └── videos/                     # High-definition corridor streams
├── src/                            # React 19 Frontend Web Console
│   ├── components/                 # Tactical Cyber UI Components
│   │   ├── TrafficVisionPlayer.jsx # HLS/MP4 Video Player with Canvas Overlay
│   │   ├── CameraDetailModal.jsx   # Expanded Fullscreen Inspector with Zoom
│   │   ├── DashboardKPIs.jsx       # Real-time metrics from SQLite DB
│   │   ├── ActiveDetections.jsx    # Live neural detection feed
│   │   ├── RightAlertsPanel.jsx    # WebSocket triage ledger
│   │   └── SurveillanceMap.jsx     # Radar vector map
│   ├── pages/                      # Application Route Views
│   │   ├── DashboardPage.jsx       # Main Command Console
│   │   ├── LiveSurveillancePage.jsx# Multi-feed Matrix & Laptop AI Bridge
│   │   ├── AlertsEventsPage.jsx    # Security Ledger & Dispatcher
│   │   ├── CamerasPage.jsx         # RTSP Node Management
│   │   └── AnalyticsPage.jsx       # Threat distributions & telemetry charts
│   ├── services/                   # Axios API & WebSocket Client Services
│   │   ├── apiService.js           # REST API client
│   │   ├── useWebcamBridge.js      # Laptop webcam frame capture hook
│   │   └── useWebSocket.js         # Real-time WebSocket hook
│   └── index.css                   # Tactical Theme Tokens & Animations
├── package.json
└── vite.config.js
```

---

## 📡 API Reference Overview

| Endpoint | Method | Description |
| :--- | :---: | :--- |
| `/api/v1/cameras/{id}/ingest` | `POST` | Ingest video frame (base64/bytes) for real-time GPU inference. |
| `/api/v1/cameras/` | `GET` | Retrieve list of all registered camera feeds and statuses. |
| `/api/v1/cameras/{id}/stream` | `GET` | Continuous MJPEG live stream. |
| `/api/v1/alerts/` | `GET` | Query persisted alerts with severity and camera filters. |
| `/api/v1/alerts/{id}/acknowledge` | `POST` | Acknowledge alert and update status. |
| `/api/v1/analytics/summary` | `GET` | Aggregated threat counts by category and severity. |
| `/ws/alerts` | `WebSocket` | Real-time bi-directional threat alert broadcast stream. |

---

## 🛡️ License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

<div align="center">
  <sub>Developed for next-generation perimeter security & automated video analytics.</sub>
</div>