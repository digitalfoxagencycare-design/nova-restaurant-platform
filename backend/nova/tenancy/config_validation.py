"""Tenant configuration: JSON-Schema structure + business rules the schema can't express."""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

KNOWN_STATUSES = {
    "placed", "accepted", "preparing", "ready", "out_for_delivery", "served", "delivered", "completed",
    "cancelled", "pending_payment",
}
HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class InvalidTenantConfig(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


@lru_cache(maxsize=4)
def _validator(path: str) -> Draft202012Validator:
    return Draft202012Validator(json.loads(Path(path).read_text()))


def validate_tenant_config(cfg: dict[str, Any], schema_path: Path) -> dict[str, Any]:
    errors = [f"{'/'.join(map(str, e.path)) or '(root)'}: {e.message}" for e in _validator(str(schema_path)).iter_errors(cfg)]
    if errors:
        raise InvalidTenantConfig(errors)

    biz: list[str] = []
    slabs = (cfg.get("delivery") or {}).get("fee_slabs") or []
    ups = [s["up_to_km"] for s in slabs]
    if ups != sorted(ups) or len(set(ups)) != len(ups):
        biz.append("delivery.fee_slabs must have strictly increasing up_to_km")
    max_km = (cfg.get("delivery") or {}).get("max_km")
    if max_km is not None and ups and ups[-1] > max_km:
        biz.append("delivery.fee_slabs go beyond delivery.max_km")
    if any(s["fee"] < 0 for s in slabs):
        biz.append("delivery.fee_slabs fees must be >= 0")
    for w in ((cfg.get("payments") or {}).get("cod") or {}).get("disabled_windows") or []:
        if not (HHMM.match(w.get("from", "")) and HHMM.match(w.get("to", ""))):
            biz.append("payments.cod.disabled_windows entries need HH:MM from/to")
    if not HHMM.match(cfg["operations"]["business_day_start"]):
        biz.append("operations.business_day_start must be HH:MM")
    for otype, flow in ((cfg["operations"].get("flows")) or {}).items():
        if otype not in ("dine-in", "takeaway", "delivery"):
            biz.append(f"operations.flows has unknown order type '{otype}'")
        unknown = [s for s in flow if s not in KNOWN_STATUSES]
        if unknown:
            biz.append(f"operations.flows.{otype} has unknown statuses {unknown}")
        if len(flow) != len(set(flow)):
            biz.append(f"operations.flows.{otype} repeats a status")
        if flow and flow[0] not in ("placed", "pending_payment"):
            biz.append(f"operations.flows.{otype} must start with 'placed'")
    lo = cfg.get("loyalty") or {}
    if lo.get("enabled") and not lo.get("earn_per_rupees"):
        biz.append("loyalty.earn_per_rupees is required when loyalty is enabled")
    secrets_like = json.dumps(cfg.get("integrations") or {})
    if re.search(r"(EAA[A-Za-z0-9]{20,}|rzp_(live|test)_[A-Za-z0-9]{8,}|mongodb(\+srv)?://[^\s\"']+:[^\s\"']+@)", secrets_like):
        biz.append("integrations must hold references (secret_ref), never secret values")
    if biz:
        raise InvalidTenantConfig(biz)
    return cfg
