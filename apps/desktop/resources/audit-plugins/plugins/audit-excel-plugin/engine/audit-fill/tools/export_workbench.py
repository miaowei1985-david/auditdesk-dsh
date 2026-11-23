"""导出给「审计工作台」用的结构化数据（JSON/CSV），与底稿包并存。"""
import os, sys, json, csv, shutil, datetime
sys.path.insert(0,".")
from auditfill.store import connect

OUT="out/工作台导出"
os.makedirs(OUT, exist_ok=True)
con=connect("data/audit.db")

companies=[dict(r) for r in con.execute("SELECT id,name,period,tb_file,fs_file,voucher_file FROM company ORDER BY id")]
manifest={"generated_at":datetime.datetime.now().isoformat(timespec="seconds"),
          "source":"audit-fill pipeline","companies":[]}

for c in companies:
    cid, name = c["id"], c["name"]
    d=os.path.join(OUT, name); os.makedirs(d, exist_ok=True)
    # 科目余额表
    with open(os.path.join(d,"accounts.csv"),"w",newline="",encoding="utf-8-sig") as fh:
        w=csv.writer(fh); w.writerow(["code","name","std","is_leaf","begin","debit","credit","end"])
        for r in con.execute("SELECT code,name,std,is_leaf,begin,debit,credit,end FROM account WHERE company_id=? ORDER BY code",(cid,)):
            w.writerow([r["code"],r["name"],r["std"],r["is_leaf"],r["begin"],r["debit"],r["credit"],r["end"]])
    # 报表行
    with open(os.path.join(d,"fs_lines.csv"),"w",newline="",encoding="utf-8-sig") as fh:
        w=csv.writer(fh); w.writerow(["statement","label","begin","end"])
        for r in con.execute("SELECT statement,label,begin,end FROM fs_line WHERE company_id=? ORDER BY statement,label",(cid,)):
            w.writerow([r["statement"],r["label"],r["begin"],r["end"]])
    # 勾稽
    checks=[dict(r) for r in con.execute("SELECT line,calc,fs,diff,hint,cause FROM audit_check WHERE company_id=? ORDER BY ABS(COALESCE(diff,0)) DESC",(cid,))]
    with open(os.path.join(d,"checks.csv"),"w",newline="",encoding="utf-8-sig") as fh:
        w=csv.writer(fh); w.writerow(["line","calc","fs","diff","hint","cause"])
        for r in checks: w.writerow([r["line"],r["calc"],r["fs"],r["diff"],r["hint"],r["cause"]])
    # 填写记录
    with open(os.path.join(d,"fills.csv"),"w",newline="",encoding="utf-8-sig") as fh:
        w=csv.writer(fh); w.writerow(["workbook","sheet","cell","value","basis"])
        for r in con.execute("SELECT workbook,sheet,cell,value,basis FROM fill WHERE company_id=? ORDER BY workbook,sheet,cell",(cid,)):
            w.writerow([r["workbook"],r["sheet"],r["cell"],r["value"],r["basis"]])
    # 待取证
    gaps=[dict(r) for r in con.execute("SELECT type,item,detail,doc FROM evidence WHERE company_id=?",(cid,))]
    with open(os.path.join(d,"evidence.csv"),"w",newline="",encoding="utf-8-sig") as fh:
        w=csv.writer(fh); w.writerow(["type","item","detail","doc"])
        for r in gaps: w.writerow([r["type"],r["item"],r["detail"],r["doc"]])
    # 汇总
    def cnt(w):
        return con.execute("SELECT COUNT(*) FROM audit_check WHERE company_id=? AND "+w,(cid,)).fetchone()[0]
    summary={
        "company":name,"period":c["period"],
        "files":{"tb":c["tb_file"],"fs":c["fs_file"],"voucher":c["voucher_file"]},
        "accounts":con.execute("SELECT COUNT(*) FROM account WHERE company_id=?",(cid,)).fetchone()[0],
        "fills":con.execute("SELECT COUNT(*) FROM fill WHERE company_id=?",(cid,)).fetchone()[0],
        "checks":{"ok":cnt("diff=0"),"sub":cnt("diff IS NOT NULL AND ABS(diff)>0.01 AND COALESCE(cause,'') NOT LIKE '%列报%'"),
                  "pres":cnt("diff IS NOT NULL AND ABS(diff)>0.01 AND cause LIKE '%列报%'"),"missing":cnt("diff IS NULL")},
        "evidence":len(gaps),
        "package":f"out/{name}/{name}_底稿包.zip",
        "report":f"out/公司报告/{name}.md",
    }
    json.dump(summary, open(os.path.join(d,"summary.json"),"w"), ensure_ascii=False, indent=1)
    manifest["companies"].append(summary)

json.dump(manifest, open(os.path.join(OUT,"manifest.json"),"w"), ensure_ascii=False, indent=1)
# 数据库副本
shutil.copyfile("data/audit.db", os.path.join(OUT,"audit.db"))
print("导出", len(manifest["companies"]), "家 →", OUT)
print("文件:", os.listdir(OUT)[:5], "...")
