"""复核留痕：登记/查看每家底稿的复核记录（供审计工作台归档）。

用法：
  python3 tools/review.py --company 中天 --reviewer 张三 --note "已复核"
  python3 tools/review.py --company 中天 --show
"""
import argparse, json, sys, datetime
sys.path.insert(0,".")
from auditfill.store import connect

con=connect("data/audit.db")

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--company", required=True)
    ap.add_argument("--reviewer")
    ap.add_argument("--note", default="")
    ap.add_argument("--show", action="store_true")
    a=ap.parse_args()
    row=con.execute("SELECT id FROM company WHERE name=?", (a.company,)).fetchone()
    if row is None:
        print(json.dumps({"ok":False,"error":f"未知公司 {a.company}"}, ensure_ascii=False)); return 1
    cid=row[0]
    if a.show:
        rows=[dict(r) for r in con.execute("SELECT reviewer,note,reviewed_at,stage FROM review WHERE company_id=? ORDER BY reviewed_at DESC",(cid,))]
        print(json.dumps({"ok":True,"company":a.company,"reviews":rows}, ensure_ascii=False)); return 0
    if not a.reviewer:
        print(json.dumps({"ok":False,"error":"缺少 --reviewer"}, ensure_ascii=False)); return 1
    # 快照：复核时的勾稽计数，便于日后证明复核对象
    def one(sql):
        x=con.execute(sql,(cid,)).fetchone(); return x[0] if x else 0
    snap={
        "fills":one("SELECT COUNT(*) FROM fill WHERE company_id=?"),
        "checks":one("SELECT COUNT(*) FROM audit_check WHERE company_id=?"),
        "ok":one("SELECT COUNT(*) FROM audit_check WHERE company_id=? AND diff=0"),
        "sub":one("SELECT COUNT(*) FROM audit_check WHERE company_id=? AND diff IS NOT NULL AND ABS(diff)>0.01 AND COALESCE(cause,'') NOT LIKE '%列报%'"),
    }
    con.execute("INSERT INTO review(company_id,reviewer,note,reviewed_at,stage,snapshot) VALUES(?,?,?,?,?,?)",
                (cid,a.reviewer,a.note,datetime.datetime.now().isoformat(timespec="seconds"),"复核",json.dumps(snap,ensure_ascii=False)))
    con.commit()
    print(json.dumps({"ok":True,"company":a.company,"reviewer":a.reviewer,"snapshot":snap}, ensure_ascii=False))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
