"""为每家公司生成一页式报告（数据来自 data/audit.db）。"""
import sys, os
sys.path.insert(0,".")
from auditfill.store import connect

con=connect("data/audit.db")
os.makedirs("out/公司报告", exist_ok=True)
names=[r["name"] for r in con.execute("SELECT name FROM company ORDER BY id")]
tot=0
for n in names:
    cid=con.execute("SELECT id FROM company WHERE name=?", (n,)).fetchone()[0]
    def q(sql, args=()):
        if "?" in sql:
            return con.execute(sql, (cid,)+args).fetchall()
        return con.execute(sql).fetchall()
    acc=q("SELECT COUNT(*) c, ROUND(SUM(CASE WHEN is_leaf=1 THEN 1 ELSE 0 END),0) leaves FROM account WHERE company_id=?")[0]
    fills=q("SELECT COUNT(*) c FROM fill WHERE company_id=?")[0]["c"]
    checks=q("SELECT COUNT(*) c FROM audit_check WHERE company_id=?")[0]["c"]
    ok=q("SELECT COUNT(*) c FROM audit_check WHERE company_id=? AND diff=0")[0]["c"]
    sub=q("SELECT COUNT(*) c FROM audit_check WHERE company_id=? AND diff IS NOT NULL AND ABS(diff)>0.01 AND COALESCE(cause,'') NOT LIKE '%列报%'")[0]["c"]
    pres=q("SELECT COUNT(*) c FROM audit_check WHERE company_id=? AND diff IS NOT NULL AND ABS(diff)>0.01 AND cause LIKE '%列报%'")[0]["c"]
    na=q("SELECT COUNT(*) c FROM audit_check WHERE company_id=? AND diff IS NULL")[0]["c"]
    L=[f"# {n}（2025 年度）","",
       f"- 科目 {acc['c']} 个（叶子 {int(acc['leaves'])}）",
       f"- 填写单元格 {fills} 个",
       f"- 勾稽 {checks} 项：一致 {ok}、实质差异 {sub}、列报差异 {pres}、报表无此行 {na}","",
       "## 主要科目余额（元）","","| 科目 | 期末 |","|---|---:|"]
    for std,label in [("1002","货币资金"),("1122","应收账款"),("1405","存货"),("2202","应付账款"),("4001","实收资本")]:
        r=q("SELECT ROUND(SUM(end),2) v FROM account WHERE company_id=? AND std=? AND is_leaf=1",(std,))
        v=r[0]["v"] if r else None
        if v is not None and std[:1] in ("2","3","4"):
            v=-v
        L.append(f"| {label} | {'' if v is None else f'{v:,.2f}'} |")
    L+=["","## 未解决差异",""]
    diffs=q("""SELECT line, calc, fs, diff, cause, hint FROM audit_check
               WHERE company_id=? AND diff IS NOT NULL AND ABS(diff)>0.01 ORDER BY ABS(diff) DESC""")
    if diffs:
        L+=["| 项目 | 底稿 | 报表 | 差异 | 原因 |","|---|---:|---:|---:|---|"]
        for d in diffs:
            L.append(f"| {d['line']} | {d['calc']:,.2f} | {d['fs']:,.2f} | {d['diff']:,.2f} | {d['cause'] or '—'} |")
    else:
        L.append("无。")
    src=q("SELECT kind, filename, size_kb, status FROM source WHERE company_id=? ORDER BY status, filename")
    if src:
        L+=["","## 资料清单","","| 类型 | 文件 | 大小 | 状态 |","|---|---|---:|---|"]
        for x in src:
            L.append(f"| {x['kind']} | {x['filename']} | {x['size_kb']} KB | {x['status']} |")
    ev=q("SELECT type, item, detail, doc FROM evidence WHERE company_id=? ORDER BY type, item")
    if ev:
        L+=["","## 待取证","","| 类型 | 事项 | 明细 | 需要资料 |","|---|---|---|---|"]
        for e in ev:
            L.append(f"| {e['type']} | {e['item']} | {e['detail']} | {e['doc']} |")
    open(f"out/公司报告/{n}.md","w").write("\n".join(L))
    tot+=1
print("生成", tot, "份")
