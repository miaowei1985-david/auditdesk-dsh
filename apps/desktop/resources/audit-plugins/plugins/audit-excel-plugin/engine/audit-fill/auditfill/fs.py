"""Financial statement (资产负债表 / 利润表) reader.

Layouts vary: two-sided Chinese BS with/without 行次, 期末 first or 年初 first,
single-sided IFRS-ish layouts, separate 资产表 / 负债表 sheets.  We anchor on
the header row and on label/number column pairing instead of fixed offsets.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .reader import Grid, load_grid

END_KEYS = ("期末余额", "期末数", "年末余额", "年末数", "期末",
            "本年累计额", "本年累计数", "本年累计金额", "本年累计", "累计金额", "本年金额")
BEGIN_KEYS = ("年初余额", "年初数", "期初余额", "期初数", "年初",
              "本期发生额", "本期金额", "本期数", "本月数", "本月金额", "本月发生额", "上年金额")
LABEL_KEYS = ("项目", "资产", "负债", "所有者权益", "科目")
TOTAL_ASSETS = ("资产总计", "资产合计", "资产总额", "资产总计（或股东权益）")
TOTAL_LIAB = ("负债合计", "负债总计", "负债总额")
TOTAL_EQ = ("所有者权益合计", "股东权益合计", "所有者权益（或股东权益）合计", "净资产合计")
TOTAL_LE = ("负债和所有者权益", "负债及所有者权益", "负债和股东权益")


def _norm(s) -> str:
    if s is None:
        return ""
    from .chart import to_simplified

    t = to_simplified(str(s)).replace("\u3000", "").replace(" ", "").replace("\n", "").strip()
    return t


def _num(v) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace(",", "").replace(" ", "").strip()
    if s in ("", "-", "—", "--", "——"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def clean_label(s: str) -> str:
    t = _norm(s)
    t = re.sub(r"^[一二三四五六七八九十]+、", "", t)
    t = re.sub(r"^(其中|减)[:：]?", "", t)
    t = re.sub(r"[\d.]+$", "", t) if re.search(r"[（(]\d+[)）]$", t) else t
    return t


@dataclass
class Statement:
    path: str
    sheet: str
    kind: str                      # bs | is
    rows: dict[str, dict] = field(default_factory=dict)   # label -> {end, begin, row}

    def get(self, *labels: str) -> dict | None:
        """Match labels in the order given; within one label prefer exact.

        Order matters: for 固定资产 the caller passes 净额/净值/账面价值 before
        原价, because "固定资产原价" also contains "固定资产".
        """
        for lab in labels:
            best, best_score = None, -1
            for k, v in self.rows.items():
                if k == lab:
                    score = 4
                elif lab in k:
                    score = 1 if ("流动" in k and "流动" not in lab) else 2
                else:
                    continue
                if score > best_score:
                    best, best_score = v, score
            if best is not None:
                return best
        return None

    def total(self, *labels: str) -> float | None:
        row = self.get(*labels)
        return row["end"] if row else None


def parse_sheet(grid: Grid) -> Statement | None:
    # header row
    h = None
    for r in range(min(grid.nrows, 15)):
        texts = [_norm(grid.cell(r, c)) for c in range(grid.ncols)]
        joined = "|".join(texts)
        def _is_end(t):
            return any(k in t for k in END_KEYS) or ("累计" in t and "累计" not in ("",))

        def _is_begin(t):
            return any(k in t for k in BEGIN_KEYS) or ("本月" in t and "累计" not in t)

        if any(_is_end(t) for t in texts) and any(_is_begin(t) for t in texts):
            h = r
            break
    if h is None:
        return None

    headers = [(c, _norm(grid.cell(h, c))) for c in range(grid.ncols)]
    end_cols = [c for c, t in headers if any(k in t for k in END_KEYS) or "累计" in t]
    begin_cols = [c for c, t in headers if any(k in t for k in BEGIN_KEYS) or ("本月" in t and "累计" not in t)]
    label_cols = [c for c, t in headers if any(k in t for k in LABEL_KEYS)]
    if not label_cols:
        label_cols = [c for c, t in headers if t and not any(k in t for k in END_KEYS + BEGIN_KEYS)]
    if not end_cols or not label_cols:
        return None

    # side assignment: numeric column belongs to nearest label column on its left
    def side_of(c: int) -> int:
        cand = [x for x in label_cols if x <= c]
        return max(cand) if cand else label_cols[0]

    end_map = {side_of(c): c for c in end_cols}
    begin_map = {side_of(c): c for c in begin_cols}

    sheet_name = _norm(grid.sheet)
    all_labels = "|".join(_norm(grid.cell(r, 0)) for r in range(grid.nrows))
    if "利润" in sheet_name or "损益" in sheet_name:
        kind = "is"
    elif "资产" in sheet_name or "负债" in sheet_name:
        kind = "bs"
    elif any(k in all_labels for k in ("营业收入", "营业总收入", "营业成本", "净利润", "利润总额",
                                       "经营收入", "经营成本", "营业利润")):
        kind = "is"
    else:
        kind = "bs"
    st = Statement(path=grid.path, sheet=grid.sheet, kind=kind)
    for r in range(h + 1, grid.nrows):
        for lc in label_cols:
            label = clean_label(grid.cell(r, lc))
            if not label or label in ("行次",):
                continue
            end = _num(grid.cell(r, end_map[lc])) if lc in end_map else None
            begin = _num(grid.cell(r, begin_map[lc])) if lc in begin_map else None
            if end is None and begin is None and not re.search(r"[:：]", label):
                continue
            # trim trailing section headings like "流动资产:"
            st.rows.setdefault(label, {"end": end, "begin": begin, "row": r})
    return st


class FSBook:
    """A workbook may split statements across sheets (资产表/负债表/利润表).

    Look lines up across all balance-sheet sheets first, then income sheets.
    """

    def __init__(self, statements: list[Statement]):
        self.all = statements
        self.bs = [s for s in statements if s.kind == "bs"]
        self.is_ = [s for s in statements if s.kind == "is"]

    def get(self, *labels: str):
        best = None
        best_key = None
        for s in self.all:
            for lab in labels:
                for k, v in s.rows.items():
                    if v.get("end") is None:
                        continue
                    if k == lab:
                        score = 4
                    elif lab in k:
                        score = 1 if ("流动" in k and "流动" not in lab) else 2
                    else:
                        continue
                    key = (score, len(s.rows), 1 if s.kind == "bs" else 0)
                    if best_key is None or key > best_key:
                        best, best_key = v, key
        return best

    def total(self, *labels: str):
        r = self.get(*labels)
        return r["end"] if r else None


def load_book(path: str) -> FSBook:
    return FSBook(load_statements(path))


def load_statements(path: str) -> list[Statement]:
    from .reader import iter_sheets

    out = []
    for name, grid in iter_sheets(path):
        st = parse_sheet(grid)
        if st and st.rows:
            out.append(st)
    return out


def check_balance(st: Statement) -> dict:
    assets = st.total(*TOTAL_ASSETS)
    liab = st.total(*TOTAL_LIAB)
    eq = st.total(*TOTAL_EQ)
    le = st.total(*TOTAL_LE)
    diff = None
    if assets is not None:
        rhs = le if le is not None else (liab or 0) + (eq or 0) if (liab or eq) else None
        if rhs is not None:
            diff = round(assets - rhs, 2)
    return {"assets": assets, "liab": liab, "equity": eq, "liab_equity": le, "diff": diff}
