"""
IBVAP — Model Quantization & Optimization Suite
Quantizes YOLOv8 (pose, weapon, general) and Facial Recognition (SFace, YuNet) models:
  - FP16 (Half Precision) ONNX for GPUs / TensorRT
  - INT8 Dynamic Quantization for ultra-low latency on edge CPUs (ARM / x86 / NUC)
Reduces memory footprint by 50-75% and accelerates edge fallback inference.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

log = logging.getLogger("ibvap.ai.quantizer")


def quantize_onnx_dynamic_int8(input_path: Path, output_path: Optional[Path] = None) -> Path:
    """
    Apply INT8 dynamic post-training quantization to an ONNX model.
    Substantially cuts model weight size (e.g., SFace from ~38.7MB to ~9.8MB).
    """
    from onnxruntime.quantization import QuantType, quantize_dynamic

    if not input_path.exists():
        raise FileNotFoundError(f"Input model not found: {input_path}")

    if output_path is None:
        stem = input_path.stem
        output_path = input_path.parent / f"{stem}_int8.onnx"

    log.info("Quantizing %s -> %s (INT8)...", input_path.name, output_path.name)
    t0 = time.time()

    quantize_dynamic(
        model_input=str(input_path),
        model_output=str(output_path),
        weight_type=QuantType.QInt8,
    )

    elapsed = time.time() - t0
    orig_size_mb = input_path.stat().st_size / (1024 * 1024)
    new_size_mb = output_path.stat().st_size / (1024 * 1024)
    ratio = (1.0 - (new_size_mb / orig_size_mb)) * 100.0

    log.info(
        "Quantization complete in %.2fs: %s (%.1f MB) -> %s (%.1f MB) [-%.1f%% memory]",
        elapsed, input_path.name, orig_size_mb, output_path.name, new_size_mb, ratio
    )
    return output_path


def export_yolo_to_onnx(
    pt_path: Path,
    half: bool = False,
    quantize_int8: bool = False,
    imgsz: int = 640,
) -> Path:
    """
    Export a PyTorch YOLOv8 (.pt) model to ONNX format, with optional FP16 or INT8 quantization.
    """
    from ultralytics import YOLO

    if not pt_path.exists():
        raise FileNotFoundError(f"PyTorch YOLO model not found: {pt_path}")

    log.info("Exporting YOLO model %s (half=%s, int8=%s)...", pt_path.name, half, quantize_int8)
    model = YOLO(str(pt_path))

    # Export to ONNX
    onnx_file_str = model.export(
        format="onnx",
        half=half,
        dynamic=False,
        imgsz=imgsz,
        simplify=False,
    )
    exported_path = Path(onnx_file_str)

    if half and not exported_path.name.endswith("_fp16.onnx"):
        target_fp16 = exported_path.parent / f"{pt_path.stem}_fp16.onnx"
        if exported_path.exists():
            import shutil
            shutil.copyfile(exported_path, target_fp16)
            exported_path = target_fp16

    if quantize_int8:
        int8_path = exported_path.parent / f"{pt_path.stem}_int8.onnx"
        return quantize_onnx_dynamic_int8(exported_path, int8_path)

    return exported_path


def quantize_all_models(models_dir: Path) -> Dict[str, Path]:
    """
    Quantize all available YOLOv8 and facial recognition models in the directory.
    """
    results: Dict[str, Path] = {}

    # 1. Quantize SFace facial recognition ONNX model
    sface_path = models_dir / "face_recognition_sface_2021dec.onnx"
    if sface_path.exists():
        out_sface = models_dir / "face_recognition_sface_2021dec_int8.onnx"
        try:
            results["sface_int8"] = quantize_onnx_dynamic_int8(sface_path, out_sface)
        except Exception as exc:
            log.warning("SFace quantization skipped: %s", exc)

    # 2. Export & quantize YOLOv8n object detector
    yolo_obj = models_dir / "yolov8n.pt"
    if yolo_obj.exists():
        try:
            results["yolov8n_onnx"] = export_yolo_to_onnx(yolo_obj, half=False, quantize_int8=True)
        except Exception as exc:
            log.warning("YOLOv8n quantization skipped: %s", exc)

    # 3. Export & quantize YOLOv8n-pose
    yolo_pose = models_dir / "yolov8n-pose.pt"
    if yolo_pose.exists():
        try:
            results["yolov8n_pose_onnx"] = export_yolo_to_onnx(yolo_pose, half=False, quantize_int8=True)
        except Exception as exc:
            log.warning("YOLOv8n-pose quantization skipped: %s", exc)

    # 4. Export & quantize weapon detector if present
    weapon_pt = models_dir / "weapon_yolov8n.pt"
    if weapon_pt.exists():
        try:
            results["weapon_onnx"] = export_yolo_to_onnx(weapon_pt, half=False, quantize_int8=True)
        except Exception as exc:
            log.warning("Weapon model quantization skipped: %s", exc)

    return results


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    base_dir = Path(__file__).resolve().parent.parent.parent
    models_folder = base_dir / "models"
    log.info("Initiating IBVAP Model Quantization Suite on %s ...", models_folder)
    res = quantize_all_models(models_folder)
    log.info("Completed quantization. Generated models: %s", {k: str(v.name) for k, v in res.items()})
