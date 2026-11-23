"""把「待取证清单」按公司装进数据库 evidence 表。"""
import sys, os
sys.path.insert(0,"."); sys.path.insert(0,"tools")
from auditfill.store import connect, save_evidence
import evidence_gaps

con=connect("data/audit.db")
names=[r["name"] for r in con.execute("SELECT name FROM company ORDER BY id")]
for n in names:
    cid=con.execute("SELECT id FROM company WHERE name=?", (n,)).fetchone()[0]
    gaps=evidence_gaps.company_gaps(n)
    k=save_evidence(con,cid,gaps)
    print(f"{n}: {k} 项待取证")
