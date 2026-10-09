from __future__ import annotations

from datetime import UTC, datetime
from typing import Any


async def audit(tdb, actor: str, action: str, target: str = "", diff: dict[str, Any] | None = None, ip: str = "") -> None:
    await tdb.audit_log.insert_one({
        "actor": actor, "action": action, "target": target, "diff": diff or {}, "ip": ip,
        "ts": datetime.now(UTC).isoformat(),
    })


async def platform_audit(pdb, actor: str, action: str, target: str = "", diff: dict[str, Any] | None = None) -> None:
    await pdb.platform_audit.insert_one({
        "actor": actor, "action": action, "target": target, "diff": diff or {}, "ts": datetime.now(UTC).isoformat(),
    })
