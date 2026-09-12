#!/usr/bin/env python3
"""
IBVAP — AI Model Weights Downloader & Verification Utility
Downloads official pre-trained open-source weights for:
  • YOLOv8-pose (Ultralytics)
  • YuNet Face Detector (OpenCV Zoo)
  • SFace Face Recognizer (OpenCV Zoo)
"""

import os
import sys
import urllib.request
from pathlib import Path

# Model download URLs
MODELS = {
    "yolov8n-pose.pt": {
        "url": "https://github.com/ultralytics/assets/releases/download/v8.2.0/yolov8n-pose.pt",
        "desc": "YOLOv8 Pose & Human/Vehicle Detector (Ultralytics)",
        "min_size_bytes": 6_000_000,
    },
    "yolov8n.pt": {
        "url": "https://github.com/ultralytics/assets/releases/download/v8.2.0/yolov8n.pt",
        "desc": "YOLOv8 General Object & Vehicle Detector (Cars, Trucks, Buses, Bags, Phones)",
        "min_size_bytes": 6_000_000,
    },
    "face_detection_yunet_2023mar.onnx": {
        "url": "https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx",
        "desc": "YuNet Face Detection & 5-Landmark Model (OpenCV Zoo)",
        "min_size_bytes": 200_000,
    },
    "face_recognition_sface_2021dec.onnx": {
        "url": "https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec.onnx",
        "desc": "SFace 128-Dim Cosine Face Recognition Model (OpenCV Zoo)",
        "min_size_bytes": 1_000_000,
    },
}


def download_file(url: str, dest_path: Path, desc: str) -> bool:
    print(f"[*] Downloading {desc} …")
    print(f"    Source: {url}")
    print(f"    Target: {dest_path}")

    dest_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = dest_path.with_suffix(".tmp")

    def _progress(block_num, block_size, total_size):
        if total_size > 0:
            downloaded = block_num * block_size
            pct = min(100.0, (downloaded / total_size) * 100)
            mb = downloaded / (1024 * 1024)
            total_mb = total_size / (1024 * 1024)
            sys.stdout.write(f"\r    Progress: {pct:5.1f}% [{mb:5.1f} MB / {total_mb:5.1f} MB]")
            sys.stdout.flush()

    try:
        urllib.request.urlretrieve(url, str(temp_path), reporthook=_progress)
        print()
        temp_path.replace(dest_path)
        print(f"    [OK] Successfully downloaded: {dest_path.name} ({dest_path.stat().st_size:,} bytes)")
        return True
    except Exception as exc:
        print()
        print(f"    [FAIL] Download failed: {exc}")
        if temp_path.exists():
            temp_path.unlink()
        return False


def verify_models(models_dir: Path) -> None:
    print("=" * 60)
    print(" IBVAP AI Models Verification")
    print("=" * 60)

    for filename, info in MODELS.items():
        dest = models_dir / filename
        if dest.exists() and dest.stat().st_size >= info["min_size_bytes"]:
            print(f"  [OK] {filename:<36} ({dest.stat().st_size / 1024 / 1024:.2f} MB) -- {info['desc']}")
        else:
            print(f"  [FAIL] {filename:<36} (MISSING or incomplete) -- fallback simulation active")

    print("=" * 60)


def main():
    root_dir = Path(__file__).resolve().parent.parent
    models_dir = root_dir / "models"
    models_dir.mkdir(parents=True, exist_ok=True)

    if "--verify" in sys.argv:
        verify_models(models_dir)
        return

    print("=" * 60)
    print(" IBVAP — Intelligent Border Surveillance Model Downloader")
    print(f" Target models directory: {models_dir}")
    print("=" * 60)

    downloaded = 0
    for filename, info in MODELS.items():
        dest = models_dir / filename
        if dest.exists() and dest.stat().st_size >= info["min_size_bytes"]:
            print(f"[*] {filename} already exists ({dest.stat().st_size:,} bytes). Skipping.")
            continue

        success = download_file(info["url"], dest, info["desc"])
        if success:
            downloaded += 1

    print("=" * 60)
    print(f"Download complete. {downloaded} new model(s) downloaded.")
    verify_models(models_dir)


if __name__ == "__main__":
    main()
