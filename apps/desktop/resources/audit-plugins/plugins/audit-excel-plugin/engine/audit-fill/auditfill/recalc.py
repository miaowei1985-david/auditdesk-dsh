"""Formula recalculation via the `formulas` engine (pure python)."""
from __future__ import annotations

import re
from pathlib import Path


def _key_part(sheet: str) -> str:
    return sheet


def recalc(path: str | Path, cells: dict[str, list[str]]) -> dict[str, float]:
    """Recalculate a workbook and return requested cell values.

    cells: {sheet: ["B11", "E11"]}
    """
    import formulas

    path = Path(path)
    model = formulas.ExcelModel().loads(str(path)).finish()
    sol = model.calculate()

    # solutions are keyed as "'[book.xlsx]SHEET'!A1"
    flat: dict[str, float] = {}
    for k, v in sol.items():
        try:
            val = v.value[0, 0]
        except Exception:
            continue
        if isinstance(val, (int, float)):
            flat[k] = float(val)

    out = {}
    book = path.name
    for sheet, coords in cells.items():
        for coord in coords:
            candidates = [
                f"'[{book}]{sheet}'!{coord}",
                f"'[{book.upper()}]{sheet}'!{coord}",
            ]
            hit = next((c for c in candidates if c in flat), None)
            if hit is None:
                # fall back: suffix match
                suffix = f"]{sheet}'!{coord}"
                hit = next((k for k in flat if k.endswith(suffix)), None)
            out[f"{sheet}!{coord}"] = flat.get(hit) if hit else None
    return out
