import sys, json, warnings
warnings.filterwarnings("ignore"); sys.path.insert(0,".")
from auditfill.tb import parse_tb
from auditfill.template import Template
from auditfill.fills.counterparty import fill_counterparty, SUBJECTS
from auditfill.fs import load_statements
from auditfill.recalc import recalc

B="/Users/macbook/Documents/审计底稿"
TB=f"{B}/中天/科目余额表_2026012011003528_100409中天亚东格式一.xlsx"
TB2=f"{B}/中天/科目余额表_2026012011011510_100409中天亚东格式二.xlsx"
TPL1="/Users/macbook/Downloads/1116/AI审计软件测试手工底稿/1流动资产2025.xlsx"
TPL3="/Users/macbook/Downloads/1116/AI审计软件测试手工底稿/3流动负债&权益2025.xlsx"
tb=parse_tb(TB)
fs=[s for s in load_statements(f"{B}/中天/财务报告_中天亚东-202512（未审计稿2026.1.19）.xlsx") if s.kind=="bs"][0]

for tpl_path, out_name, subs in [
    (TPL1,"out/中天/1流动资产_往来.xlsx",["应收账款","预付款项","其他应收款"]),
    (TPL3,"out/中天/3流动负债_往来.xlsx",["应付账款","预收款项","其他应付款"]),
]:
    tpl=Template(tpl_path); tpl.prefill_directory("中天亚东","2025年度",preparer="AI",date="2026-11-23")
    plans=[]
    for s in SUBJECTS:
        if s.name in subs:
            r=fill_counterparty(tpl,tb,s); plans.append(r); print(json.dumps(r,ensure_ascii=False))
    tpl.dump_report(out_name.replace(".xlsx","_填写清单.csv"))
    path=tpl.save(out_name)
    # locate total rows for recalc
    cells={}
    for s in SUBJECTS:
        if s.name in subs:
            ws=tpl.sheet(s.summary_sheet)
            tr=None
            for r in range(1,ws.max_row+1):
                if "合计" in str(ws.cell(r,1).value or ""): tr=r
            cells.setdefault(s.summary_sheet,[]).extend([f"D{tr}",f"E{tr}",f"G{tr}"])
    vals=recalc(path,cells)
    print("== recalc", out_name)
    for k,v in vals.items():
        print(f"  {k} = {v:,.2f}" if v is not None else f"  {k}=None")
    print("== FS")
    for s in SUBJECTS:
        if s.name in subs:
            row=fs.get(s.fs_line); print(f"  {s.fs_line}: {row['end'] if row else None}")
