"""从 data/audit.db 生成跨公司概览与查询示例。"""
import sys, time, os
sys.path.insert(0,".")
from auditfill.store import connect, summary

con=connect("data/audit.db")
t0=time.time()

def one(q, args=()):
    r=con.execute(q, args).fetchone()
    return None if r is None else r[0]

lines=["# 审计数据库概览（data/audit.db）","",
f"文件大小：{os.path.getsize('data/audit.db')/1024/1024:.1f} MB","",
"| 公司 | 期间 | 科目数 | 报表行 | 凭证行 | 勾稽通过/全部 | 填写记录 | 待取证 |","|---|---|---:|---:|---:|---:|---:|---:|"]
for r in summary(con):
    v=one("SELECT COUNT(*) FROM voucher WHERE company_id=(SELECT id FROM company WHERE name=?)",(r["name"],))
    ev=one("SELECT COUNT(*) FROM evidence WHERE company_id=(SELECT id FROM company WHERE name=?)",(r["name"],))
    lines.append(f"| {r['name']} | {r['period']} | {r['accounts']} | {r['fs_lines']} | {v} | {r['checks_ok']}/{r['checks']} | {r['fills']} | {ev} |")

lines+=["","## 跨公司对比：主要科目期末余额（元）","",
"| 公司 | 货币资金 | 应收账款 | 存货 | 应交税费 | 营业收入 |","|---|---:|---:|---:|---:|---:|"]
for name in [r["name"] for r in summary(con)]:
    def val(std):
        return one("SELECT ROUND(SUM(end),2) FROM account WHERE company_id=(SELECT id FROM company WHERE name=?) AND std=? AND is_leaf=1",(name,std))
    def fsval(prefix):
        if prefix=="营业收入":
            return one("SELECT ROUND(end,2) FROM fs_line WHERE company_id=(SELECT id FROM company WHERE name=?) AND (label LIKE '%营业收入%' OR label LIKE '%主营业务收入%') ORDER BY LENGTH(label) LIMIT 1",(name,))
        return one("SELECT ROUND(end,2) FROM fs_line WHERE company_id=(SELECT id FROM company WHERE name=?) AND label=? LIMIT 1",(name,prefix))
    cash=val("1002") or fsval("货币资金"); ar=val("1122"); inv=val("1405") or val("1403")
    t=val("2221"); tax=None if t is None else -t
    rev=fsval("营业收入")
    f=lambda x: "" if x is None else f"{x:,.2f}"
    lines.append(f"| {name} | {f(cash)} | {f(ar)} | {f(inv)} | {f(tax)} | {f(rev)} |")

lines+=["","## 未解决的勾稽差异（按科目）","","| 公司 | 项目 | 计算值 | 报表值 | 差异 |","|---|---|---:|---:|---:|"]
for r in con.execute("""SELECT c.name, k.line, k.calc, k.fs, k.diff FROM audit_check k
                        JOIN company c ON c.id=k.company_id WHERE k.diff IS NOT NULL AND ABS(k.diff)>0.01
                        ORDER BY ABS(k.diff) DESC LIMIT 25"""):
    lines.append(f"| {r['name']} | {r['line']} | {r['calc']:,.2f} | {r['fs']:,.2f} | {r['diff']:,.2f} |")

lines+=["","## 资料齐全度（每家原始文件）",""]
for r in con.execute("SELECT c.name, COUNT(s.rowid) n, SUM(CASE WHEN s.status='已用于填表' THEN 1 ELSE 0 END) used FROM company c LEFT JOIN source s ON s.company_id=c.id GROUP BY c.id"):
    lines.append(f"- {r['name']}：{r['n']} 个文件，已用 {r['used'] or 0} 个")
lines+=["","## 差异归因（库内统计）","","| 原因 | 项数 |","|---|---:|"]
for r in con.execute("SELECT cause, COUNT(*) n FROM audit_check WHERE cause<>'' GROUP BY cause ORDER BY n DESC"):
    lines.append(f"| {r['cause']} | {r['n']} |")

lines+=["","## 常用查询","",
"```sql","-- 每家公司的资产总计（从报表行）",
"SELECT c.name, f.end FROM fs_line f JOIN company c ON c.id=f.company_id",
" WHERE f.label IN ('资产总计','资产合计');","",
"-- 某科目跨公司对比",
"SELECT c.name, SUM(a.end) FROM account a JOIN company c ON c.id=a.company_id",
" WHERE a.std='1122' GROUP BY c.name;","",
"-- 某家公司未解决差异",
"SELECT line, calc, fs, diff FROM audit_check",
" WHERE company_id=(SELECT id FROM company WHERE name='中天') AND ABS(diff)>0.01;","```",""]
lines.append(f"*查询耗时：{time.time()-t0:.2f} 秒*")

# 用数据库直接生成底稿包校验报告（区分实质差异 / 列报差异）
rep=["# 底稿包校验报告（数据库直出）","",
"差异分两类：**实质差异**（客户资料/口径/币种，需客户补资料或确认）与 **列报差异**（位置或总额/净额不同，数字本身对得上）。","",
"| 公司 | 填写格 | 勾稽一致 | 实质差异 | 列报差异 | 报表无此行 | 待取证 |","|---|---:|---:|---:|---:|---:|---:|"]
tot=[0,0,0,0,0]
for r in summary(con):
    cid=one("SELECT id FROM company WHERE name=?",(r["name"],))
    def cnt(where):
        return one(f"SELECT COUNT(*) FROM audit_check WHERE company_id=? AND {where}",(cid,))
    sub=cnt("diff IS NOT NULL AND ABS(diff)>0.01 AND COALESCE(cause,'') NOT LIKE '%列报%'")
    pres=cnt("diff IS NOT NULL AND ABS(diff)>0.01 AND cause LIKE '%列报%'")
    na=cnt("diff IS NULL")
    ev=one("SELECT COUNT(*) FROM evidence WHERE company_id=?",(cid,))
    tot[0]+=r["fills"]; tot[1]+=r["checks_ok"]; tot[2]+=sub; tot[3]+=pres; tot[4] if len(tot)>4 else tot.append(0)
    tot[4]+=na
    rep.append(f"| {r['name']} | {r['fills']} | {r['checks_ok']} | {sub} | {pres} | {na} | {ev} |")
rep.append(f"| **合计** | **{tot[0]}** | **{tot[1]}** | **{tot[2]}** | **{tot[3]}** | **{tot[4]}** | |")
rep+=["","由 `data/audit.db` 的 `fill` / `audit_check` / `evidence` 三张表直接汇总，不依赖重新解析 Excel。"]
open("out/校验报告_数据库版.md","w").write("\n".join(rep))
open("out/数据库概览.md","w").write("\n".join(lines))
print("\n".join(lines[:12]))
print("elapsed",round(time.time()-t0,3))
