"""按凭证做往来账龄（FIFO）。

思路：
  1. 期初余额视为 2024-12-31 的一笔，落在「1-2 年」；
  2. 逐张凭证按日期处理：借方（发生/开票）新增一笔，贷方（收款）按 FIFO 冲最早的；
  3. 年末剩下的每笔按日期落到 1年以内 / 1-2年 / 2-3年 / 3年以上。

只对能拿到凭证、且明细到客户的科目有效（应收账款、其他应收款等）。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .tb import TB
from .vouchers import Entry


@dataclass
class Lot:
    date: str
    amount: float


def _year(date: str) -> int:
    m = re.search(r"(\d{4})", date or "")
    return int(m.group(1)) if m else 0


def buckets_for(entries: list[Entry], opening: float, code: str,
                *, liability: bool = False) -> list[float]:
    """返回 [1年以内, 1-2年, 2-3年, 3年以上] 四个账龄段余额（正数）。

    liability=False：借方为新增（应收），贷方为收回；
    liability=True ：贷方为新增（应付），借方为付款。
    """
    lots: list[Lot] = []
    if abs(opening) > 0.004:
        lots.append(Lot("2024-12-31", opening))
    for e in sorted((x for x in entries if x.code == code), key=lambda x: x.date):
        amt = (e.credit - e.debit) if liability else (e.debit - e.credit)
        if abs(amt) < 0.004:
            continue
        if amt > 0:
            need = amt
            # 先冲掉之前的贷方余额（预收），再记一笔新的借方
            while need > 0.004 and lots and lots[0].amount < 0:
                take = min(-lots[0].amount, need)
                lots[0].amount += take
                need -= take
                if lots[0].amount >= -0.004:
                    lots.pop(0)
            if need > 0.004:
                lots.append(Lot(e.date or "2025-12-31", need))
        else:
            need = -amt
            while need > 0.004 and lots and lots[0].amount > 0:
                take = min(lots[0].amount, need)
                lots[0].amount -= take
                need -= take
                if lots[0].amount <= 0.004:
                    lots.pop(0)
            if need > 0.004:
                lots.append(Lot(e.date or "2025-12-31", -need))
    out = [0.0, 0.0, 0.0, 0.0]
    for lot in lots:
        y = _year(lot.date)
        age = 2025 - y if y else 0
        idx = 0 if age <= 0 else 1 if age == 1 else 2 if age == 2 else 3
        out[idx] += lot.amount
    return [round(x, 2) for x in out]


def aging_by_account(tb: TB, entries: list[Entry], std: str, *,
                     liability: bool = False) -> dict[str, list[float]]:
    pool = [a for a in tb.accounts if a.std == std]
    leaves = [a for a in pool if not any(b is not a and b.key.startswith(a.key) for b in pool)] or pool
    codes = {a.code: a for a in leaves}
    out = {}
    sign = -1.0 if liability else 1.0
    for a in leaves:
        if abs(a.end) < 0.004:
            continue
        rows = [e for e in entries if e.code == a.code]
        if not rows:
            rows = [e for e in entries if e.code.startswith(a.code)]
        if not rows:
            # 凭证记在父级科目上（如 2202 而非 2202.01）：借用父级凭证，
            # 但仅当本科目余额与父级一致时才用，避免多子科目重复。
            parent_rows = [e for e in entries if a.code.startswith(e.code)]
            if parent_rows and abs(abs(a.end) - abs(sign * sum(
                    e.debit - e.credit for e in parent_rows))) < 1:
                rows = parent_rows
        opening = sign * a.begin
        if rows:
            b = buckets_for(rows, opening, a.code, liability=liability)
        elif abs(a.end - a.begin) < 0.004:
            # 无发生额：期初那笔按 1-2 年处理
            b = [0.0, round(sign * a.end, 2), 0.0, 0.0]
        else:
            b = [round(sign * a.end, 2), 0.0, 0.0, 0.0]
        out[a.code] = b
    return out
