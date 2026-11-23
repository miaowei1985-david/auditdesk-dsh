"""客户与项目管理：列表、建项目、挂资料、跑项目、看状态。

用法：
  python3 tools/projects.py --list
  python3 tools/projects.py --create --client 中天 --period 2026 --engagement 年报审计
  python3 tools/projects.py --attach --project 中天-2026 --tb 中天/科目余额表.xlsx --fs 中天/报表.xlsx
  python3 tools/projects.py --run --project 中天-2026
"""
import argparse, json, os, subprocess, sys, datetime
sys.path.insert(0,".")
from auditfill.store import connect

ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
B="/Users/macbook/Documents/审计底稿"
con=connect("data/audit.db")

def one(sql,args=()):
    r=con.execute(sql,args).fetchone(); return None if r is None else r[0]

def list_all():
    out=[]
    for c in con.execute("SELECT id,code,name FROM client ORDER BY code"):
        projs=[]
        for p in con.execute("SELECT id,code,name,period,engagement,stage FROM project WHERE client_id=? ORDER BY period",(c["id"],)):
            nf=one("SELECT COUNT(*) FROM project_file WHERE project_id=?",(p["id"],))
            projs.append({"project":p["code"],"name":p["name"],"period":p["period"],
                          "engagement":p["engagement"],"stage":p["stage"],"files":nf})
        out.append({"client":c["code"],"name":c["name"],"projects":projs})
    return {"ok":True,"clients":out}

def create(client, period, engagement="年报审计", name=None):
    cid=one("SELECT id FROM client WHERE code=?",(client,))
    if cid is None:
        con.execute("INSERT INTO client(code,name) VALUES(?,?)",(client,client)); con.commit()
        cid=one("SELECT id FROM client WHERE code=?",(client,))
    pcode=f"{client}-{period}"
    con.execute("""INSERT OR IGNORE INTO project(client_id,code,name,period,engagement,stage)
                   VALUES(?,?,?,?,?,?)""",
                (cid,pcode,name or f"{client} {period} 年报审计",period,engagement,"资料接收"))
    con.commit()
    return {"ok":True,"client":client,"project":pcode}

def attach(project, tb=None, fs=None, voucher=None):
    pid=one("SELECT id FROM project WHERE code=?",(project,))
    if pid is None: return {"ok":False,"error":f"项目不存在 {project}"}
    now=datetime.datetime.now().isoformat(timespec="seconds")
    for kind,path in (("tb",tb),("fs",fs),("voucher",voucher)):
        if path:
            con.execute("DELETE FROM project_file WHERE project_id=? AND kind=?",(pid,kind))
            con.execute("INSERT INTO project_file VALUES(?,?,?,?,?)",(pid,kind,path,"已关联",now))
    con.commit()
    return {"ok":True,"project":project,"files":one("SELECT COUNT(*) FROM project_file WHERE project_id=?",(pid,))}

def run_project(project):
    row=con.execute("SELECT id,client_id,period,name FROM project WHERE code=?",(project,)).fetchone()
    if row is None: return {"ok":False,"error":f"项目不存在 {project}"}
    pid=row["id"]
    client=one("SELECT code FROM client WHERE id=?",(row["client_id"],))
    files={r["kind"]:r["path"] for r in con.execute("SELECT kind,path FROM project_file WHERE project_id=?",(pid,))}
    if "tb" not in files or "fs" not in files:
        return {"ok":False,"error":"项目缺少科目余额表或报表，请先 --attach"}
    period=row["period"]
    out = f"out/{client}/底稿包" if period == "2025" else f"out/{client}/{period}/底稿包"
    cmd=[sys.executable,"-m","auditfill.workbench","--company",client,
         "--tb",files["tb"],"--fs",files["fs"],"--base-dir",B,"--out",out]
    if files.get("voucher"):
        cmd += ["--voucher",files["voucher"]]
    r=subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=1800)
    data=None
    for line in reversed((r.stdout or "").splitlines()):
        line=line.strip()
        if line.startswith("{"):
            try:
                data=json.loads(line); break
            except Exception:
                pass
    if data and data.get("ok"):
        lines=data.get("lines") or []
        ok=sum(1 for l in lines if l.get("diff")==0)
        stage="勾稽核对"
        summary=f"{client}: 勾稽 {ok}/{len(lines)} 一致"
    else:
        stage="资料接收"
        summary=(r.stderr or r.stdout or "执行失败")[-400:]
    con.execute("UPDATE project SET stage=? WHERE id=?",(stage,pid)); con.commit()
    return {"ok":bool(data and data.get("ok")),"project":project,"stage":stage,
            "summary":summary,"lines":(data or {}).get("lines",[])}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--list",action="store_true")
    ap.add_argument("--create",action="store_true")
    ap.add_argument("--attach",action="store_true")
    ap.add_argument("--run",action="store_true")
    ap.add_argument("--client"); ap.add_argument("--project")
    ap.add_argument("--period"); ap.add_argument("--engagement",default="年报审计")
    ap.add_argument("--tb"); ap.add_argument("--fs"); ap.add_argument("--voucher")
    a=ap.parse_args()
    if a.list: res=list_all()
    elif a.create: res=create(a.client,a.period,a.engagement)
    elif a.attach: res=attach(a.project,a.tb,a.fs,a.voucher)
    elif a.run: res=run_project(a.project)
    else: res={"ok":False,"error":"nothing to do"}
    print(json.dumps(res,ensure_ascii=False))

if __name__=="__main__": main()
