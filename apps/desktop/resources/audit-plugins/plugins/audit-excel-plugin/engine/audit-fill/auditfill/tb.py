"""Trial-balance normalisation.

Client exports come in ~10 layout families (Yonyou UFPrn, Kingdee, SAP B1,
Taiwan-style account form, HTML dumps, ledger-style 科目汇总表 ...).  Rather
than one adapter per vendor we detect the header block, map every numeric
column to a semantic role (group / side / unit), then normalise to a signed
debit-positive balance:  end = begin + debit - credit.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from . import chart
from .reader import Grid, load_grid

CODE_RE = re.compile(r"^[A-Za-z]{0,3}[0-9][0-9A-Za-z._\-/]*$")
SKIP_NAME_RE = re.compile(r"^(合计|小计|总计|本页合计|累计|本\s*年\s*累\s*计|期初合计|期末合计)")
HEADER_CODE_KEYS = ("科目编码", "科目代码", "科目编号", "科目代号")
HEADER_NAME_KEYS = ("科目名称", "科目", "名称")
BASE_UNITS = ("本位币", "本币", "人民币", "人民幣", "折合本位币", "记账本位币", "記帳本位幣")
# rows that already aggregate all currencies; a plain 人民币/RMB row is a single
# currency row and must be added to the other currency rows instead.
COMBINED_CURRENCY = {"综合本位币", "本位币", "本币", "折合本位币",
                     "记帐本位币", "记账本位币"}
CURRENCY_BASE = COMBINED_CURRENCY | {"人民币", "人民幣", "rmb", "cny"}
DIM_KEYS = ("核算维度", "辅助", "供应商", "客户", "部门", "员工", "组织机构", "项目", "存货")


def to_number(v: Any) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        f = float(v)
        return None if f != f else f
    s = str(v).strip().replace(",", "").replace("，", "").replace(" ", "")
    if s in ("", "-", "—", "--", "/", "None"):
        return None
    neg = s.startswith("(") and s.endswith(")")
    if neg:
        s = s[1:-1]
    s = s.replace("¥", "").replace("￥", "").replace("$", "")
    try:
        x = float(s)
    except ValueError:
        return None
    return -x if neg else x


@dataclass
class Account:
    code: str
    name: str
    begin: float = 0.0
    debit: float = 0.0
    credit: float = 0.0
    end: float = 0.0
    level: int = 1
    parent: str = ""
    std: str = ""            # canonical CAS subject code
    extra: dict = field(default_factory=dict)

    @property
    def key(self) -> str:
        return norm_code(self.code)


def norm_code(code: str) -> str:
    return str(code).replace(".", "").replace("-", "").replace("_", "").strip()


@dataclass
class TB:
    accounts: list[Account]
    source: str
    sheet: str
    header_rows: tuple[int, int]
    roles: dict[int, tuple]
    warnings: list[str] = field(default_factory=list)

    def by_code(self, code: str) -> Account | None:
        k = norm_code(code)
        for a in self.accounts:
            if a.key == k:
                return a
        return None

    def find(self, prefix: str) -> list[Account]:
        p = norm_code(prefix)
        return [a for a in self.accounts if a.key.startswith(p)]

    def sum_prefix(self, prefix: str) -> float:
        exact = self.by_code(prefix)
        if exact:
            return exact.end
        leaves = [a for a in self.find(prefix) if not any(
            b is not a and b.key.startswith(a.key) and b.key != a.key for b in self.accounts)]
        return sum(a.end for a in leaves)

    def _roots(self, accounts: list[Account]) -> list[Account]:
        keys = {a.key for a in accounts}
        out = []
        for a in accounts:
            if any(b.key != a.key and a.key.startswith(b.key) and b.key in keys for b in accounts):
                continue
            out.append(a)
        return out

    def by_std(self, std: str) -> list[Account]:
        """Top-most accounts carrying a canonical subject code (no double counting)."""
        pool = [a for a in self.accounts if a.std == std]
        return self._roots(pool)

    def end_std(self, std: str) -> float:
        return sum(a.end for a in self.by_std(std))

    def begin_std(self, std: str) -> float:
        return sum(a.begin for a in self.by_std(std))

    def top(self) -> list[Account]:
        return [a for a in self.accounts if a.level == 1]

    def totals(self) -> dict:
        return {
            "begin": sum(a.begin for a in self.top()),
            "debit": sum(a.debit for a in self.top()),
            "credit": sum(a.credit for a in self.top()),
            "end": sum(a.end for a in self.top()),
        }

    def check(self) -> dict:
        t = self.totals()
        row_err = []
        for a in self.accounts:
            diff = a.begin + a.debit - a.credit - a.end
            if abs(diff) > 0.02:
                row_err.append((a.code, a.name, round(diff, 2)))
        return {
            "accounts": len(self.accounts),
            "begin": round(t["begin"], 2),
            "debit": round(t["debit"], 2),
            "credit": round(t["credit"], 2),
            "end": round(t["end"], 2),
            "debit_credit_diff": round(t["debit"] - t["credit"], 2),
            "rollforward_diff": round(t["begin"] + t["debit"] - t["credit"] - t["end"], 2),
            "row_errors": row_err[:8],
            "row_error_count": len(row_err),
        }


def _norm(s: Any) -> str:
    if s is None:
        return ""
    return chart.to_simplified(str(s)).replace("\u3000", "").replace(" ", "").replace("\n", "").replace("\t", "").strip()


def _find_header_rows(grid: Grid) -> tuple[int, int]:
    def is_header_cell(t: str) -> bool:
        if t in ("科目编码", "科目代码", "科目编号", "科目名称", "科目", "代码", "名称", "项目"):
            return True
        return t.startswith("科目") and t.endswith(("编码", "代码", "名称")) and "表" not in t

    start = None
    for r in range(min(grid.nrows, 40)):
        texts = [_norm(grid.cell(r, c)) for c in range(grid.ncols)]
        has_code = any(is_header_cell(t) for t in texts)
        has_amount = any(k in "".join(texts) for k in ("期初", "年初", "余额", "发生", "期末", "借方", "借方余额"))
        if has_amount and has_code:
            start = r
            break
    if start is None:
        raise ValueError(f"header not found in {grid.path}")

    last = start
    for r in range(start + 1, min(grid.nrows, start + 5)):
        row_text = " ".join(_norm(grid.cell(r, c)) for c in range(grid.ncols))
        if not row_text:
            break
        looks_sub = any(k in row_text for k in ("借方", "贷方", "方向", "金额", "本位币", "原币", "余额", "发生"))
        has_code_data = any(CODE_RE.match(grid.text(r, c)) for c in range(min(grid.ncols, 4)))
        if looks_sub and not has_code_data:
            last = r
        else:
            break
    return start, last


GROUP_KEYS = (("期初", "begin"), ("年初", "begin"), ("期末", "end"), ("年末", "end"),
              ("本期", "move"), ("发生", "move"), ("变动", "move"), ("累计", "summove"))


def _header_matrix(grid: Grid, h0: int, h1: int) -> dict[int, str]:
    """Combine the 2-3 header rows per column, emulating merged-cell labels.

    Merged cells only carry their value in the top-left cell in a raw grid, so
    "期初余额" over columns 期初/原币/汇率/本位币 is lost after the first one.
    We forward-fill contiguous group labels within each header row.
    """
    rows = [[_norm(grid.cell(r, c)) for c in range(grid.ncols)] for r in range(h0, h1 + 1)]
    for row in rows:
        last = ""
        for c, t in enumerate(row):
            if t:
                last = t if any(k in t for k in ("期初", "年初", "期末", "年末", "本期", "发生", "变动", "累计", "余额")) else ""
            elif last:
                row[c] = last
    out = {}
    for c in range(grid.ncols):
        parts = [row[c] for row in rows if row[c]]
        if parts:
            out[c] = "|".join(parts)
    return out


def _build_roles(grid: Grid, h0: int, h1: int) -> dict[int, tuple]:
    """column -> (group, side, unit).

    group: begin | end | move | summove
    side:  debit | credit | amount | direction
    unit:  base | orig | none
    """
    texts = _header_matrix(grid, h0, h1)

    explicit: dict[int, str] = {}
    for c, t in texts.items():
        for k, val in GROUP_KEYS:
            if k in t:
                explicit[c] = val
                break
        if c not in explicit and "余额" in t and "期初" not in t and "期末" not in t:
            explicit[c] = "end"

    roles: dict[int, tuple] = {}
    side = ""
    group = ""
    for c in sorted(texts):
        t = texts[c]
        g = explicit.get(c, "")
        if g:
            group = g
        if any(k in t for k in HEADER_CODE_KEYS):
            roles[c] = ("code",)
            continue
        if "科目类别" in t or t == "类别":
            roles[c] = ("category",)
            continue
        if any(seg in ("科目名称", "名称", "项目", "科目") for seg in t.split("|")):
            roles[c] = ("name",)
            continue
        if "币别" in t or "币种" in t:
            roles[c] = ("currency",)
            continue
        if any(k in t for k in DIM_KEYS):
            roles[c] = ("dim",)
            continue
        if any(k in t for k in ("方向", "+/-", "±", "借贷")):
            roles[c] = (g or group or "end", "direction")
            side = ""
            continue
        if "借" in t:
            side = "debit"
        elif "贷" in t:
            side = "credit"
        elif "余额" in t or "金额" in t or "本币" in t or "本位币" in t or "原币" in t:
            if not side:
                side = "amount"
        else:
            continue
        unit = "base" if any(u in t for u in BASE_UNITS) else ("orig" if "原币" in t else "none")
        roles[c] = (group or "end", side, unit)
    return roles


def _best_name_col(grid: Grid, roles: dict[int, tuple], h0: int, h1: int) -> int | None:
    cands = [c for c, r in roles.items() if r == ("name",)]
    if not cands:
        return None

    def score(c: int) -> int:
        text = "|".join(_norm(grid.cell(r, c)) for r in range(h0, h1 + 1))
        s = 0
        if "科目名称" in text:
            s += 5
        if "名称" in text:
            s += 3
        if "科目" in text:
            s += 1
        if "类别" in text or "编码" in text:
            s -= 10
        return s

    return max(cands, key=score)


def _pick(roles: dict[int, tuple], group: str, side: str) -> int | None:
    cands = [(c, r) for c, r in roles.items() if len(r) == 3 and r[0] == group and r[1] == side]
    if not cands:
        return None
    for unit in ("base", "none", "orig"):
        for c, r in cands:
            if r[2] == unit:
                return c
    return cands[0][0]


def parse_tb(path: str, sheet: str | None = None, *, currency: str | None = None) -> TB:
    grid = load_grid(path, sheet)
    h0, h1 = _find_header_rows(grid)
    roles = _build_roles(grid, h0, h1)

    code_col = next((c for c, r in roles.items() if r == ("code",)), None)
    name_col = _best_name_col(grid, roles, h0, h1)
    currency_col = next((c for c, r in roles.items() if r == ("currency",)), None)
    dim_cols = [c for c, r in roles.items() if r == ("dim",)]
    if code_col is None and name_col is None:
        raise ValueError("no code/name column")
    synthetic = code_col is None

    begin_d = _pick(roles, "begin", "debit")
    begin_c = _pick(roles, "begin", "credit")
    begin_a = _pick(roles, "begin", "amount")
    end_d = _pick(roles, "end", "debit")
    end_c = _pick(roles, "end", "credit")
    end_a = _pick(roles, "end", "amount")
    move_d = _pick(roles, "move", "debit") or _pick(roles, "summove", "debit")
    move_c = _pick(roles, "move", "credit") or _pick(roles, "summove", "credit")
    dirs = [c for c, r in roles.items() if len(r) == 2 and r[1] == "direction"]
    begin_dir = _pick(roles, "begin", "direction")
    move_dir = _pick(roles, "move", "direction")
    end_dir = _pick(roles, "end", "direction")

    accounts: list[Account] = []
    warnings: list[str] = []

    def num(c: int | None, r: int) -> float:
        return to_number(grid.cell(r, c)) or 0.0 if c is not None else 0.0

    def num_or_none(c: int | None, r: int) -> float | None:
        return to_number(grid.cell(r, c)) if c is not None else None

    for r in range(h1 + 1, grid.nrows):
        code = grid.text(r, code_col) if code_col is not None else ""
        name = grid.text(r, name_col) if name_col is not None else ""
        if not code and not name:
            continue
        if SKIP_NAME_RE.match(name):
            continue
        if name_col is not None and re.match(r"^\d{3,}[-—.]", name):
            m = re.match(r"^(\d{3,})[-—.]\s*(.*)$", name)
            if m and (not code or not CODE_RE.match(code)):
                code, name = m.group(1), m.group(2)
        if synthetic and not code:
            code = f"@{r:04d}"
        elif not code or not CODE_RE.match(code):
            continue
        if name in ("合计", "小计", "总计") or name.startswith("其中"):
            continue
        derived = []
        if begin_d is not None or begin_c is not None:
            begin = num(begin_d, r) - num(begin_c, r)
            begin_missing = begin_d is not None and num_or_none(begin_d, r) is None and num_or_none(begin_c, r) is None
        elif begin_a is not None:
            dcol = begin_dir if begin_dir is not None else (dirs[0] if dirs else None)
            sign = -1.0 if dcol is not None and "贷" in grid.text(r, dcol) else 1.0
            raw = num_or_none(begin_a, r)
            begin_missing = raw is None
            begin = raw if (raw is not None and raw < 0) else sign * (raw or 0.0)
        else:
            begin, begin_missing = 0.0, True
        if end_d is not None or end_c is not None:
            end = num(end_d, r) - num(end_c, r)
            end_missing = num_or_none(end_d, r) is None and num_or_none(end_c, r) is None
        elif end_a is not None:
            dcol = end_dir if end_dir is not None else (dirs[-1] if dirs else None)
            sign = -1.0 if dcol is not None and "贷" in grid.text(r, dcol) else 1.0
            raw = num_or_none(end_a, r)
            end_missing = raw is None
            # 金额本身已带符号时不要再按方向翻一次（机施等表会把贷方写成负数）
            end = raw if (raw is not None and raw < 0) else sign * (raw or 0.0)
        else:
            end, end_missing = begin, False
        debit = num(move_d, r)
        credit = num(move_c, r)
        # 外币明细常只给小计/原币，期末本位币空：按 期初+借-贷 轧算
        if end_missing and (begin or debit or credit):
            end = begin + debit - credit
            derived.append("end")
        if begin_missing and (end or debit or credit):
            begin = end - debit + credit
            derived.append("begin")
        cur = grid.text(r, currency_col) if currency_col is not None else ""
        dims = tuple(grid.text(r, c) for c in dim_cols)
        accounts.append(Account(code=code.strip(), name=name.strip(), begin=begin, debit=debit,
                                credit=credit, end=end,
                                extra={"row": r, "currency": cur, "dims": dims,
                                       "derived": derived}))

    _apply_currency_totals(accounts, grid, h0)
    accounts = _dedupe(accounts)
    for a in accounts:
        a.std = chart.resolve(a.code, a.name) or ""
    _apply_legacy_chart(accounts, grid)
    _assign_levels(accounts)
    _inherit_std(accounts)
    _force_construction(accounts)
    _infer_depreciation(accounts)
    warnings.extend(_sanity(accounts))
    return TB(accounts=accounts, source=path, sheet=grid.sheet,
              header_rows=(h0, h1), roles=roles, warnings=warnings)


def _apply_legacy_chart(accounts: list[Account], grid=None) -> None:
    """老准则科目表（1131 应收账款 / 2121 应付账款 / 1243 库存商品）。

    只在确认是老表时整体套用，避免影响使用新准则的客户。
    """
    from .chart import CODE_PREFIX_STD

    codes = {a.code for a in accounts}
    has_combined = grid is not None and any(
        (grid.text(r, c) or "").strip() == "综合本位币"
        for r in range(grid.nrows) for c in range(grid.ncols))
    legacy = (has_combined and "1131" in codes and "1243" in codes and
              any(a.code == "1131" and "应收" in a.name for a in accounts))
    if not legacy:
        return
    for a in accounts:
        if a.code[:4] in CODE_PREFIX_STD:
            a.std = CODE_PREFIX_STD[a.code[:4]]


def _apply_currency_totals(accounts: list[Account], grid, header_row: int) -> None:
    """多币种科目表：续行的「综合本位币」才是本位币合计。

    格式：有代码的行是明细币种（RMB/001），随后 code 为空、币别列写着
    「折合本位币」「综合本位币」，金额才是本位币口径。
    """
    by_code = {a.code: a for a in accounts}
    if not by_code:
        return
    last_code = None
    for r in range(header_row + 1, grid.nrows):
        code = (grid.text(r, 1) or "").strip()
        cur = (grid.text(r, 3) or "").strip()
        if code:
            last_code = code
            continue
        if cur not in ("综合本位币", "折合本位币") or not last_code:
            continue
        a = by_code.get(last_code)
        if a is None or not a.code[:1] in ("1", "2", "3", "4"):
            # 只对资产负债类科目用综合本位币；损益类按发生额，列口径不同
            continue
        def num(c):
            try:
                return float(str(grid.cell(r, c)).replace(",", ""))
            except (TypeError, ValueError):
                return 0.0
        begin_d, begin_c = num(4), num(5)
        debit, credit = num(6), num(7)
        end_d, end_c = num(10), num(11)
        a.begin = round(begin_d - begin_c, 2)
        a.debit, a.credit = round(debit, 2), round(credit, 2)
        a.end = round(end_d - end_c, 2)
        a.extra["currency"] = cur


def _dedupe(accounts: list[Account]) -> list[Account]:
    """Collapse duplicate rows for one account.

    1. currency rows: keep the combined/local-currency row;
    2. dimension rows (供应商/客户/...): keep the row without dimensions if
       present, else sum the dimension rows.
    """
    by_code: dict[str, list[Account]] = {}
    for a in accounts:
        by_code.setdefault(a.key, []).append(a)
    out: list[Account] = []
    for key, group in by_code.items():
        if len(group) == 1:
            out.append(group[0])
            continue
        cur_groups = [a for a in group if a.extra.get("currency")]
        if cur_groups:
            base = [a for a in group if (a.extra.get("currency") or "").strip() in COMBINED_CURRENCY]
            if base:
                pool = base
            else:
                # one row per currency (e.g. 人民币 + 美元): the account balance is
                # the sum of the local-currency amounts, not any single row.
                agg = Account(code=group[0].code, name=group[0].name,
                              begin=sum(a.begin for a in group), debit=sum(a.debit for a in group),
                              credit=sum(a.credit for a in group), end=sum(a.end for a in group),
                              extra={**group[0].extra, "merged_currency": len(group)})
                out.append(agg)
                continue
        else:
            pool = group
        plain = [a for a in pool if not any(a.extra.get("dims") or ())]
        if plain:
            plain.sort(key=lambda a: (abs(a.begin) + abs(a.end) + abs(a.debit) + abs(a.credit)), reverse=True)
            out.append(plain[0])
            continue
        if len(pool) > 1 and any(a.extra.get("dims") for a in pool):
            agg = Account(code=pool[0].code, name=pool[0].name,
                          begin=sum(a.begin for a in pool), debit=sum(a.debit for a in pool),
                          credit=sum(a.credit for a in pool), end=sum(a.end for a in pool),
                          extra={**pool[0].extra, "merged": len(pool)})
            out.append(agg)
            continue
        out.append(pool[0])
    return out


def _force_construction(accounts: list[Account]) -> None:
    """施工企业：4104 工程施工下的材料/工资/机械等子目属于合同履约成本，不是存货。

    客户常把「工程用材料」「商品砼」挂在 410401 下，按名称会被认成 1403/1405；
    必须按父级科目纠正，否则存货会被放大几个亿。
    """
    by_code = {a.code: a for a in accounts}
    for a in accounts:
        cur, hops = a.code, 0
        while cur and hops < 8:
            parent = by_code.get(cur)
            if parent is None:
                cut = cur.rstrip("0123456789")
                cur = cut if cut != cur else ""
                hops += 1
                continue
            if parent.code != a.code and parent.code.startswith("4104"):
                a.std = "5401"
                break
            if parent.code != a.code and parent.code.startswith("4103"):
                a.std = "5402"
                break
            cur = parent.parent or ""
            hops += 1


def _inherit_std(accounts: list[Account]) -> None:
    """Sub-accounts named after a customer/bank inherit the parent subject.

    "102001 中行国航大厦支行" carries no subject word of its own; without
    inheritance the detail sheet cannot tell it belongs to 银行存款.
    """
    by_code = {a.code: a for a in accounts}
    for a in sorted(accounts, key=lambda x: len(x.code)):
        if a.std:
            continue
        cur, hops = a.parent, 0
        while cur and hops < 6:
            p = by_code.get(cur)
            if p is None:
                break
            if p.std:
                a.std = p.std
                a.extra["std_from"] = p.code
                break
            cur, hops = p.parent, hops + 1


def _infer_depreciation(accounts: list[Account]) -> None:
    """Negative balance on a 15xx/16xx asset account without a subject = 累计折旧.

    Some charts book accumulated depreciation as a sub-account named after the
    asset class (e.g. "150205 交通运输设备" with a credit balance) and never
    export a 1602 parent.
    """
    for a in accounts:
        if a.std or a.end >= 0:
            continue
        digits = norm_code(a.code)
        if digits[:2] in ("15", "16") and len(digits) >= 4:
            a.std = "1602"
            a.extra["std_from"] = "inferred:negative_asset"


def _sanity(accounts: list[Account]) -> list[str]:
    warns = []
    dup = {}
    for a in accounts:
        dup[a.key] = dup.get(a.key, 0) + 1
    if any(v > 1 for v in dup.values()):
        warns.append("duplicate codes remain")
    return warns


def _assign_levels(accounts: list[Account]) -> None:
    keys = [a.key for a in accounts]
    for a in accounts:
        parent = ""
        best = 0
        for b in accounts:
            if b is a:
                continue
            if a.key.startswith(b.key) and len(b.key) < len(a.key) and len(b.key) > best:
                best, parent = len(b.key), b.code
        a.parent = parent
        a.level = 1 if not parent else 2 if len(norm_code(parent)) <= 6 else 3
