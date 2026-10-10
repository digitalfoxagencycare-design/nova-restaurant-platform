"""ESC/POS byte builder for 58 mm and 80 mm thermal printers (TVS RP 3200 / RP 3160 and generic ESC/POS models).

The backend builds the bytes; a small agent on the cashier PC (or a network printer) just writes them to the printer.
Thermal printers have no Indic or rupee glyph in their default code page, so text is transliterated to plain ASCII
("Rs" for the rupee sign) instead of printing garbage. Telugu or Hindi text on paper needs image printing (a later phase).
"""
from __future__ import annotations

import base64
import unicodedata
from dataclasses import dataclass

ESC, GS, LF = b"\x1b", b"\x1d", b"\n"

_MAP = {"₹": "Rs", "–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "•": "*", "×": "x", "…": "...", " ": " ", "★": "*"}


@dataclass(frozen=True)
class Profile:
    key: str
    label: str
    cols: int            # characters per line in the normal font
    cut: bytes           # cutter command (some models only support a full cut)
    drawer: bool = True  # has a cash-drawer kick port


PROFILES: dict[str, Profile] = {
    "tvs-rp3200": Profile("tvs-rp3200", "TVS RP 3200 (80 mm)", 48, GS + b"V\x41\x00"),
    "tvs-rp3160": Profile("tvs-rp3160", "TVS RP 3160 (80 mm)", 48, GS + b"V\x41\x00"),
    "generic-80": Profile("generic-80", "Generic ESC/POS 80 mm", 48, GS + b"V\x41\x00"),
    "generic-58": Profile("generic-58", "Generic ESC/POS 58 mm", 32, GS + b"V\x41\x00", drawer=False),
}


def ascii_safe(s: str) -> str:
    out = []
    for ch in s:
        if ch in _MAP:
            out.append(_MAP[ch])
            continue
        if ch == "\n" or " " <= ch <= "~":
            out.append(ch)
            continue
        base = unicodedata.normalize("NFKD", ch).encode("ascii", "ignore").decode()
        out.append(base or "?")
    return "".join(out)


def money(paise: int) -> str:
    """Rupees with no symbol, for aligned columns."""
    r, p = divmod(abs(int(paise)), 100)
    s = f"{r:,}"
    s = s if p == 0 else f"{s}.{p:02d}"
    return f"-{s}" if paise < 0 else s


class EscPos:
    def __init__(self, profile: Profile, cols: int | None = None):
        self.p = profile
        self.cols = cols or profile.cols
        self._b = bytearray()
        self.init()

    # --- low level
    def raw(self, b: bytes) -> EscPos:
        self._b += b
        return self

    def init(self) -> EscPos:
        return self.raw(ESC + b"@")

    def align(self, where: str) -> EscPos:
        return self.raw(ESC + b"a" + bytes([{"left": 0, "center": 1, "right": 2}[where]]))

    def bold(self, on: bool = True) -> EscPos:
        return self.raw(ESC + b"E" + bytes([1 if on else 0]))

    def size(self, w: int = 1, h: int = 1) -> EscPos:
        return self.raw(GS + b"!" + bytes([((w - 1) & 7) << 4 | ((h - 1) & 7)]))

    def text(self, s: str) -> EscPos:
        return self.raw(ascii_safe(s).encode("ascii"))

    def line(self, s: str = "") -> EscPos:
        return self.text(s).raw(LF)

    def feed(self, n: int = 1) -> EscPos:
        return self.raw(ESC + b"d" + bytes([n]))

    # --- layout helpers (they know the column width)
    def rule(self, ch: str = "-") -> EscPos:
        return self.line(ch * self.cols)

    def row(self, left: str, right: str, width: int | None = None) -> EscPos:
        w = (width or self.cols)
        left, right = ascii_safe(left), ascii_safe(right)
        room = w - len(right) - 1
        if len(left) > room:
            left = left[: max(0, room)]
        return self.line(left + " " * (w - len(left) - len(right)) + right)

    def wrap(self, s: str, indent: int = 0, width: int | None = None) -> list[str]:
        w = (width or self.cols) - indent
        words, lines, cur = ascii_safe(s).split(), [], ""
        for word in words:
            while len(word) > w:  # a single very long word
                if cur:
                    lines.append(cur)
                    cur = ""
                lines.append(word[:w])
                word = word[w:]
            if len(cur) + len(word) + (1 if cur else 0) > w:
                lines.append(cur)
                cur = word
            else:
                cur = f"{cur} {word}".strip()
        if cur:
            lines.append(cur)
        return [" " * indent + ln for ln in lines] or [""]

    def para(self, s: str, indent: int = 0) -> EscPos:
        for ln in self.wrap(s, indent):
            self.line(ln)
        return self

    # --- hardware
    def cut(self) -> EscPos:
        return self.feed(4).raw(self.p.cut)

    def kick_drawer(self) -> EscPos:
        return self.raw(ESC + b"p\x00\x19\xfa") if self.p.drawer else self

    def build(self) -> bytes:
        return bytes(self._b)

    def b64(self) -> str:
        return base64.b64encode(self.build()).decode()
