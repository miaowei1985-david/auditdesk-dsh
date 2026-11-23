"""按公司管理审计数据的 SQLite 存储。

表：
  company      公司/期间/资料路径
  account      科目余额表（标准化后的科目）
  fs_line      客户报表行（资产负债表/利润表/现金流量表）
  check        勾稽结果
  fill         填写记录（含依据）
  voucher      凭证分录（可选，量大）

用途：避免每次重跑都重新解析几十 MB 的 Excel；支持跨公司比较、留痕、复核查询。
"""
from __future__ import annotations

import json
import os
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS client(
  id INTEGER PRIMARY KEY, code TEXT UNIQUE, name TEXT, tax_id TEXT,
  contact TEXT, note TEXT, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS project(
  id INTEGER PRIMARY KEY, client_id INTEGER, code TEXT UNIQUE, name TEXT,
  period TEXT, engagement TEXT DEFAULT '年报审计', stage TEXT DEFAULT '资料接收',
  owner TEXT, created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(client_id, period, engagement)
);
CREATE TABLE IF NOT EXISTS project_file(
  project_id INTEGER, kind TEXT, path TEXT, status TEXT, added_at TEXT
);
CREATE TABLE IF NOT EXISTS company(
  id INTEGER PRIMARY KEY, name TEXT UNIQUE, period TEXT,
  tb_file TEXT, fs_file TEXT, voucher_file TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS account(
  company_id INTEGER, code TEXT, name TEXT, std TEXT, level INTEGER, is_leaf INTEGER,
  begin REAL, debit REAL, credit REAL, end REAL,
  PRIMARY KEY(company_id, code)
);
CREATE TABLE IF NOT EXISTS fs_line(
  company_id INTEGER, statement TEXT, label TEXT, end REAL, begin REAL,
  PRIMARY KEY(company_id, statement, label)
);
CREATE TABLE IF NOT EXISTS audit_check(
  company_id INTEGER, line TEXT, calc REAL, fs REAL, diff REAL, hint TEXT, cause TEXT
);
CREATE TABLE IF NOT EXISTS fill(
  company_id INTEGER, workbook TEXT, sheet TEXT, cell TEXT, value REAL, basis TEXT
);
CREATE TABLE IF NOT EXISTS voucher(
  company_id INTEGER, vno TEXT, date TEXT, code TEXT, name TEXT,
  summary TEXT, debit REAL, credit REAL
);
CREATE TABLE IF NOT EXISTS change(
  company_id INTEGER, workbook TEXT, sheet TEXT, cell TEXT,
  old_value REAL, new_value REAL, changed_at TEXT
);
CREATE TABLE IF NOT EXISTS review(
  company_id INTEGER, reviewer TEXT, note TEXT, reviewed_at TEXT,
  stage TEXT, snapshot TEXT
);
CREATE TABLE IF NOT EXISTS source(
  company_id INTEGER, kind TEXT, filename TEXT, size_kb INTEGER, status TEXT, note TEXT
);
CREATE TABLE IF NOT EXISTS evidence(
  company_id INTEGER, type TEXT, item TEXT, detail TEXT, doc TEXT
);
CREATE INDEX IF NOT EXISTS ix_acc_std ON account(company_id, std);
CREATE INDEX IF NOT EXISTS ix_vou_code ON voucher(company_id, code);
"""


def connect(path: str = "data/audit.db") -> sqlite3.Connection:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    # 轻量迁移：account 表结构变化时重建（数据由 load_db 重新灌入）
    cols=[r[1] for r in con.execute("PRAGMA table_info(account)")]
    if cols and "is_leaf" not in cols:
        con.execute("DROP TABLE account")
        con.executescript(SCHEMA)
    ccols=[r[1] for r in con.execute("PRAGMA table_info(audit_check)")]
    if ccols and "cause" not in ccols:
        con.execute("DROP TABLE audit_check")
        con.executescript(SCHEMA)
    return con


def upsert_company(con, name: str, period: str, tb_file="", fs_file="", voucher_file="") -> int:
    con.execute(
        "INSERT INTO company(name,period,tb_file,fs_file,voucher_file) VALUES(?,?,?,?,?) "
        "ON CONFLICT(name) DO UPDATE SET period=excluded.period, tb_file=excluded.tb_file, "
        "fs_file=excluded.fs_file, voucher_file=excluded.voucher_file",
        (name, period, tb_file, fs_file, voucher_file))
    con.commit()
    return con.execute("SELECT id FROM company WHERE name=?", (name,)).fetchone()[0]


def save_accounts(con, cid: int, accounts) -> int:
    con.execute("DELETE FROM account WHERE company_id=?", (cid,))
    codes=[a.code for a in accounts]
    def leaf(c):
        return 0 if any(o!=c and o.startswith(c) and len(o)>len(c) for o in codes) else 1
    rows = [(cid, a.code, a.name, a.std, getattr(a, "level", 0), leaf(a.code),
             a.begin, a.debit, a.credit, a.end) for a in accounts]
    con.executemany("INSERT OR REPLACE INTO account VALUES(?,?,?,?,?,?,?,?,?,?)", rows)
    con.commit()
    return len(rows)


def save_fs(con, cid: int, book) -> int:
    con.execute("DELETE FROM fs_line WHERE company_id=?", (cid,))
    n = 0
    for st in getattr(book, "all", []):
        for label, v in st.rows.items():
            con.execute("INSERT OR REPLACE INTO fs_line VALUES(?,?,?,?,?)",
                        (cid, st.kind, label, v.get("end"), v.get("begin")))
            n += 1
    con.commit()
    return n


def save_checks(con, cid: int, lines) -> int:
    con.execute("DELETE FROM audit_check WHERE company_id=?", (cid,))
    rows = [(cid, l.get("line"), l.get("calc"), l.get("fs"), l.get("diff"), l.get("hint", ""), l.get("cause",""))
            for l in lines]
    con.executemany("INSERT INTO audit_check VALUES(?,?,?,?,?,?,?)", rows)
    con.commit()
    return len(rows)


def save_fills(con, cid: int, workbook: str, rows) -> int:
    # 变更留痕：与上一次装载的值比较，记录 old/new
    import datetime
    old = {(r["sheet"], r["cell"]): r["value"]
           for r in con.execute("SELECT sheet,cell,value FROM fill WHERE company_id=? AND workbook=?", (cid, workbook))}
    new = {}
    for r in rows:
        try:
            v = float(r.get("value")) if r.get("value") not in (None, "") else None
        except ValueError:
            v = None
        new[(r.get("sheet", ""), r.get("cell", ""))] = v
    at = datetime.datetime.now().isoformat(timespec="seconds")
    for key, v in new.items():
        if key in old and old[key] != v and not (old[key] is None and v is None):
            con.execute("INSERT INTO change VALUES(?,?,?,?,?,?,?)",
                        (cid, workbook, key[0], key[1], old[key], v, at))
    con.execute("DELETE FROM fill WHERE company_id=? AND workbook=?", (cid, workbook))
    data = []
    for r in rows:
        try:
            v = float(r.get("value")) if r.get("value") not in (None, "") else None
        except ValueError:
            v = None
        data.append((cid, workbook, r.get("sheet", ""), r.get("cell", ""), v, r.get("basis", "")))
    con.executemany("INSERT INTO fill VALUES(?,?,?,?,?,?)", data)
    con.commit()
    return len(data)


def save_vouchers(con, cid: int, entries) -> int:
    con.execute("DELETE FROM voucher WHERE company_id=?", (cid,))
    data = [(cid, e.vno, e.date, e.code, e.name, getattr(e, "summary", ""), e.debit, e.credit)
            for e in entries]
    con.executemany("INSERT INTO voucher VALUES(?,?,?,?,?,?,?,?)", data)
    con.commit()
    return len(data)


def save_sources(con, cid: int, rows) -> int:
    con.execute("DELETE FROM source WHERE company_id=?", (cid,))
    data=[(cid, r.get("kind",""), r.get("filename",""), r.get("size_kb",0), r.get("status",""), r.get("note","")) for r in rows]
    con.executemany("INSERT INTO source VALUES(?,?,?,?,?,?)", data)
    con.commit()
    return len(data)


def save_evidence(con, cid: int, gaps) -> int:
    con.execute("DELETE FROM evidence WHERE company_id=?", (cid,))
    rows=[(cid, g.get("type",""), g.get("item",""), g.get("detail",""), g.get("doc","")) for g in gaps]
    con.executemany("INSERT INTO evidence VALUES(?,?,?,?,?)", rows)
    con.commit()
    return len(rows)


def summary(con) -> list[dict]:
    q = """
    SELECT c.name, c.period,
      (SELECT ROUND(SUM(a.end),2) FROM account a WHERE a.company_id=c.id AND a.code='1002') cash,
      (SELECT COUNT(*) FROM account a WHERE a.company_id=c.id) accounts,
      (SELECT COUNT(*) FROM fs_line f WHERE f.company_id=c.id) fs_lines,
      (SELECT COUNT(*) FROM audit_check k WHERE k.company_id=c.id) checks,
      (SELECT COUNT(*) FROM audit_check k WHERE k.company_id=c.id AND k.diff=0) checks_ok,
      (SELECT COUNT(*) FROM fill f WHERE f.company_id=c.id) fills
    FROM company c ORDER BY c.id
    """
    return [dict(r) for r in con.execute(q)]
