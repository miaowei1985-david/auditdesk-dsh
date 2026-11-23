"""未分配利润审定表填充。

表结构（3流动负债&权益 → 未分配利润审定表）：
    B8  上期期末余额 (输入)
    B13 本期净利润 (输入)
    B15 提取盈余公积 / B16 对所有者的分配 / B17 其他
    B21 本期期末余额 = 期初 + 净利润 − 利润分配 ± 内部结转（公式）

策略：以 TB 为准取期初/期末，倒推出分配额，再用凭证摘要归集公积与股利。
    期末 = 期初 + 净利润 − 分配  ⇒  净利润 = 期末 − 期初 + 分配
分配拿不到证据时置 0，并把「TB 净额 vs 损益表净利润」的差额写进备注，不硬凑。
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from ..tb import TB
from ..template import Template
from ..vouchers import Entry

NOTE = "分配额按凭证摘要归集；净利润按未分配利润变动倒推，与损益表差 {diff:,.2f}（{reason}）"


def _n(v) -> str:
    return re.sub(r"[\s\u3000]+", "", str(v or ""))


def _letter(c: int) -> str:
    s = ""
    while c:
        c, r = divmod(c - 1, 26)
        s = chr(65 + r) + s
    return s


def _leaves(tb: TB, std: str):
    pool = [a for a in tb.accounts if a.std == std]
    if not pool:
        return []
    return [a for a in pool if not any(b is not a and b.key.startswith(a.key) for b in pool)] or pool


def _sum(tb: TB, std: str, field: str) -> float:
    return sum(getattr(a, field) for a in _leaves(tb, std))


def _find_row(ws, label: str) -> int | None:
    for r in range(1, ws.max_row + 1):
        if _n(ws.cell(r, 1).value).startswith(label):
            return r
    return None


def fill_retained(tpl: Template, tb: TB, *, entries: list[Entry] | None = None,
                  sheet: str = "未分配利润审定表",
                  pl_net: float | None = None) -> dict:
    ws = tpl.sheet(sheet)
    rows = {
        "open": _find_row(ws, "一、上期期末余额"),
        "profit": _find_row(ws, "三、本期净利润"),
        "dist": _find_row(ws, "四、利润分配"),
        "surplus": _find_row(ws, "1.提取盈余公积"),
        "dividend": _find_row(ws, "2.对所有者"),
        "other": _find_row(ws, "3.其他"),
        "close": _find_row(ws, "六、本期期末余额"),
    }
    if any(v is None for v in (rows["open"], rows["profit"], rows["surplus"], rows["close"])):
        return {"ok": False, "reason": f"行识别失败 {rows}"}

    begin = _sum(tb, "4104", "begin") + _sum(tb, "4103", "begin")
    end = _sum(tb, "4104", "end") + _sum(tb, "4103", "end")
    opening = round(-begin, 2)
    closing = round(-end, 2)

    # 分配：提取盈余公积 = 4101 贷方发生；股利 = 4104 凭证摘要
    surplus = sum(a.credit for a in _leaves(tb, "4101"))
    dividend = 0.0
    samples = []
    if entries:
        for e in entries:
            if e.debit and "4104" in e.code and any(k in e.summary for k in ("股利", "分红")):
                dividend += e.debit
                if len(samples) < 5:
                    samples.append((e.date, e.summary, e.debit))
    allocations = round(surplus + dividend, 2)
    profit = round(closing - opening + allocations, 2)

    tpl.put(sheet, f"B{rows['open']}", opening, "TB 4104+4103 期初（贷方为正）")
    tpl.put(sheet, f"B{rows['profit']}", profit, "期末−期初+分配（倒推）")
    if surplus:
        tpl.put(sheet, f"B{rows['surplus']}", round(surplus, 2), "TB 4101 贷方发生")
    if dividend:
        tpl.put(sheet, f"B{rows['dividend']}", round(dividend, 2), "凭证 4104 分红摘要")
    residual = round(allocations - surplus - dividend, 2)
    if residual:
        tpl.put(sheet, f"B{rows['other']}", residual, "其他分配（倒挤）")

    diff = None
    reason = ""
    if pl_net is not None:
        diff = round(profit - pl_net, 2)
        reason = "损益表净利润" if abs(diff) > 0.01 else "一致"
        note_row = rows["close"]
        note_col = None
        for c in range(1, ws.max_column + 1):
            if "备注" in _n(ws.cell(6, c).value) or "备注" in _n(ws.cell(7, c).value):
                note_col = c
        if note_col and abs(diff) > 0.01:
            tpl.put(sheet, f"{_letter(note_col)}{rows['profit']}",
                    NOTE.format(diff=diff, reason=reason), "TB 与损益表差异")

    return {"ok": True, "opening": opening, "profit": profit, "closing": closing,
            "surplus": round(surplus, 2), "dividend": round(dividend, 2),
            "allocations": allocations, "pl_diff": diff, "samples": samples}
