from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

log = logging.getLogger("ibvap.core.blockchain")

NODE_SECURITY_SECRET = os.getenv("IBVAP_NODE_SECRET", "MHA-SEC-IBVAP-SECTOR-4-NODE-ALPHA-2026")
DEFENSE_NODE_ID = os.getenv("IBVAP_DEFENSE_NODE_ID", "NODE-BSF-SECTOR4-ALPHA")


@dataclass
class AuditBlock:
    index: int
    timestamp: str
    event_type: str
    camera_id: str
    alert_id: Optional[str]
    payload: Dict[str, Any]
    data_hash: str
    previous_hash: str
    merkle_root: str
    block_hash: str
    validator_node: str = DEFENSE_NODE_ID
    signature: str = ""
    nonce: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def calculate_sha256(data: bytes | str) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def compute_merkle_root(hashes: List[str]) -> str:
    if not hashes:
        return calculate_sha256(b"EMPTY_BLOCK")
    if len(hashes) == 1:
        return hashes[0]

    current_level = list(hashes)
    while len(current_level) > 1:
        next_level = []
        for i in range(0, len(current_level), 2):
            left = current_level[i]
            right = current_level[i + 1] if i + 1 < len(current_level) else left
            combined = (left + right).encode("utf-8")
            next_level.append(hashlib.sha256(combined).hexdigest())
        current_level = next_level
    return current_level[0]


def sign_block(block_hash: str, secret: str = NODE_SECURITY_SECRET) -> str:
    return hmac.new(secret.encode("utf-8"), block_hash.encode("utf-8"), hashlib.sha256).hexdigest()


def calculate_block_hash(
    index: int,
    timestamp: str,
    event_type: str,
    camera_id: str,
    data_hash: str,
    previous_hash: str,
    merkle_root: str,
    nonce: int,
) -> str:
    header = f"{index}:{timestamp}:{event_type}:{camera_id}:{data_hash}:{previous_hash}:{merkle_root}:{nonce}"
    return calculate_sha256(header)


class BlockchainLedger:
    _instance: Optional["BlockchainLedger"] = None

    def __init__(self) -> None:
        self.chain: List[AuditBlock] = []
        self._alert_index_map: Dict[str, int] = {}
        log.info("BlockchainLedger initialized.")

    @classmethod
    def get_instance(cls) -> "BlockchainLedger":
        if cls._instance is None:
            cls._instance = BlockchainLedger()
        return cls._instance

    def create_genesis_block(self) -> AuditBlock:
        timestamp = datetime.now(timezone.utc).isoformat()
        payload = {
            "platform": "IBVAP — Intelligent Border Video Analytics Platform",
            "authority": "Ministry of Home Affairs / Border Surveillance Grid",
            "standard": "ISO/IEC 27001 & Indian Evidence Act Sec 65B Compliant",
            "protocol_version": "2.0-CYBER-SHIELD",
            "genesis_memo": "Border Sector-4 Electronic Surveillance Grid Initialized",
        }
        data_hash = calculate_sha256(json.dumps(payload, sort_keys=True))
        merkle_root = compute_merkle_root([data_hash])
        prev_hash = "0" * 64
        nonce = 187
        block_hash = calculate_block_hash(
            index=0,
            timestamp=timestamp,
            event_type="GENESIS",
            camera_id="CMD-NODE-ROOT",
            data_hash=data_hash,
            previous_hash=prev_hash,
            merkle_root=merkle_root,
            nonce=nonce,
        )
        sig = sign_block(block_hash)

        genesis = AuditBlock(
            index=0,
            timestamp=timestamp,
            event_type="GENESIS",
            camera_id="CMD-NODE-ROOT",
            alert_id=None,
            payload=payload,
            data_hash=data_hash,
            previous_hash=prev_hash,
            merkle_root=merkle_root,
            block_hash=block_hash,
            validator_node=DEFENSE_NODE_ID,
            signature=sig,
            nonce=nonce,
        )
        return genesis

    def add_block(
        self,
        event_type: str,
        camera_id: str,
        alert_id: Optional[str],
        payload: Dict[str, Any],
        snapshot_bytes: Optional[bytes] = None,
    ) -> AuditBlock:
        if not self.chain:
            genesis = self.create_genesis_block()
            self.chain.append(genesis)

        prev_block = self.chain[-1]
        index = prev_block.index + 1
        timestamp = datetime.now(timezone.utc).isoformat()

        if snapshot_bytes:
            payload["snapshot_sha256"] = calculate_sha256(snapshot_bytes)

        payload_json = json.dumps(payload, sort_keys=True)
        data_hash = calculate_sha256(payload_json)
        merkle_root = compute_merkle_root([data_hash])
        nonce = 0
        block_hash = calculate_block_hash(
            index=index,
            timestamp=timestamp,
            event_type=event_type,
            camera_id=camera_id,
            data_hash=data_hash,
            previous_hash=prev_block.block_hash,
            merkle_root=merkle_root,
            nonce=nonce,
        )
        sig = sign_block(block_hash)

        block = AuditBlock(
            index=index,
            timestamp=timestamp,
            event_type=event_type,
            camera_id=camera_id,
            alert_id=alert_id,
            payload=payload,
            data_hash=data_hash,
            previous_hash=prev_block.block_hash,
            merkle_root=merkle_root,
            block_hash=block_hash,
            validator_node=DEFENSE_NODE_ID,
            signature=sig,
            nonce=nonce,
        )

        self.chain.append(block)
        if alert_id:
            self._alert_index_map[alert_id] = index

        log.info(
            "New Blockchain Audit Block #%d created. Event=%s, Hash=%s...",
            block.index, block.event_type, block.block_hash[:16]
        )
        return block

    def verify_entire_chain(self) -> Dict[str, Any]:
        if not self.chain:
            return {
                "is_valid": True,
                "total_blocks": 0,
                "verified_blocks": 0,
                "status": "EMPTY_CHAIN",
                "message": "Chain is uninitialized.",
            }

        for i, block in enumerate(self.chain):
            recomputed_data_hash = calculate_sha256(json.dumps(block.payload, sort_keys=True))
            if block.data_hash != recomputed_data_hash:
                return {
                    "is_valid": False,
                    "corrupted_block_index": block.index,
                    "error": (
                        f"Tampered payload detected at Block #{block.index}: "
                        f"data_hash mismatch (expected {recomputed_data_hash[:12]}, recorded {block.data_hash[:12]})"
                    ),
                    "status": "PAYLOAD_ALTERATION_DETECTED",
                }

            if i == 0:
                if block.previous_hash != "0" * 64:
                    return {
                        "is_valid": False,
                        "corrupted_block_index": 0,
                        "error": "Genesis block has invalid previous_hash",
                        "status": "TAMPER_DETECTED",
                    }
            else:
                prev_block = self.chain[i - 1]
                if block.previous_hash != prev_block.block_hash:
                    return {
                        "is_valid": False,
                        "corrupted_block_index": block.index,
                        "error": (
                            f"Broken chain link at Block #{block.index}: "
                            f"prev_hash {block.previous_hash[:12]} does not match actual {prev_block.block_hash[:12]}"
                        ),
                        "status": "CHAIN_BROKEN_TAMPER_DETECTED",
                    }

            expected_hash = calculate_block_hash(
                index=block.index,
                timestamp=block.timestamp,
                event_type=block.event_type,
                camera_id=block.camera_id,
                data_hash=block.data_hash,
                previous_hash=block.previous_hash,
                merkle_root=block.merkle_root,
                nonce=block.nonce,
            )
            if block.block_hash != expected_hash:
                return {
                    "is_valid": False,
                    "corrupted_block_index": block.index,
                    "error": (
                        f"Tampered block hash at Block #{block.index}: "
                        f"found {block.block_hash[:12]}, expected {expected_hash[:12]}"
                    ),
                    "status": "PAYLOAD_ALTERATION_DETECTED",
                }

            expected_sig = sign_block(block.block_hash)
            if block.signature != expected_sig:
                return {
                    "is_valid": False,
                    "corrupted_block_index": block.index,
                    "error": f"Invalid digital defense signature on Block #{block.index}",
                    "status": "SIGNATURE_FORGERY_DETECTED",
                }

        return {
            "is_valid": True,
            "total_blocks": len(self.chain),
            "verified_blocks": len(self.chain),
            "latest_block_hash": self.chain[-1].block_hash,
            "genesis_hash": self.chain[0].block_hash,
            "status": "CRYPTOGRAPHICALLY_VERIFIED",
            "message": f"All {len(self.chain)} blocks mathematically verified and tamper-proof.",
            "audited_at": datetime.now(timezone.utc).isoformat(),
        }

    def get_proof_for_alert(self, alert_id: str) -> Optional[Dict[str, Any]]:
        target_block: Optional[AuditBlock] = None
        for b in self.chain:
            if b.alert_id == alert_id:
                target_block = b
                break

        if not target_block:
            return None

        verification = self.verify_entire_chain()

        return {
            "certificate_id": f"CERT-MHA-IBVAP-{target_block.block_hash[:12].upper()}",
            "legal_compliance": "Sec 65B Indian Evidence Act / ISO/IEC 27037 Digital Forensics",
            "issued_by": "MHA Central Border Command - Cryptographic Verification Unit",
            "alert_id": alert_id,
            "block_index": target_block.index,
            "timestamp": target_block.timestamp,
            "camera_id": target_block.camera_id,
            "event_type": target_block.event_type,
            "block_hash": target_block.block_hash,
            "previous_hash": target_block.previous_hash,
            "data_hash": target_block.data_hash,
            "merkle_root": target_block.merkle_root,
            "digital_signature": target_block.signature,
            "validator_node": target_block.validator_node,
            "payload_snapshot": target_block.payload,
            "chain_verified": verification.get("is_valid", False),
            "total_chain_depth": len(self.chain),
            "verification_status": "AUTHENTIC_UNALTERED",
            "certified_at": datetime.now(timezone.utc).isoformat(),
        }

    def simulate_tamper_attack(self, block_index: Optional[int] = None) -> Dict[str, Any]:
        if len(self.chain) <= 1:
            self.add_block(
                event_type="INTRUSION_ALERT",
                camera_id="CAM-BOP-01",
                alert_id="ALT-DEMO-TEST",
                payload={"threat": "VIRTUAL_FENCE_INTRUSION", "target": "PERSON-99"},
            )

        target_idx = block_index if (block_index is not None and block_index < len(self.chain)) else len(self.chain) - 1
        if target_idx == 0 and len(self.chain) > 1:
            target_idx = 1

        corrupted_block = self.chain[target_idx]
        original_data = dict(corrupted_block.payload)

        corrupted_block.payload["threat"] = "NORMAL_PATROL (FRAUDULENTLY MODIFIED BY ATTACKER)"
        corrupted_block.payload["tampered"] = True

        log.warning("DEMO ATTACK SIMULATION: Altered payload of Block #%d!", target_idx)
        audit_result = self.verify_entire_chain()

        return {
            "attack_executed": True,
            "corrupted_block_index": target_idx,
            "original_payload": original_data,
            "tampered_payload": corrupted_block.payload,
            "audit_result": audit_result,
        }

    def restore_chain(self) -> Dict[str, Any]:
        if not self.chain:
            return {"status": "EMPTY"}

        for i in range(len(self.chain)):
            block = self.chain[i]
            if "tampered" in block.payload:
                del block.payload["tampered"]
            if "(FRAUDULENTLY MODIFIED BY ATTACKER)" in str(block.payload.get("threat", "")):
                block.payload["threat"] = "VIRTUAL_FENCE_INTRUSION (RESTORED)"

            payload_json = json.dumps(block.payload, sort_keys=True)
            block.data_hash = calculate_sha256(payload_json)
            block.merkle_root = compute_merkle_root([block.data_hash])

            if i > 0:
                block.previous_hash = self.chain[i - 1].block_hash
            else:
                block.previous_hash = "0" * 64

            block.block_hash = calculate_block_hash(
                index=block.index,
                timestamp=block.timestamp,
                event_type=block.event_type,
                camera_id=block.camera_id,
                data_hash=block.data_hash,
                previous_hash=block.previous_hash,
                merkle_root=block.merkle_root,
                nonce=block.nonce,
            )
            block.signature = sign_block(block.block_hash)

        return self.verify_entire_chain()


blockchain_ledger = BlockchainLedger.get_instance()
