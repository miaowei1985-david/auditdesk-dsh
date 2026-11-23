"""现金流量表验算表 J-1（经营活动）主要项目填列。

只填能直接从 TB 取到的项目：收入、成本、应收/预收、存货、预付/应付、应付票据。
增值税、坏账核销、债务重组等项目没有可靠数据，保持空白，验算表会给出偏小的净额，
差额在报告里说明。
"""
from __future__ import annotations

from ..tb import TB
from ..template import Template

INV = ("1401", "1402", "1403", "1404", "1405", "1406", "1408", "1411")


def _std(tb: TB, std: str, field: str) -> float:
    return sum(getattr(a, field) for a in tb.by_std(std))


def _vat(tb: TB, *, output: bool) -> float:
    total = 0.0
    for a in tb.accounts:
        if a.std != "2221":
            continue
        if output and "销项" in a.name:
            total += a.credit
        elif not output and "进项" in a.name and "转出" not in a.name:
            total += a.debit
    return total


def fill_j1(tpl: Template, tb: TB, *, sheet: str = "J-1") -> dict:
    # 流入
    tpl.put(sheet, "C10", round(_std(tb, "6001", "credit"), 2), "TB 6001 贷方（主营业务收入）")
    tpl.put(sheet, "C11", round(_std(tb, "6051", "credit"), 2), "TB 6051 贷方（其他业务收入）")
    tpl.put(sheet, "C12", round(_vat(tb, output=True), 2), "TB 2221 销项税额贷方")
    tpl.put(sheet, "C13", round(_std(tb, "1122", "begin"), 2), "TB 1122 期初")
    tpl.put(sheet, "C14", round(_std(tb, "1122", "end"), 2), "TB 1122 期末")
    tpl.put(sheet, "C15", round(_std(tb, "1121", "begin"), 2), "TB 1121 期初")
    tpl.put(sheet, "C16", round(_std(tb, "1121", "end"), 2), "TB 1121 期末")
    tpl.put(sheet, "C17", round(-_std(tb, "2203", "end"), 2), "TB 2203 期末（贷方为正）")
    tpl.put(sheet, "C18", round(-_std(tb, "2203", "begin"), 2), "TB 2203 期初（贷方为正）")
    # 流出
    tpl.put(sheet, "F10", round(_std(tb, "6401", "debit"), 2), "TB 6401 借方（销售成本）")
    tpl.put(sheet, "F11", round(_std(tb, "6402", "debit"), 2), "TB 6402 借方（其他业务支出）")
    tpl.put(sheet, "F12", round(_vat(tb, output=False), 2), "TB 2221 进项税额借方（不含转出）")
    inv_b = sum(_std(tb, s, "begin") for s in INV)
    inv_e = sum(_std(tb, s, "end") for s in INV)
    tpl.put(sheet, "F13", round(inv_e, 2), "TB 存货期末")
    tpl.put(sheet, "F14", round(inv_b, 2), "TB 存货期初")
    tpl.put(sheet, "F15", round(_std(tb, "1123", "end"), 2), "TB 1123 期末")
    tpl.put(sheet, "F16", round(_std(tb, "1123", "begin"), 2), "TB 1123 期初")
    tpl.put(sheet, "F17", round(-_std(tb, "2202", "begin"), 2), "TB 2202 期初（贷方为正）")
    tpl.put(sheet, "F18", round(-_std(tb, "2202", "end"), 2), "TB 2202 期末（贷方为正）")
    tpl.put(sheet, "F19", round(-_std(tb, "2201", "begin"), 2), "TB 2201 期初")
    tpl.put(sheet, "F20", round(-_std(tb, "2201", "end"), 2), "TB 2201 期末")
    return {"ok": True, "cells": 20}


def fill_j2(tpl: Template, tb: TB, *, sheet: str = "J-2") -> dict:
    """J-2 投资/筹资活动验算（只填能直接从 TB 取到的项目）。"""
    def put(cell, val, basis):
        tpl.put(sheet, cell, round(val, 2), basis)

    # 投资活动
    put("C10", _std(tb, "1501", "credit"), "TB 1501 贷方（收回股权投资）")
    put("C11", _std(tb, "1503", "credit"), "TB 1503 贷方（收回债权投资）")
    put("C17", _std(tb, "6111", "credit"), "TB 6111 贷方（投资收益现金）")
    put("F10", _std(tb, "1601", "debit") + _std(tb, "1701", "debit") + _std(tb, "1604", "debit"),
        "TB 1601/1701/1604 借方（购建长期资产）")
    put("F17", _std(tb, "1501", "debit"), "TB 1501 借方（投资支付）")
    # 筹资活动
    put("C34", _std(tb, "4001", "credit"), "TB 4001 贷方（吸收投资）")
    put("C35", _std(tb, "4002", "credit"), "TB 4002 贷方（资本公积）")
    put("C41", _std(tb, "2001", "credit"), "TB 2001 贷方（短期借款）")
    put("C42", _std(tb, "2501", "credit"), "TB 2501 贷方（长期借款）")
    put("F34", _std(tb, "2001", "debit"), "TB 2001 借方（偿还短期借款）")
    put("F35", _std(tb, "2501", "debit"), "TB 2501 借方（偿还长期借款）")
    put("F42", _std(tb, "2231", "debit"), "TB 2231 借方（分配股利）")
    put("F44", _std(tb, "6603", "debit"), "TB 6603 借方（利息支出，含手续费）")
    return {"ok": True, "cells": 13}
