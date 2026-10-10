"""Turns a bill into printable bytes: customer receipt, kitchen ticket (KOT) and a test slip."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from .escpos import PROFILES, EscPos, Profile, money


def printer_for(cfg: dict, role: str, printer_id: str | None = None, station: str | None = None) -> dict:
    """Pick the tenant's printer for a job. Falls back to a sensible 80 mm default so printing works out of the box."""
    printers = (cfg.get("pos") or {}).get("printers") or []
    if printer_id:
        for pr in printers:
            if pr["id"] == printer_id:
                return pr
    if station:
        for pr in printers:
            if role in pr["for"] and pr.get("station") == station:
                return pr
    for pr in printers:
        if role in pr["for"] and not pr.get("station"):
            return pr
    return {"id": "default", "name": "Default printer", "profile": "tvs-rp3200", "for": ["receipt", "kot"], "cash_drawer": role == "receipt"}


def _profile(pr: dict) -> Profile:
    return PROFILES[pr["profile"]]


def _local(cfg: dict, iso: str) -> str:
    return datetime.fromisoformat(iso).astimezone(ZoneInfo(cfg["locale"]["timezone"])).strftime("%d-%m-%Y %I:%M %p")


def receipt(cfg: dict, bill: dict, pr: dict, duplicate: bool = False) -> bytes:
    rc = (cfg.get("pos") or {}).get("receipt") or {}
    e = EscPos(_profile(pr), pr.get("cols"))
    e.align("center").bold().size(2, 2).line(cfg["brand"]["name"]).size(1, 1).bold(False)
    if cfg["brand"].get("legal_name") and cfg["brand"]["legal_name"] != cfg["brand"]["name"]:
        e.line(cfg["brand"]["legal_name"])
    for ln in rc.get("header_lines", []):
        e.line(ln)
    if rc.get("gstin"):
        e.line("GSTIN: " + rc["gstin"])
    e.align("left").rule()
    if duplicate:
        e.align("center").bold().line("*** DUPLICATE COPY ***").bold(False).align("left")
    e.row(f"Bill #{bill['bill_no']}", bill["type"])
    e.row(_local(cfg, bill["created_at"]), f"Table {bill['table']}" if bill.get("table") else "")
    c = bill.get("customer") or {}
    if c.get("name") or c.get("phone"):
        e.line(f"Customer: {c.get('name', '')} {c.get('phone', '')}".strip())
    e.rule()
    e.row("Item", "Amount")
    e.rule()
    for ln in bill["lines"]:
        if ln["qty"] <= 0:
            continue
        e.row(f"{ln['qty']} x {ln['name']}", money(ln["price"] * ln["qty"]))
        if ln["qty"] > 1:
            e.line(f"    @ {money(ln['price'])} each")
        if ln.get("note"):
            for w in e.wrap("* " + ln["note"], 4):
                e.line(w)
    e.rule()
    t = bill["totals"]
    e.row("Subtotal", money(t["subtotal"]))
    if t["discount"]:
        e.row("Discount", "-" + money(t["discount"]))
    if rc.get("show_tax_breakup", True) and t["tax"]:
        label = "GST (incl.)" if cfg["tax"]["mode"] == "inclusive" else "GST"
        e.row(label, money(t["tax"]))
    e.rule("=")
    e.bold().size(1, 2).row("TOTAL", "Rs " + money(t["total"]), e.cols).size(1, 1).bold(False)
    e.rule("=")
    for pay in bill.get("payments", []):
        e.row(pay["mode"].upper(), money(pay["tendered"]))
        if pay.get("change"):
            e.row("Change returned", money(pay["change"]))
    if bill.get("refunds"):
        e.row("Refunded", money(sum(r["amount"] for r in bill["refunds"])))
    e.align("center").line()
    for ln in rc.get("footer_lines") or ["Thank you. Please visit again."]:
        e.line(ln)
    if rc.get("show_powered_by", True):
        e.line("Powered by Nova")
    e.align("left")
    if pr.get("cash_drawer") and bill["status"] == "paid" and not duplicate and any(p["mode"] == "cash" for p in bill.get("payments", [])):
        e.kick_drawer()
    return e.cut().build()


def kot(cfg: dict, ticket: dict, pr: dict) -> bytes:
    e = EscPos(_profile(pr), pr.get("cols"))
    where = f"TABLE {ticket['table']}" if ticket.get("table") else ticket["type"].upper()
    e.align("center").bold().size(2, 2).line(where).size(1, 1).bold(False)
    e.row(f"Bill #{ticket['bill_no']}  KOT {ticket.get('kot_no', 1)}", ticket["station"].upper())
    e.line(_local(cfg, ticket["created_at"])).align("left").rule("=")
    for ln in ticket["lines"]:
        e.bold().size(1, 2).line(f"{ln['qty']} x {ln['name']}").size(1, 1).bold(False)
        if ln.get("note"):
            for w in e.wrap("NOTE: " + ln["note"], 3):
                e.bold().line(w).bold(False)
    e.rule("=")
    return e.cut().build()


def test_slip(cfg: dict, pr: dict) -> bytes:
    e = EscPos(_profile(pr), pr.get("cols"))
    e.align("center").bold().size(2, 2).line(cfg["brand"]["name"]).size(1, 1).bold(False)
    e.line("Printer test").line(_profile(pr).label).rule()
    e.align("left").row("Item", "Amount").rule().row("1 x Irani Chai", "40").row("2 x Osmania Biscuit", "20").rule()
    e.align("center").line("Rs 60 | ABC abc 123").line("If you can read this, printing works.")
    return e.cut().build()


__all__ = ["kot", "printer_for", "receipt", "test_slip"]
