# -*- coding: utf-8 -*-
"""
mapping_rules.py — 映射规则「叠加层」（chart.py 内置优先，未命中查 mapping_rules 表）

与 build_mapping_rules.py（审计平台侧的"规则灌入/试运行"工具）的分工：
  - 本模块：引擎运行时读表补 std（只补 NULL，绝不覆盖 chart.py 已命中的）；
  - build_mapping_rules.py：把补充规则灌进 mapping_rules 表（种子数据）。
表里 company=NULL 表示全所通用，非空表示某客户专用（如机施教育 NPO 编码前缀）。
"""

from __future__ import annotations

import re
import sqlite3

from . import chart

DDL = """
CREATE TABLE IF NOT EXISTS mapping_rules(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT DEFAULT NULL,
  kind TEXT NOT NULL,            -- name(名称关键词) / prefix_code(编码前缀)
  needle TEXT NOT NULL,          -- 归一化关键词 或 编码前缀
  std TEXT NOT NULL,             -- 标准科目码
  note TEXT DEFAULT '',
  priority INTEGER DEFAULT 100,
  enabled INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_mr ON mapping_rules(company, kind, needle);
"""


def _norm(s: str) -> str:
    return re.sub(r"[\s\u3000（）()\-_/]+", "", chart.to_simplified(str(s or ""))).lower()


def resolve_combined(conn: sqlite3.Connection, code: str, name: str, company: str | None = None) -> str | None:
    """chart.py 内置优先；未命中查 mapping_rules 叠加层（名称关键词 + 客户专用编码前缀）。"""
    r = chart.resolve(code, name)
    if r:
        return r
    c = str(code or "").strip()
    n = _norm(name)
    if company:
        row = conn.execute(
            "SELECT std FROM mapping_rules WHERE company=? AND kind='prefix_code' AND enabled=1 "
            "AND ? LIKE needle||'%' ORDER BY LENGTH(needle) DESC LIMIT 1",
            (company, c),
        ).fetchone()
        if row:
            return row[0]
    if n:
        row = conn.execute(
            "SELECT std FROM mapping_rules WHERE company IS NULL AND kind='name' AND enabled=1 "
            "AND ? LIKE '%'||needle||'%' ORDER BY LENGTH(needle) DESC LIMIT 1",
            (n,),
        ).fetchone()
        if row:
            return row[0]
    return None


def apply_mapping_rules(conn: sqlite3.Connection) -> int:
    """补齐 account 表里 std 为空的账户（只补 NULL，绝不覆盖已有 std）。返回补了几个。"""
    conn.executescript(DDL)
    rows = conn.execute(
        "SELECT a.company_id, a.code, a.name, c.name FROM account a "
        "JOIN company c ON c.id=a.company_id WHERE a.std IS NULL OR a.std=''"
    ).fetchall()
    n = 0
    for cid, code, name, company in rows:
        r = resolve_combined(conn, code, name, company)
        if r:
            conn.execute("UPDATE account SET std=? WHERE company_id=? AND code=?", (r, cid, code))
            n += 1
    conn.commit()
    return n
