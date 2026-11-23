"""Template workbook access: read structure, write data, keep formulas."""
from __future__ import annotations

import shutil
from dataclasses import dataclass, field
from pathlib import Path

import openpyxl


@dataclass
class Write:
    sheet: str
    cell: str
    value: object
    basis: str          # evidence / source of the figure
    kind: str = "data"  # data | header | note


class Template:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.wb = openpyxl.load_workbook(self.path, keep_vba=self.path.suffix.lower() == ".xlsm")
        self.writes: list[Write] = []
        self.skipped: list[Write] = []

    # ---- structure -------------------------------------------------
    @property
    def sheets(self) -> list[str]:
        return list(self.wb.sheetnames)

    def sheet(self, name: str):
        return self.wb[name]

    def formula_map(self, name: str) -> dict[str, str]:
        ws = self.wb[name]
        out = {}
        for row in ws.iter_rows():
            for cell in row:
                if isinstance(cell.value, str) and cell.value.startswith("="):
                    out[cell.coordinate] = cell.value
        return out

    def labels(self, name: str, max_col: int = 6) -> dict[int, str]:
        """row -> first text label in columns A..F."""
        ws = self.wb[name]
        out = {}
        for r in range(1, ws.max_row + 1):
            for c in range(1, max_col + 1):
                v = ws.cell(r, c).value
                if isinstance(v, str) and v.strip() and not v.startswith("="):
                    out[r] = v.strip()
                    break
        return out

    # ---- writing ---------------------------------------------------
    def put(self, sheet: str, cell: str, value, basis: str, kind: str = "data") -> None:
        ws = self.wb[sheet]
        target = ws[cell]
        if target.__class__.__name__ == "MergedCell":
            # write to the top-left cell of the merged range
            for rng in ws.merged_cells.ranges:
                if cell in rng:
                    target = ws.cell(rng.min_row, rng.min_col)
                    cell = target.coordinate
                    break
        if kind == "data" and isinstance(target.value, str) and target.value.startswith("="):
            # 公式格绝不覆盖：模板里的 =H9 是设计好的联动
            self.skipped.append(Write(sheet=sheet, cell=cell, value=target.value,
                                      basis="公式格，跳过写入", kind="skipped"))
            return
        target.value = value
        self.writes.append(Write(sheet=sheet, cell=cell, value=value, basis=basis, kind=kind))

    def prefill_directory(self, client: str, period: str, *, preparer: str = "",
                          reviewer: str = "", date: str = "", accounting: str = "") -> None:
        ws = self.wb["工作表目录"]
        ws["C3"] = f"被审计单位：{client}"
        ws["C4"] = f"财务报表截止日/期间：{period}"
        if preparer:
            ws["D3"] = f"编制人：{preparer}"
        if reviewer:
            ws["D4"] = f"复核人：{reviewer}"
        if date:
            ws["F3"] = f"日期：{date}"
            ws["F4"] = f"日期：{date}"
        if accounting:
            for r in range(6, 10):
                label = ws.cell(r, 3).value or ""
                if accounting in str(label):
                    ws.cell(r, 2).value = "√"
                    break
        self.writes.append(Write("工作表目录", "C3", ws["C3"].value, "客户基本信息", "header"))

    def save(self, out: str | Path) -> Path:
        out = Path(out)
        out.parent.mkdir(parents=True, exist_ok=True)
        self.wb.save(out)
        return out

    def report(self) -> list[dict]:
        return [w.__dict__ for w in self.writes]

    def dump_report(self, path: str | Path) -> Path:
        import csv

        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", newline="", encoding="utf-8-sig") as fh:
            w = csv.writer(fh)
            w.writerow(["sheet", "cell", "value", "kind", "basis"])
            for x in self.writes:
                w.writerow([x.sheet, x.cell, x.value, x.kind, x.basis])
        return path


def copy_template(src: Path, dst: Path) -> Path:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return dst
