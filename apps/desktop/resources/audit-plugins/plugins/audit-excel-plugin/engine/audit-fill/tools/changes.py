"""查看底稿变动留痕（最近 N 条，可按公司过滤）。"""
import argparse, json, sys
sys.path.insert(0,".")
from auditfill.store import connect

con=connect("data/audit.db")
ap=argparse.ArgumentParser()
ap.add_argument("--company")
ap.add_argument("--limit", type=int, default=50)
a=ap.parse_args()
sql="""SELECT c.name, ch.workbook, ch.sheet, ch.cell, ch.old_value, ch.new_value, ch.changed_at
       FROM change ch JOIN company c ON c.id=ch.company_id"""
args=[]
if a.company:
    sql+=" WHERE c.name=?"; args.append(a.company)
sql+=" ORDER BY ch.changed_at DESC, ch.rowid DESC LIMIT ?"; args.append(a.limit)
rows=[dict(r) for r in con.execute(sql, args)]
print(json.dumps({"ok":True,"changes":rows}, ensure_ascii=False))
