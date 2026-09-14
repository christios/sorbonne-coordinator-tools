"""Session details are written with formatting now, and arrive as HTML.

Two things read them. The exported document wants real bold, real italics and real lists,
so it is given the pieces to build them with. Everything else — the preview, the year-on-year
comparison, a cell that is only ever plain — wants the words, with a list's markers kept
because they carry meaning.

A value written before any of this existed has no tags in it, and is treated as the plain
text it is rather than being mangled into markup.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from html.parser import HTMLParser
import re


TAG = re.compile(r"<(p|div|br|ul|ol|li|h[1-6]|strong|b|em|i|u)\b[^>]*>", re.IGNORECASE)
INLINE = {"strong", "b", "em", "i", "u", "span", "a"}
HEADINGS = {"h1", "h2", "h3", "h4", "h5", "h6"}


def is_rich_text(value: str) -> bool:
    return bool(TAG.search(value or ""))


@dataclass
class Piece:
    """A stretch of text and how it is set."""

    text: str
    bold: bool = False
    italic: bool = False


BULLETS = ("•", "◦", "▪")


def _roman(value: int) -> str:
    numerals = ((10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i"))
    written = ""
    for size, numeral in numerals:
        while value >= size:
            written += numeral
            value -= size
    return written


@dataclass
class Block:
    """One paragraph of the value: its pieces, what kind it is, and how deeply nested."""

    pieces: list[Piece] = field(default_factory=list)
    kind: str = "paragraph"  # paragraph | heading | subheading | bullet | number
    number: int = 0
    level: int = 0
    numbering: str = "1"

    @property
    def marker(self) -> str:
        """What a list item is written with — a bullet for its depth, or its number."""
        if self.kind == "bullet":
            return BULLETS[min(self.level, len(BULLETS) - 1)]
        if self.kind != "number":
            return ""
        if self.numbering == "a":
            return f"{chr(ord('a') + (self.number - 1) % 26)}."
        if self.numbering == "i":
            return f"{_roman(self.number)}."
        return f"{self.number}."

    @property
    def text(self) -> str:
        written = "".join(piece.text for piece in self.pieces).strip()
        if not written:
            return ""
        marker = self.marker
        indent = "    " * self.level
        return f"{indent}{marker} {written}" if marker else written


class _Reader(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[Block] = []
        self._current = Block()
        self._bold = 0
        self._italic = 0
        self._lists: list[str] = []
        self._counts: list[int] = []
        self._numberings: list[str] = []

    def _close(self) -> None:
        if self._current.pieces:
            self.blocks.append(self._current)
        self._current = Block()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        _attrs = attrs
        if tag in {"strong", "b"}:
            self._bold += 1
        elif tag in {"em", "i"}:
            self._italic += 1
        elif tag in {"ul", "ol"}:
            self._close()
            self._lists.append(tag)
            self._counts.append(0)
            self._numberings.append(dict(_attrs).get("type") or "1")
        elif tag == "li":
            self._close()
            self._current.level = max(0, len(self._lists) - 1)
            if self._lists and self._lists[-1] == "ol":
                self._counts[-1] += 1
                self._current.kind = "number"
                self._current.number = self._counts[-1]
                self._current.numbering = self._numberings[-1]
            else:
                self._current.kind = "bullet"
        elif tag in HEADINGS:
            self._close()
            self._current.kind = "subheading" if tag in {"h4", "h5", "h6"} else "heading"
        elif tag in {"p", "div", "br"}:
            self._close()

    def handle_endtag(self, tag: str) -> None:
        if tag in {"strong", "b"}:
            self._bold = max(0, self._bold - 1)
        elif tag in {"em", "i"}:
            self._italic = max(0, self._italic - 1)
        elif tag in {"ul", "ol"}:
            self._close()
            if self._lists:
                self._lists.pop()
                self._counts.pop()
                self._numberings.pop()
        elif tag in {"li", "p", "div", *HEADINGS}:
            self._close()

    def handle_data(self, data: str) -> None:
        text = re.sub(r"\s+", " ", data)
        if not text.strip() and not self._current.pieces:
            return
        self._current.pieces.append(Piece(text, bold=self._bold > 0, italic=self._italic > 0))


def blocks(value: str) -> list[Block]:
    """The value as paragraphs. Plain text is one paragraph per line."""
    if not value:
        return []
    if not is_rich_text(value):
        return [Block([Piece(line)]) for line in value.split("\n") if line.strip()]
    reader = _Reader()
    reader.feed(value)
    reader._close()
    return [block for block in reader.blocks if block.text]


def to_plain(value: str) -> str:
    return "\n".join(block.text for block in blocks(value) if block.text)
