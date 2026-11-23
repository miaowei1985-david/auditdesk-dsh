"""按公司生成审计备忘录（底稿说明），数据来自 data/audit.db。"""
import json, os, sys
sys.path.insert(0,".")
from auditfill.store import connect

con=connect("data/audit.db")
os.makedirs("out/备忘录", exist_ok=True)
names=[r["name"] for r in con.execute("SELECT name FROM company ORDER BY id")]
index=[]

for n in names:
    cid=con.execute("SELECT id FROM company WHERE name=?", (n,)).fetchone()[0]
    def q(sql,args=()):
        if "?" not in sql:
            return con.execute(sql).fetchall()
        return con.execute(sql,(cid,)+args).fetchall()
    def one(sql,args=()):
        r=con.execute(sql,(cid,)+args).fetchone(); return None if r is None else r[0]
    ok=one("SELECT COUNT(*) FROM audit_check WHERE company_id=? AND diff=0")
    sub=one("SELECT COUNT(*) FROM audit_check WHERE company_id=? AND diff IS NOT NULL AND ABS(diff)>0.01 AND COALESCE(cause,'') NOT LIKE '%列报%'")
    pres=one("SELECT COUNT(*) FROM audit_check WHERE company_id=? AND diff IS NOT NULL AND ABS(diff)>0.01 AND cause LIKE '%列报%'")
    na=one("SELECT COUNT(*) FROM audit_check WHERE company_id=? AND diff IS NULL")
    fills=one("SELECT COUNT(*) FROM fill WHERE company_id=?")
    ev=q("SELECT type,item,detail,doc FROM evidence WHERE company_id=? ORDER BY type,item")
    src=q("SELECT kind,filename,status FROM source WHERE company_id=? ORDER BY status,filename")
    diffs=q("SELECT line,calc,fs,diff,cause FROM audit_check WHERE company_id=? AND diff IS NOT NULL AND ABS(diff)>0.01 ORDER BY ABS(diff) DESC")
    tb=con.execute("SELECT tb_file,fs_file,voucher_file FROM company WHERE id=?",(cid,)).fetchall()
    L=[f"# {n} 审计备忘录（2025 年度）","",
       "## 一、资料来源",""]
    for r in src:
        L.append(f"- {r['kind']}：{r['filename']}（{r['status']}）")
    L+=["","## 二、执行情况","",
        f"- 填写单元格：{fills} 个",
        f"- 勾稽：一致 {ok}、实质差异 {sub}、列报差异 {pres}、报表无此行 {na}",""]
    if diffs:
        L+=["## 三、未解决差异","","| 项目 | 底稿 | 报表 | 差异 | 原因 |","|---|---:|---:|---:|---|"]
        for d in diffs:
            L.append(f"| {d['line']} | {d['calc']:,.2f} | {d['fs']:,.2f} | {d['diff']:,.2f} | {d['cause'] or '—'} |")
        L.append("")
    else:
        L+=["## 三、未解决差异","","无。",""]
    if ev:
        L+=["## 四、待取证事项","","| 类型 | 事项 | 明细 | 需要资料 |","|---|---|---|---|"]
        for e in ev[:20]:
            L.append(f"| {e['type']} | {e['item']} | {e['detail']} | {e['doc']} |")
        if len(ev)>20: L.append(f"| … | 其余 {len(ev)-20} 项 | | |")
        L.append("")
    reviews=q("SELECT reviewer,note,reviewed_at FROM review WHERE company_id=? ORDER BY reviewed_at DESC") if "review" in [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")] else []
    verdict = ("可以出具（实质无差异）" if sub==0
               else f"不宜直接出具：仍有 {sub} 项实质差异待解决")
    if reviews:
        L+=["## 五、复核留痕",""]
        for rv in reviews:
            L.append(f"- {rv['reviewed_at']} {rv['reviewer']}：{rv['note']}")
        L.append("")
    L+=["## 六、结论","",verdict,"",
        f"底稿包：out/{n}/{n}_底稿包.zip",""]
    open(f"out/备忘录/{n}.md","w").write("\n".join(L))
    index.append({"company":n,"path":f"out/备忘录/{n}.md","ok":ok,"sub":sub,"pres":pres,
                  "missing":na,"fills":fills,"evidence":len(ev),"verdict":verdict})
json.dump(index, open("out/备忘录/index.json","w"), ensure_ascii=False, indent=1)
print(json.dumps({"ok":True,"memos":index}, ensure_ascii=False))
