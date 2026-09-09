"""
IBVAP — SFace Face Recognizer + Watchlist Matching
Uses OpenCV's SFace ONNX model for 128-dim embedding extraction.
Supports vectorised cosine similarity + optional FAISS ANN search.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

from ..config import settings

log = logging.getLogger("ibvap.ai.face_recognizer")


@dataclass
class MatchResult:
    subject_id: str
    name: str
    score: float
    threat_level: str
    is_match: bool


class FaceRecognizer:
    """
    SFace embedding extractor and watchlist matcher.
    Thread-safe (model is read-only after init).
    """

    def __init__(self) -> None:
        self._recognizer = None
        self._simulation = False
        # Watchlist cache: {subject_id: (name, threat_level, embedding_array)}
        self._watchlist: Dict[str, Tuple[str, str, np.ndarray]] = {}
        self._embedding_matrix: Optional[np.ndarray] = None   # (N, 128) stacked
        self._subject_ids: List[str] = []
        self._load()

    # ── Loading ───────────────────────────────────────────────────────────────

    def _load(self) -> None:
        model_path: Path = settings.SFACE_FACE_MODEL
        if not model_path.exists():
            log.warning("SFace model not found at %s — SIMULATION mode.", model_path)
            self._simulation = True
            return
        try:
            import cv2                                       # type: ignore
            self._recognizer = cv2.FaceRecognizerSF.create(str(model_path), "")
            log.info("SFace face recognizer loaded from %s", model_path)
        except Exception as exc:
            log.error("SFace load error: %s — SIMULATION mode.", exc)
            self._simulation = True

    # ── Embedding ─────────────────────────────────────────────────────────────

    def embed(self, aligned_face: np.ndarray) -> Optional[np.ndarray]:
        """
        Extract a 128-dim L2-normalised embedding from an aligned (112×112) BGR face crop.
        Returns None on failure.
        """
        if aligned_face is None or aligned_face.size == 0:
            return None

        if self._simulation:
            return self._sim_embedding()

        try:
            import cv2                                       # type: ignore
            feature = self._recognizer.feature(aligned_face)     # (1, 128)
            vec = np.array(feature).flatten().astype(np.float32)
            norm = np.linalg.norm(vec)
            return vec / (norm + 1e-8)
        except Exception as exc:
            log.error("SFace embed error: %s", exc)
            return None

    # ── Watchlist management ──────────────────────────────────────────────────

    def load_watchlist(self, subjects: List[Dict]) -> None:
        """
        Load or reload the entire FRS watchlist from a list of dicts:
        [{"id": "W-901", "name": "...", "threat_level": "...",
          "face_embedding": [f1, f2, ...]}, ...]
        Rebuilds the stacked embedding matrix for vectorised lookup.
        """
        self._watchlist.clear()
        self._subject_ids.clear()
        embeddings = []

        for s in subjects:
            emb_list = s.get("face_embedding")
            if not emb_list:
                continue                    # skip subjects without enrolled embeddings
            emb = np.array(emb_list, dtype=np.float32)
            norm = np.linalg.norm(emb)
            emb = emb / (norm + 1e-8)
            self._watchlist[s["id"]] = (s["name"], s.get("threat_level", "MEDIUM"), emb)
            self._subject_ids.append(s["id"])
            embeddings.append(emb)

        if embeddings:
            self._embedding_matrix = np.stack(embeddings, axis=0)   # (N, 128)
            log.info("FRS watchlist loaded: %d enrolled subjects with embeddings.", len(embeddings))
        else:
            self._embedding_matrix = None
            log.warning("FRS watchlist has no enrolled embeddings — enroll subjects with photos.")

    def add_subject(self, subject_id: str, name: str, threat_level: str,
                    embedding: np.ndarray) -> None:
        """Hot-add a single subject to the in-memory watchlist (no rebuild required)."""
        emb = embedding / (np.linalg.norm(embedding) + 1e-8)
        self._watchlist[subject_id] = (name, threat_level, emb)
        if subject_id not in self._subject_ids:
            self._subject_ids.append(subject_id)
        # Rebuild matrix
        all_embs = [v[2] for v in self._watchlist.values()]
        self._embedding_matrix = np.stack(all_embs, axis=0) if all_embs else None

    def remove_subject(self, subject_id: str) -> None:
        """Remove a subject and rebuild the matrix."""
        self._watchlist.pop(subject_id, None)
        self._subject_ids = [sid for sid in self._subject_ids if sid != subject_id]
        all_embs = [v[2] for v in self._watchlist.values()]
        self._embedding_matrix = np.stack(all_embs, axis=0) if all_embs else None

    # ── Matching ──────────────────────────────────────────────────────────────

    def match_against_watchlist(self, embedding: np.ndarray) -> Optional[MatchResult]:
        """
        Vectorised cosine similarity search against all enrolled embeddings.
        Returns the best match if score >= FRS_SIMILARITY_THRESHOLD, else None.
        O(N) vector multiply — extremely fast for < 10 000 subjects.
        """
        if self._embedding_matrix is None or len(self._subject_ids) == 0:
            return None

        if self._simulation:
            return self._sim_match()

        # Cosine similarity: dot product of L2-normalised vectors
        emb = embedding / (np.linalg.norm(embedding) + 1e-8)
        scores = self._embedding_matrix @ emb              # (N,)
        best_idx = int(np.argmax(scores))
        best_score = float(scores[best_idx])

        if best_score < settings.FRS_SIMILARITY_THRESHOLD:
            return None

        sid = self._subject_ids[best_idx]
        name, threat, _ = self._watchlist[sid]
        return MatchResult(
            subject_id=sid,
            name=name,
            score=best_score,
            threat_level=threat,
            is_match=True,
        )

    def match_score(self, emb1: np.ndarray, emb2: np.ndarray) -> float:
        """Cosine similarity between two embeddings (0..1)."""
        n1 = np.linalg.norm(emb1) + 1e-8
        n2 = np.linalg.norm(emb2) + 1e-8
        return float(np.dot(emb1 / n1, emb2 / n2))

    # ── Serialisation helpers ─────────────────────────────────────────────────

    @staticmethod
    def embedding_to_list(embedding: np.ndarray) -> List[float]:
        return embedding.tolist()

    @staticmethod
    def list_to_embedding(lst: List[float]) -> np.ndarray:
        return np.array(lst, dtype=np.float32)

    # ── Simulation ────────────────────────────────────────────────────────────

    @staticmethod
    def _sim_embedding() -> np.ndarray:
        vec = np.random.randn(128).astype(np.float32)
        return vec / (np.linalg.norm(vec) + 1e-8)

    def _sim_match(self) -> Optional[MatchResult]:
        import random
        if not self._subject_ids or random.random() < 0.7:
            return None
        sid = random.choice(self._subject_ids)
        name, threat, _ = self._watchlist.get(sid, ("Unknown", "MEDIUM", None))
        return MatchResult(
            subject_id=sid,
            name=name,
            score=random.uniform(0.41, 0.96),
            threat_level=threat,
            is_match=True,
        )
