"""往来类底稿（应收/预付/其他应收/应付/预收/其他应付）填充。

结构（所里模板统一）：
    明细表  A序号 B单位编码 C单位名称 D关联方 E款项性质
            F期初余额 G期末余额(调整前) H审计调整 I调整后
            J.. 期末账龄列
    审定表  1年以内 / 1—2年 / 2—3年 / 3年以上 / 合计
            B期初数 C审计调整 E期末调整前 F审计调整

客户通常只给科目余额表的往来明细（按单位设子科目），不提供账龄表。
策略：
  1. 明细表按子科目逐单位填名称、期初、期末（数据有据）；
  2. 账龄拿不到时，把期末数暂列「1年以内」，并在备注写明假设；
     —— 该假设同时写入明细表账龄列与审定表，保证模板内部核对列（J列）为 0，
        并在填写清单和报告里标为「待取证」，不静默当作事实。
  3. 负债类按贷方为正（乘 -1）。
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from ..tb import TB, Account
from ..template import Template


@dataclass
class Subject:
    name: str
    std: str
    detail_sheet: str
    summary_sheet: str
    fs_line: str
    sign: float


SUBJECTS = [
    Subject("应收账款", "1122", "应收账款明细表", "应收账款审定表", "应收账款", 1),
    Subject("预付款项", "1123", "预付款项明细表", "预付款项审定表", "预付款项", 1),
    Subject("其他应收款", "1221", "其他应收款明细表", "其他应收款审定表", "其他应收款", 1),
    Subject("应付账款", "2202", "应付账款明细表", "应付账款审定表", "应付账款", -1),
    Subject("预收款项", "2203", "预收款项明细表", "预收款项审定表", "预收款项", -1),
    Subject("其他应付款", "2241", "其他应付款明细表", "其他应付款审定表", "其他应付款", -1),
]

ASSUME_NOTE = "账龄未取得（客户未提供序时账/账龄表），暂全额列示1年以内"
ASSUME_NOTE_NO_DETAIL = "序时账无该科目逐户明细，无法账龄，暂全额列示1年以内（待客户提供往来明细）"
BUCKET_LABELS = ("1年以内", "1—2年", "2—3年", "3年以上")

# 往来重分类配对：正方向余额留本科目，反方向余额重分类到对面科目
COUNTERPART = {"1122": "2203", "2203": "1122", "1123": "2202", "2202": "1123",
               "1221": "2241", "2241": "1221"}


def _n(v) -> str:
    return re.sub(r"[\s\u3000]+", "", str(v or ""))


def leaves(tb: TB, std: str) -> list[Account]:
    pool = [a for a in tb.accounts if a.std == std]
    if not pool:
        return []
    out = [a for a in pool if not any(b is not a and b.key.startswith(a.key) for b in pool)]
    return sorted(out or pool, key=lambda a: a.key)


def routed_items(tb: TB, subj: "Subject", keep_negatives: bool = False) -> list[tuple[Account, float]]:
    """Accounts of this subject plus反向余额 from the paired subject.

    Returns (account, amount-in-this-subject-direction) with amount > 0.
    """
    pairs = [subj.std]
    if not keep_negatives and subj.std in COUNTERPART:
        pairs.append(COUNTERPART[subj.std])
    out = []
    for idx, std in enumerate(pairs):
        for a in leaves(tb, std):
            amt = subj.sign * a.end
            if idx == 0:
                # 本科目：keep_negatives 时正负都保留（客户把贷方余额留在本科目净额列示），
                # 否则只取正向，贷方余额交给对方科目重分类
                if abs(amt) > 0.004 and (keep_negatives or amt > 0):
                    out.append((a, amt))
            elif amt > 0:
                # 对方科目：只取反向余额（如应收里的预付、预收里的应收）
                out.append((a, amt))
    return out


def _clean(name: str) -> str:
    t = str(name or "")
    for sep in ("_", "-"):
        if sep in t:
            head, _, tail = t.partition(sep)
            if len(head) <= 8 and tail:
                t = tail
    return t.strip("_- ")


def _detail_cols(ws) -> dict[str, int]:
    cols: dict[str, int] = {}
    for r in range(1, 12):
        for c in range(1, min(ws.max_column, 20) + 1):
            t = _n(ws.cell(r, c).value)
            if not t:
                continue
            if "单位名称" in t and "name" not in cols:
                cols["name"] = c
            elif "单位编码" in t and "code" not in cols:
                cols["code"] = c
            elif "期初余额" in t and "begin" not in cols:
                cols["begin"] = c
            elif t.endswith("期末余额") and "end_group" not in cols:
                cols["end_group"] = c
            elif t == "调整前" and "before" not in cols:
                cols["before"] = c
            elif "1年" in t and "aging1" not in cols:
                cols["aging1"] = c
            elif "备注" in t and "note" not in cols:
                cols["note"] = c
    return cols


def _summary_cols(ws) -> dict[str, int]:
    cols: dict[str, int] = {}
    for r in range(1, 12):
        for c in range(1, min(ws.max_column, 25) + 1):
            t = _n(ws.cell(r, c).value)
            if not t:
                continue
            if "期初数" in t and "begin" not in cols:
                cols["begin"] = c
            # "期末余额" group header; the pre-adjustment sub column is 调整前
            if t == "调整前" and "end" not in cols:
                cols["end"] = c
            if "审计调整" in t and "adj" not in cols:
                # prefer the sub-column 审计调整 under 期末余额
                cols.setdefault("adj_candidates", []).append(c)
            if "备注" in t and "note" not in cols:
                cols["note"] = c
    return cols


def _find_row(ws, predicate, start: int = 1, stop: int | None = None) -> int | None:
    stop = stop or ws.max_row
    for r in range(start, stop + 1):
        for c in range(1, min(ws.max_column, 4) + 1):
            if predicate(_n(ws.cell(r, c).value)):
                return r
    return None


def summary_total_row(ws, start: int) -> int | None:
    for r in range(start, min(start + 8, ws.max_row + 1)):
        if "合计" in _n(ws.cell(r, 1).value):
            return r
    return None


def fill_counterparty(tpl: Template, tb: TB, subj: Subject, *,
                      assume_aging: bool = True,
                      aging: dict[str, list[float]] | None = None,
                      extra: list[tuple[str, float, float]] | None = None,
                      keep_negatives: bool = False) -> dict:
    ws = tpl.sheet(subj.detail_sheet)
    cols = _detail_cols(ws)
    summary = {"subject": subj.name, "ok": True, "warnings": [], "cells": 0}

    # the data column is the one under 调整前 (期末余额组的第一列); some
    # sheets label the group one column to the right of it.
    if "before" in cols:
        cols["end"] = cols["before"]
    elif "end_group" in cols:
        cols["end"] = cols["end_group"]

    if "name" not in cols or "begin" not in cols or "end" not in cols:
        return {"ok": False, "subject": subj.name, "reason": f"明细表列识别失败 {cols}"}

    hdr = _find_row(ws, lambda t: t == "序号")
    if hdr is None:
        return {"ok": False, "subject": subj.name, "reason": "明细表未找到表头"}

    # skip the sub-header rows (调整前/审计调整/调整后) then collect data rows
    # until 合计; 序号 cells may be formulas (=A9+1), so do not require digits.
    data_rows = []
    started = False
    for r in range(hdr + 1, ws.max_row + 1):
        a = _n(ws.cell(r, 1).value)
        if "合计" in a:
            break
        if any(_n(ws.cell(r, c).value) in ("调整前", "审计调整", "调整后")
               for c in range(1, 12)):
            started = True
            continue
        if not started:
            continue
        if a or _n(ws.cell(r, 3).value):
            data_rows.append(r)

    parts = routed_items(tb, subj, keep_negatives=keep_negatives)
    if extra:
        from ..tb import Account

        for i, (nm, b, e) in enumerate(extra):
            if abs(e) > 0.004:
                parts.append((Account(code=f"EXT{i}", name=nm, begin=b, end=e), e))
    if not parts:
        summary["warnings"].append("TB 无该科目余额，未填")
        return summary

    capacity = len(data_rows)
    if capacity == 0:
        return {"ok": False, "subject": subj.name, "reason": "明细表无数据行"}

    groups: list[list[tuple[Account, float]]] = [[] for _ in range(capacity)]
    for i, a in enumerate(parts):
        groups[min(i, capacity - 1)].append(a)
    if len(parts) > capacity:
        summary["warnings"].append(
            f"往来单位 {len(parts)} 个超过模板行 {capacity}，超出部分并入最后一行")

    def L(c: int) -> str:
        s = ""
        while c:
            c, r = divmod(c - 1, 26)
            s = chr(65 + r) + s
        return s

    total_begin = total_end = 0.0
    for row, group in zip(data_rows, groups):
        if not group:
            continue
        begin = sum(subj.sign * a.begin for a, _ in group)
        end = sum(amt for _, amt in group)
        name = _clean(group[0][0].name) if len(group) == 1 else (
            f"{_clean(group[0][0].name)} 等{len(group)}个单位")
        basis = "TB " + ",".join(a.code for a, _ in group)
        tpl.put(subj.detail_sheet, f"{L(cols['name'])}{row}", name, basis + " 科目名称")
        tpl.put(subj.detail_sheet, f"{L(cols['begin'])}{row}", round(begin, 2), basis + " 期初")
        tpl.put(subj.detail_sheet, f"{L(cols['end'])}{row}", round(end, 2), basis + " 期末")
        if "before" in cols:
            pass  # 调整前 is the same column as end in most sheets
        summary["cells"] += 3
        buckets = None
        if aging:
            buckets = [0.0, 0.0, 0.0, 0.0]
            for a, _ in group:
                b = aging.get(a.code)
                if b:
                    buckets = [x + y for x, y in zip(buckets, b)]
        if buckets is not None and "aging1" in cols:
            for i, key in enumerate(("aging1", "aging2", "aging3", "aging4")):
                c = cols.get(key)
                if c and abs(buckets[i]) > 0.004:
                    tpl.put(subj.detail_sheet, f"{L(c)}{row}", round(buckets[i], 2),
                            "按凭证 FIFO 计算的账龄")
                    summary["cells"] += 1
            summary["aged"] = True
        elif assume_aging and "aging1" in cols:
            note = ASSUME_NOTE if aging is None else ASSUME_NOTE_NO_DETAIL
            tpl.put(subj.detail_sheet, f"{L(cols['aging1'])}{row}", round(end, 2), note)
            summary["cells"] += 1
        total_begin += begin
        total_end += end

    # 审定表：账龄行
    sws = tpl.sheet(subj.summary_sheet)
    scols = _summary_cols(sws)
    r0 = _find_row(sws, lambda t: "1年以内" in t and "合计" not in t)
    if r0 is None:
        summary["warnings"].append("审定表未找到账龄行")
        return summary
    if "begin" in scols:
        tpl.put(subj.summary_sheet, f"{L(scols['begin'])}{r0}", round(total_begin, 2),
                "明细表期初合计")
        summary["cells"] += 1
    if summary.get("aged") and aging:
        # 账龄已按凭证算：期初全部落 1 年以内，期末按四段填
        bucket_totals = [0.0, 0.0, 0.0, 0.0]
        for a, amt in parts:
            b = aging.get(a.code)
            if b:
                bucket_totals = [x + y for x, y in zip(bucket_totals, b)]
        if "begin" in scols:
            tpl.put(subj.summary_sheet, f"{L(scols['begin'])}{r0}", round(total_begin, 2),
                    "期初合计（上期均为 1 年以内）")
            summary["cells"] += 1
        if "end" in scols:
            for i in range(4):
                cand = _find_row(sws, lambda t, i=i: BUCKET_LABELS[i] in t,
                                 start=r0, stop=r0 + 4)
                if cand and abs(bucket_totals[i]) > 0.004:
                    tpl.put(subj.summary_sheet, f"{L(scols['end'])}{cand}", round(bucket_totals[i], 2),
                            "账龄（凭证 FIFO）")
                    summary["cells"] += 1
    elif "end" in scols:
        tpl.put(subj.summary_sheet, f"{L(scols['end'])}{r0}", round(total_end, 2),
                "明细表期末合计（暂列1年以内）")
        summary["cells"] += 1
    note_col = scols.get("note")
    if note_col and assume_aging:
        note = ASSUME_NOTE if aging is None else ASSUME_NOTE_NO_DETAIL
        tpl.put(subj.summary_sheet, f"{L(note_col)}{r0}", note, note)
        summary["cells"] += 1

    reclass_in = round(sum(amt for a, amt in parts if a.std != subj.std), 2)
    summary.update({"begin": round(total_begin, 2), "end": round(total_end, 2),
                    "units": len(parts), "rows": capacity, "reclass_in": reclass_in})
    if reclass_in > 0.01 and note_col:
        tpl.put(subj.summary_sheet, f"{L(note_col)}{r0}",
                f"含往来重分类 {reclass_in:,.2f}（来自{COUNTERPART[subj.std]}反方向余额，报表可能按净额列示）",
                "重分类说明")
        summary["cells"] += 1
    return summary
