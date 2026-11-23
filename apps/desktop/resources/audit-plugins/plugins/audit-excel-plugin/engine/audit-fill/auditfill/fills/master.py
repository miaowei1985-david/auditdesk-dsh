"""01 主底稿（承接至完成）的封面与三张报表填充。

01 原是 .xls，用 LibreOffice 转成 xlsx 后作为模板（templates/01_master.xlsx）。
资产表/负债表/利润表是整套底稿的数据源（后面各表都是链接），所以只填这三张
和封面，其余 80 张程序表/核对表保持原样。

数据取客户报表（未审数）：01 的三张表本来就应等于客户报表，调整再通过
各科目审定表体现。报表缺行时回退到 TB 汇总。
"""
from __future__ import annotations

import re

from ..fs import FSBook
from ..tb import TB
from ..template import Template

# 同一行可能有「原价/净值」多个候选，取净额优先
ALIASES = {"固定资产": ("固定资产净额", "固定资产净值", "固定资产账面价值", "固定资产"),
           "无形资产": ("无形资产净额", "无形资产净值", "无形资产"),
           "预收款项": ("预收款项", "预收账款"),
           "预付款项": ("预付款项", "预付账款"),
           "应交税费": ("应交税费", "应交税金", "未交税金"),
           "应付职工薪酬": ("应付职工薪酬", "应付工资"),
           "实收资本": ("实收资本", "实收资本(或股本)", "实收资本（或股本）", "股本"),
           "盈余公积": ("盈余公积",),
           "未分配利润": ("未分配利润",),
           "债权投资": ("债权投资", "持有至到期投资", "可供出售金融资产"),
           "长期股权投资": ("长期股权投资", "长期投资"),
           "应付股利": ("应付股利", "应付利润", "未付利润"),
           "其他流动资产": ("其他流动资产", "待摊费用"),
           "交易性金融资产": ("交易性金融资产", "短期投资"),
           "其他债权投资": ("其他债权投资",)}

LABEL_SKIP = ("流动资产", "非流动资产", "流动负债", "非流动负债", "所有者权益", "资产总计",
              "负债合计", "所有者权益合计", "负债和所有者权益", "资产合计", "所有者权益（或股东权益）")


def _n(v) -> str:
    return re.sub(r"[\s\u3000]+", "", str(v or ""))


def clean(label: str) -> str:
    t = _n(label)
    t = re.sub(r"^[一二三四五六七八九十]+、", "", t)
    t = re.sub(r"^(其中|加|减)[:：]?", "", t)
    t = re.sub(r"^△", "", t)
    return t


def fill_master(tpl: Template, fs: FSBook, client: str, period: str = "2025-12-31") -> dict:
    summary = {"ok": True, "rows": 0, "cells": 0, "warnings": [],
               "sums": {}}

    # 封面
    ws = tpl.sheet("封面")
    tpl.put("封面", "C2", client, "客户名称", "header")
    tpl.put("封面", "C3", period, "报告截止日", "header")

    for sheet in ("资产表", "负债表", "利润表"):
        ws = tpl.sheet(sheet)
        for r in range(5, ws.max_row + 1):
            label = ws.cell(r, 1).value
            if not isinstance(label, str) or not label.strip():
                continue
            name = clean(label)
            if not name or name in LABEL_SKIP:
                continue
            # 小计/合计行是公式，不能覆盖
            if "合计" in name or "总计" in name:
                continue
            if name == "其他流动资产":
                # 「待摊费用」只在完全同名时才算，避免匹配到「长期待摊费用」造成重复
                row = fs.get("其他流动资产")
                if row is None:
                    for st in fs.bs:
                        if "待摊费用" in st.rows:
                            row = st.rows["待摊费用"]
                            break
            else:
                row = fs.get(*ALIASES.get(name, (name,)))
            # 模板里带样例数（AAA公司），报表没有的行必须清零，否则样例数会混进合计
            if row is None:
                tpl.put(sheet, f"C{r}", 0, f"报表无「{name}」行，清零")
                tpl.put(sheet, f"D{r}", 0, f"报表无「{name}」行，清零")
                summary["cells"] += 2
                continue
            end, begin = row.get("end"), row.get("begin")
            if end is None and begin is None:
                tpl.put(sheet, f"C{r}", 0, f"报表「{name}」为空，清零")
                tpl.put(sheet, f"D{r}", 0, f"报表「{name}」为空，清零")
                summary["cells"] += 2
                continue
            sums = summary["sums"].setdefault(sheet, {"end": 0.0, "begin": 0.0})
            if end is not None:
                tpl.put(sheet, f"C{r}", round(end, 2), f"客户报表「{name}」期末/本年")
                summary["cells"] += 1
                sums["end"] += end
            if begin is not None:
                tpl.put(sheet, f"D{r}", round(begin, 2), f"客户报表「{name}」期初/上年")
                summary["cells"] += 1
                sums["begin"] += begin
            summary["rows"] += 1
    return summary


def totals(tpl: Template) -> dict:
    """资产表/负债表最后的合计行，用于自检。"""
    out = {}
    for sheet in ("资产表", "负债表"):
        ws = tpl.sheet(sheet)
        for r in range(ws.max_row, 4, -1):
            label = _n(ws.cell(r, 1).value)
            if label in ("资产总计", "资产合计", "负债和所有者权益总计", "负债和所有者权益合计"):
                out[sheet] = {"row": r, "label": label,
                              "end": ws.cell(r, 3).value, "begin": ws.cell(r, 4).value}
                break
    return out
