"""
IBVAP — Optimized ONNX Runtime Edge Execution Engine
Manages hardware acceleration provider fallback:
  TensorRT -> CUDA -> DirectML (Windows GPU) -> OpenVINO -> CPUExecutionProvider
Includes thread-pool optimization and graph optimization level ORT_ENABLE_ALL.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

log = logging.getLogger("ibvap.ai.onnx_edge")


def get_available_providers() -> List[str]:
    """Return list of supported execution providers installed on this machine."""
    try:
        import onnxruntime as ort
        return ort.get_available_providers()
    except Exception as exc:
        log.warning("Could not probe ONNX execution providers: %s", exc)
        return ["CPUExecutionProvider"]


def select_best_execution_providers() -> List[str]:
    """
    Tiered edge hardware selection:
    1. TensorrtExecutionProvider (Nvidia edge boards like Jetson Orin/Nano)
    2. CUDAExecutionProvider (Nvidia desktop / server GPUs)
    3. DmlExecutionProvider (Windows DirectML for Intel Iris / AMD Radeon / Nvidia)
    4. OpenVINOExecutionProvider (Intel NUC / Core Ultra / Movidius)
    5. CPUExecutionProvider (Universal edge CPU with SIMD AVX2/AVX512/NEON)
    """
    available = get_available_providers()
    priority = [
        "TensorrtExecutionProvider",
        "CUDAExecutionProvider",
        "DmlExecutionProvider",
        "OpenVINOExecutionProvider",
        "CPUExecutionProvider",
    ]
    chosen = [p for p in priority if p in available]
    if "CPUExecutionProvider" not in chosen:
        chosen.append("CPUExecutionProvider")
    return chosen


def create_optimized_session(
    model_path: Path,
    providers: Optional[List[str]] = None,
    intra_op_threads: Optional[int] = None,
) -> Any:
    """
    Build an onnxruntime.InferenceSession with performance-tuned session options.
    """
    import onnxruntime as ort

    if not model_path.exists():
        raise FileNotFoundError(f"ONNX model file not found: {model_path}")

    opts = ort.SessionOptions()
    # Enable all graph optimizations (constant folding, node fusions, redundant transpose removal)
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL

    # Optimize thread pool for low-power edge CPUs
    num_cpus = os.cpu_count() or 4
    opts.intra_op_num_threads = intra_op_threads or max(1, min(num_cpus, 4))
    opts.inter_op_num_threads = 2
    opts.log_severity_level = 3  # Warning level

    target_providers = providers or select_best_execution_providers()

    try:
        session = ort.InferenceSession(str(model_path), sess_options=opts, providers=target_providers)
        active_providers = session.get_providers()
        log.info("Initialized ONNX session for %s with providers: %s", model_path.name, active_providers)
        return session
    except Exception as exc:
        log.warning("Failed to initialize session with %s: %s — falling back strictly to CPUExecutionProvider.", target_providers, exc)
        return ort.InferenceSession(str(model_path), sess_options=opts, providers=["CPUExecutionProvider"])
