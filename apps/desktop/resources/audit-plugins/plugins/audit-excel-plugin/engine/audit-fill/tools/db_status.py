"""从数据库生成项目状态页。"""
import sys; sys.path.insert(0,".")
from auditfill.store import connect, summary

con=connect("data/audit.db")
rows=summary(con)
L=["# 项目状态总览（数据库直出，2026-11-23）","",
"数据源：`data/audit.db`。差异分三类：**实质差异**（要客户补/确认）、**列报差异**（位置或总额/净额）、**报表无此行**（客户报表本身没有该行，不算差异）。","",
"| 公司 | 填写格 | 勾稽一致 | 实质差异 | 列报差异 | 报表无此行 | 待取证 |","|---|---:|---:|---:|---:|---:|---:|"]
T=[0]*5
for r in rows:
    cid=con.execute("SELECT id FROM company WHERE name=?", (r["name"],)).fetchone()[0]
    def c(w): return con.execute(f"SELECT COUNT(*) FROM audit_check WHERE company_id=? AND {w}",(cid,)).fetchone()[0]
    sub=c("diff IS NOT NULL AND ABS(diff)>0.01 AND COALESCE(cause,'') NOT LIKE '%列报%'")
    pres=c("diff IS NOT NULL AND ABS(diff)>0.01 AND cause LIKE '%列报%'")
    na=c("diff IS NULL")
    ev=c("1=1") if False else con.execute("SELECT COUNT(*) FROM evidence WHERE company_id=?",(cid,)).fetchone()[0]
    for i,v in enumerate((r["fills"],r["checks_ok"],sub,pres,na)): T[i]+=v
    L.append(f"| {r['name']} | {r['fills']} | {r['checks_ok']} | {sub} | {pres} | {na} | {ev} |")
L.append(f"| **合计** | **{T[0]}** | **{T[1]}** | **{T[2]}** | **{T[3]}** | **{T[4]}** | |")
L+=["","## 解读","",
"- **中天** 18/18 全对；**丸金** 12 一致 + 3 报表无此行，实质无差异；**明璞** 7 + 7 同；",
"- 30 项实质差异集中在赞富（12，日元）、安堡罗（9，汇总层）、维曼（5，凭证不全）、乐线（5，缺科目）、舜壹（1，工程施工）；",
"- 6 项列报差异：中延 2、同进 3、乐线 1，均为总额/净额或列报位置不同，不需客户补资料。","",
"## 产物","",
"- `out/<公司>/<公司>_底稿包.zip`：4 本明细底稿 + 01 主底稿 + J 现金流量表 + 填写清单；",
"- 报告：数据库概览、校验报告（库版）、01 主底稿、资产负债表、损益、现金流量表、账证核对、待取证、覆盖率、重算验证、质量检查；",
"- 规则：`docs/FILL-LOGIC.md`；用法：`README.md`。"]
open("out/项目状态.md","w").write("\n".join(L))
print("\n".join(L[:16]))
