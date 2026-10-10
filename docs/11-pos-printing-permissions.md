# POS, billing, printing and role rules

What this phase adds, and the rules behind it. Everything here works for **every restaurant** from the same code. Only config differs.

## Where things are
| Part | Path |
|---|---|
| Bill arithmetic (integer paise, GST, discount sharing) | `backend/nova/billing/calc.py` |
| Bill lifecycle and rules | `backend/nova/services/billing.py` |
| Manager PIN approvals | `backend/nova/services/approvals.py` |
| Counter API | `backend/nova/api/routes_pos.py` (`/v2/pos/...`) |
| ESC/POS bytes (TVS RP 3200, RP 3160, generic 58/80 mm) | `backend/nova/printing/` |
| Print agent for the cashier PC | `print-agent/` |
| Web app (POS, kitchen, live orders, menu, rules) | `web/`, served at `/app/` |
| Tests | `backend/tests/test_pos.py`, `print-agent/test/` |

## Billing
* **Money is integer paise.** The server computes every total. Discounts are shared across lines so the parts add up exactly. GST is *inclusive* or *exclusive* per tenant (`tax.mode`), with an optional per-dish `tax_rate`.
* **Item notes.** A note ("less spicy") belongs to a line. The same dish with a different note is a separate line. Notes print on the kitchen ticket and the bill.
* **Several open bills** per cashier (up to 12 on the server, 6 on the screen) for a crowded counter.
* **Kitchen tickets (KOT).** "Send to kitchen" sends only what is new, one ticket per station, and returns the print bytes. The kitchen screen advances a ticket: new, cooking, ready, served.
* **Split bill.** Move chosen items and quantities to a new bill. The two totals always add up to the original. **Split payment:** pay one bill with cash + UPI, or one share per guest.
* **Safe taps.** Paying twice with the same `Idempotency-Key` collects once. Two screens editing one bill are caught by a `revision` check (409 `STALE_BILL`).
* **Cash.** Change is calculated and printed. UPI and card cannot be over-paid.

## Who can do what
Built-in roles: `owner`, `manager`, `cashier`, `captain`, `kitchen`, `delivery`, `viewer`. Each restaurant's owner can switch rights on or off per role (Setup > Rules & printers). Platform and user-management rights can never be granted this way.

| Action | Permission | owner | manager | cashier | captain | kitchen |
|---|---|:-:|:-:|:-:|:-:|:-:|
| Start a bill, add and change items | `bills.create`, `bills.edit` | yes | yes | yes | yes | no |
| Discount up to the role's limit | `bills.discount` | yes | 30% | 10% | no | no |
| Discount above the limit | `bills.discount.override` | yes | yes | PIN | PIN | no |
| Remove an item already sent to the kitchen | `bills.void_item` | yes | yes | PIN | PIN | no |
| Void a bill | `bills.void` | yes | yes | PIN | PIN | no |
| Split bill, take payment | `bills.split`, `bills.pay` | yes | yes | yes | no | no |
| Print the first bill | `bills.print` | yes | yes | yes | yes | no |
| Reprint a paid bill (marked DUPLICATE) | `bills.reprint` | yes | yes | no | no | no |
| Edit a paid bill (reopen) | `bills.reopen` | yes | yes (24 h) | PIN | PIN | no |
| Refund | `bills.refund` | yes | up to ₹2,000 | PIN | PIN | no |
| Change menu and prices / mark in or out of stock | `menu.edit`, `menu.stock` | yes | yes | no | no | no |
| Move kitchen tickets | `kitchen.update` | yes | yes | no | no | yes |
| Day summary | `reports.view` | yes | yes | no | no | no |

*PIN* means the person can still do it if a manager (or owner) types their PIN on the cashier's screen.

### Manager approval at the counter
1. The server answers 403 `APPROVAL_REQUIRED` and names the permission needed.
2. The manager types their PIN (set once under Rules & printers). `POST /v2/pos/approvals` checks it **only against users who hold that permission**.
3. The cashier's action is repeated with the returned one-time token. The token lasts 2 minutes, is tied to the requester, the permission and the bill, and works once.
4. Five wrong PINs lock that requester out for 10 minutes. The audit log records who asked, who approved, what and why.

### Limits and reasons (per restaurant, `pos.limits`, `pos.reasons_required`)
Discount %, refund amount and the "edit a paid bill" time window are set per role. Voids, item removals after the kitchen has them, refunds and reopening require a short reason.
Every sensitive step is written to the audit log, and every bill keeps its own history.

## Printing (TVS and any ESC/POS printer)
```
browser (POS) --asks--> Nova API  --returns--> ESC/POS bytes (base64)
browser (POS) --posts bytes--> print agent on 127.0.0.1:8989 --> thermal printer
```
* The **backend builds the bytes** (bill, kitchen ticket, test slip) for the tenant's printer model, so every restaurant gets this without writing code. Profiles: `tvs-rp3200`, `tvs-rp3160`, `generic-80`, `generic-58` (48 or 32 columns). Printers are set per restaurant in `pos.printers` (which printer does bills, which does kitchen tickets, optional station such as `beverage`, cash drawer on or off, copies).
* The **agent** is a small Node program with no dependencies, installed on the cashier PC. It only listens on `127.0.0.1` and only for the origins you list. See `print-agent/README.md`.
* Thermal printers cannot print the rupee sign or Telugu in text mode, so text is transliterated (`₹` becomes `Rs`). Telugu on paper needs image printing (later).
* If the agent is not running the POS says so in the top bar and nothing is lost: the bill is still saved and can be printed from "Paid bills".

## What is real and what is a preview
Real and tested: billing, notes, KOT, split, payments, approvals, refunds, reopen, reprint, role rules, printing, kitchen, live orders, menu, day summary.
Design preview with made-up numbers (labelled on screen): queue, tables and QR, CRM, offers, staff, social, ads, traffic, WhatsApp, reports and connections. Each becomes real when its account is connected (Meta, Google, WhatsApp Business) in a later phase.

## Not done yet (known)
* Offline billing at the counter (queue and sync later); the screen needs the internet today.
* Real hardware check with a TVS RP 3200 on a Windows PC. The bytes follow the standard ESC/POS commands and the agent is tested with a fake printer, but nobody has pressed print on the actual device yet. Do the **test slip** first.
* Customer-facing UPI QR and card machine integration. The cashier confirms the payment by hand.
* Moving the existing Hyderabadi Irani data into this platform.
