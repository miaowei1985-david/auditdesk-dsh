"""Uniform spreadsheet reader for client data.

Clients hand us files whose extension lies: 20 .xls files in the current
corpus are really HTML exports, 5 more are really .xlsx.  Everything is
sniffed by magic bytes before a parser is chosen.
"""
from __future__ import annotations

import io
import os
import zipfile
from dataclasses import dataclass, field
from typing import Any

OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"


@dataclass
class Grid:
    path: str
    fmt: str                      # xlsx | xls | html | pdf
    sheet: str
    sheets: list[str]
    rows: list[list[Any]]         # rectangular, None padded
    nrows: int = 0
    ncols: int = 0

    def __post_init__(self):
        self.nrows = len(self.rows)
        self.ncols = max((len(r) for r in self.rows), default=0)

    def cell(self, r: int, c: int) -> Any:
        if 0 <= r < self.nrows and 0 <= c < self.ncols:
            return self.rows[r][c]
        return None

    def text(self, r: int, c: int) -> str:
        v = self.cell(r, c)
        if v is None:
            return ""
        if isinstance(v, float) and v.is_integer():
            return str(int(v))
        return str(v).replace("\u3000", " ").strip()


def sniff(path: str) -> str:
    with open(path, "rb") as f:
        head = f.read(8)
    if head.startswith(OLE_MAGIC):
        return "xls"
    if head.startswith(b"PK\x03\x04"):
        # could be xlsx or xlsm
        return "xlsx"
    if head.lstrip()[:1] == b"<" or head.lstrip().lower().startswith(b"<!doc"):
        return "html"
    if head.startswith(b"%PDF"):
        return "pdf"
    return "unknown"


def _load_xlsx(path: str, sheet: str | None) -> tuple[str, list[str], list[list[Any]]]:
    import openpyxl

    # openpyxl validates by extension first; several client files lie about it
    # (an .xls that is really xlsx), so always hand it bytes.
    with open(path, "rb") as fh:
        stream = io.BytesIO(fh.read())
    wb = openpyxl.load_workbook(stream, read_only=True, data_only=True)
    try:
        names = list(wb.sheetnames)
        target = sheet or names[0]
        ws = wb[target]
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
        return target, names, rows
    finally:
        wb.close()


def _load_xls(path: str, sheet: str | None) -> tuple[str, list[str], list[list[Any]]]:
    import xlrd

    with open(path, "rb") as fh:
        blob = fh.read()
    wb = xlrd.open_workbook(file_contents=blob, formatting_info=False)
    names = wb.sheet_names()
    target = sheet or names[0]
    ws = wb.sheet_by_name(target)
    rows = []
    for r in range(ws.nrows):
        rows.append([ws.cell_value(r, c) for c in range(ws.ncols)])
    return target, names, rows


def _load_html(path: str, sheet: str | None) -> tuple[str, list[str], list[list[Any]]]:
    import pandas as pd

    with open(path, "rb") as f:
        raw = f.read()
    # html exports from Chinese ERP vendors are commonly GBK or UTF-8
    text = None
    for enc in ("utf-8", "gb18030", "gbk", "big5"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        text = raw.decode("utf-8", "ignore")
    tables = pd.read_html(io.StringIO(text), header=None)
    if not tables:
        raise ValueError("no table found in html")
    names = [f"table{i}" for i in range(len(tables))]

    def score(df) -> int:
        cells = df.astype(str)
        joined = " ".join(cells.values.ravel().tolist())
        return df.shape[0] + 3 * sum(k in joined for k in ("科目", "余额", "发生", "期初", "期末"))

    idx = max(range(len(tables)), key=lambda i: score(tables[i]))
    if sheet and sheet in names:
        idx = names.index(sheet)
    df = tables[idx]
    rows = df.where(pd.notnull(df), None).values.tolist()
    return names[idx], names, rows


def _lo_convert(path: str) -> str:
    """xlrd 读不了（如 NAME 公式）时，借 LibreOffice 转成 xlsx 再读。"""
    import os
    import subprocess
    import tempfile

    out = tempfile.mkdtemp(prefix="lo_conv_")
    subprocess.run(["/Applications/LibreOffice.app/Contents/MacOS/soffice",
                    "-env:UserInstallation=file:///tmp/lo_reader", "--headless",
                    "--convert-to", "xlsx", "--outdir", out, path],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180)
    conv = os.path.join(out, os.path.splitext(os.path.basename(path))[0] + ".xlsx")
    if not os.path.exists(conv):
        raise ValueError(f"convert failed: {path}")
    return conv


def load_grid(path: str, sheet: str | None = None) -> Grid:
    fmt = sniff(path)
    if fmt == "xlsx":
        target, names, rows = _load_xlsx(path, sheet)
    elif fmt == "xls":
        try:
            target, names, rows = _load_xls(path, sheet)
        except Exception:
            conv = _lo_convert(path)
            target, names, rows = _load_xlsx(conv, sheet)
    elif fmt == "html":
        target, names, rows = _load_html(path, sheet)
    else:
        raise ValueError(f"unsupported format {fmt}: {path}")
    width = max((len(r) for r in rows), default=0)
    rows = [list(r) + [None] * (width - len(r)) for r in rows]
    return Grid(path=path, fmt=fmt, sheet=target, sheets=names, rows=rows)


def iter_sheets(path: str):
    """Yield (sheet name, Grid) for every sheet in a workbook."""
    fmt = sniff(path)
    if fmt == "xlsx":
        import openpyxl

        # openpyxl validates by extension first; several client files lie about it
        # (an .xls that is really xlsx), so always hand it bytes.
        with open(path, "rb") as fh:
            stream = io.BytesIO(fh.read())
        wb = openpyxl.load_workbook(stream, read_only=True, data_only=True)
        names = list(wb.sheetnames)
        wb.close()
    elif fmt == "xls":
        import xlrd

        try:
            with open(path, "rb") as fh:
                names = xlrd.open_workbook(file_contents=fh.read()).sheet_names()
        except Exception:
            # xlrd 读不了（NAME 公式等）→ 转 xlsx 后按 xlsx 处理
            conv = _lo_convert(path)
            fmt = "xlsx"
            import openpyxl

            with open(conv, "rb") as fh:
                stream = io.BytesIO(fh.read())
            wb = openpyxl.load_workbook(stream, read_only=True, data_only=True)
            names = list(wb.sheetnames)
            wb.close()
    elif fmt == "html":
        names = ["table0"]
    else:
        raise ValueError(fmt)
    for name in names:
        yield name, load_grid(path, name)
