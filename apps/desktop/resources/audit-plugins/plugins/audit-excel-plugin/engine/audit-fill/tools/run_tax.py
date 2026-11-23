import sys, json, time, warnings
warnings.filterwarnings("ignore"); sys.path.insert(0,".")
from auditfill.tb import parse_tb
from auditfill.template import Template
from auditfill.fills.tax import fill_tax
from auditfill.recalc import recalc

TB="/Users/macbook/Documents/审计底稿/中天/科目余额表_2026012011003528_100409中天亚东格式一.xlsx"
TPL="/Users/macbook/Downloads/1116/AI审计软件测试手工底稿/3流动负债&权益2025.xlsx"
tb=parse_tb(TB)
tpl=Template(TPL)
tpl.prefill_directory("中天亚东","2025年度",preparer="AI",date="2026-11-23")
plan=fill_tax(tpl,tb)
out=tpl.save("out/中天/3流动负债_应交税费.xlsx")
print(json.dumps({k:v for k,v in plan.items() if k!="rows"},ensure_ascii=False,indent=1))
for r in plan.get("rows",[]): print(" ",r)
vals=recalc(out,{"应交税费明细表":["H20","J20"],"应交税费审定表":["B19","E19","G19"]})
for k,v in vals.items(): print(f"  {k} = {v:,.2f}" if v is not None else f"  {k}=None")
