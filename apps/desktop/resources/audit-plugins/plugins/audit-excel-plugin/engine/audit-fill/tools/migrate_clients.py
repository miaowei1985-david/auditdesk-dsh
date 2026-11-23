"""把现有 12 家公司迁成「客户 + 项目」结构。

客户：公司本身（code=公司代码）
项目：2025 年报审计（code=<公司代码>-2025）
底稿数据仍挂在 company 表，project 通过名称关联 company.name。
"""
import sys, json, datetime
sys.path.insert(0,".")
from auditfill.store import connect

con=connect("data/audit.db")
con.executescript(__import__("auditfill.store", fromlist=["SCHEMA"]).SCHEMA)
rows=list(con.execute("SELECT id,name,period,tb_file,fs_file,voucher_file FROM company ORDER BY id"))
out=[]
for r in rows:
    code=r["name"]
    con.execute("INSERT OR IGNORE INTO client(code,name,note) VALUES(?,?,?)",(code,code,"由 company 表迁移"))
    cid=con.execute("SELECT id FROM client WHERE code=?",(code,)).fetchone()[0]
    pcode=f"{code}-{r['period'] or '2025'}"
    con.execute("""INSERT OR IGNORE INTO project(client_id,code,name,period,engagement,stage)
                   VALUES(?,?,?,?,?,?)""",
                (cid,pcode,f"{code} {r['period'] or 2025} 年报审计",r["period"] or "2025","年报审计","填制底稿"))
    pid=con.execute("SELECT id FROM project WHERE code=?",(pcode,)).fetchone()[0]
    con.execute("DELETE FROM project_file WHERE project_id=?",(pid,))
    for kind,path in (("tb",r["tb_file"]),("fs",r["fs_file"]),("voucher",r["voucher_file"])):
        if path:
            con.execute("INSERT INTO project_file VALUES(?,?,?,?,?)",
                        (pid,kind,path,"已用",datetime.datetime.now().isoformat(timespec="seconds")))
    out.append({"client":code,"project":pcode,"id":pid})
con.commit()
print(json.dumps({"ok":True,"clients":len(rows),"projects":out}, ensure_ascii=False)[:500])
