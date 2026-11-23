import json, sys, warnings
warnings.filterwarnings("ignore"); sys.path.insert(0,".")
from auditfill.fs import load_statements
B="/Users/macbook/Documents/审计底稿"
FS_FILE={
 "中天":"中天/财务报告_中天亚东-202512（未审计稿2026.1.19）.xlsx",
 "中延":"中延/会计报表-中延-202512.xlsx","丸金":"丸金/资产负债表12月.xls",
 "乐线":"乐线/2025年度报表新版（试用企业会计准则）.xls","同进":"同进/同进202512.xlsx",
 "明璞":"明璞/202512资产负债表.xls","安堡罗":"安堡罗/202512报表-报表以此为准.xlsx",
 "舜壹":"舜壹/2025年12月报表（更新）.xlsx","维曼":"维曼/2026.AR. NO.报表-维曼.xls",
}
res=json.load(open("out/全科目批量.json"))
def fs_rows(company):
    f=FS_FILE.get(company)
    if not f: return {}
    sts=[s for s in load_statements(f"{B}/{f}") if s.kind=="bs"]
    st=next((s for s in sts if s.get("货币资金") and s.get("货币资金").get("end") is not None), sts[0] if sts else None)
    return st.rows if st else {}
def hint(company, line, diff):
    if diff is None: return ""
    rows=fs_rows(company)
    for k,v in rows.items():
        if v.get("end") is not None and abs(abs(diff)-abs(v["end"]))<0.01 and k!=line:
            return f"金额等于报表「{k}」，疑似重分类/口径差异"
    return "TB 与报表口径差异，需核对"
lines=["# 全科目填表与报表勾稽结果（2026-11-23）","",
"范围：货币资金、应收账款、预付款项、其他应收款、存货、应付账款、预收款项、其他应付款、固定资产。",
"金额均为底稿「审定表/明细表合计」重算或汇总值 vs 客户报表数。",""]
ok=diff=na=0
for r in res:
    if "error" in r:
        lines.append(f"## {r['company']}\n解析失败：{r['error']}\n"); continue
    lines.append(f"## {r['company']}\n")
    lines.append("| 项目 | 底稿 | 报表 | 差异 | 说明 |")
    lines.append("|---|---:|---:|---:|---|")
    for x in r["lines"]:
        d=x["diff"]
        mark="✅" if d is not None and abs(d)<0.01 else ("—" if d is None else "⚠️")
        note="" if d is None or abs(d)<0.01 else hint(r["company"],x["line"],d)
        if d is not None and abs(d)<0.01: ok+=1
        elif d is None: na+=1
        else: diff+=1
        f=lambda v: "" if v is None else f"{v:,.2f}"
        lines.append(f"| {x['line']} | {f(x['calc'])} | {f(x['fs'])} | {f(d)} {mark} | {note} |")
    lines.append("")
lines.insert(4,f"统计：完全一致 {ok} 项，有差异 {diff} 项，无报表可比 {na} 项。\n")
open("out/全科目勾稽报告.md","w").write("\n".join(lines))
print("\n".join(lines[:12]))
print("...")
print(f"ok={ok} diff={diff} na={na}")
