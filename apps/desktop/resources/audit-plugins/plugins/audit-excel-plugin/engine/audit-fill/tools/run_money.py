import sys, time, json
sys.path.insert(0, ".")
from auditfill.tb import parse_tb
from auditfill.template import Template
from auditfill.fills.money import fill_money, expected_totals
from auditfill.recalc import recalc

TB = "/Users/macbook/Documents/审计底稿/中天/科目余额表_2026012011003528_100409中天亚东格式一.xlsx"
TPL = "/Users/macbook/Downloads/1116/AI审计软件测试手工底稿/1流动资产2025.xlsx"
OUT = "out/中天/1流动资产_货币资金.xlsx"

tb = parse_tb(TB)
tpl = Template(TPL)
tpl.prefill_directory("中天亚东", "2025年度", preparer="AI", date="2026-11-23")
plan = fill_money(tpl, tb)
path = tpl.save(OUT)
print(json.dumps(plan, ensure_ascii=False, indent=1)[:1500])
print("saved", path)
print("expected", expected_totals(tb))
t = time.time()
vals = recalc(path, {"货币资金明细表": ["I12","L12","I28","L28","I34","L34","I35","L35"],
                     "货币资金审定表": ["B11","D11","E11","G11"]})
print("recalc", round(time.time()-t,1), "s")
for k, v in vals.items(): print(f"  {k} = {v:,.2f}" if v is not None else f"  {k} = None")
