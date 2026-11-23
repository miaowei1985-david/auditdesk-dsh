import sys, json, time, warnings, traceback
warnings.filterwarnings("ignore"); sys.path.insert(0,".")
from auditfill.tb import parse_tb
from auditfill.template import Template
from auditfill.fills.money import fill_money
from auditfill.fs import load_statements
from auditfill.recalc import recalc

B="/Users/macbook/Documents/审计底稿"
TPL="/Users/macbook/Downloads/1116/AI审计软件测试手工底稿/1流动资产2025.xlsx"
CASES=[
 ("中天","中天/科目余额表_2026012011003528_100409中天亚东格式一.xlsx","中天/财务报告_中天亚东-202512（未审计稿2026.1.19）.xlsx","中天亚东"),
 ("中延","中延/中延余额表.xls","中延/会计报表-中延-202512.xlsx","中延建设"),
 ("丸金","丸金/发生额及余额表1至12月人民币.xlsx","丸金/资产负债表12月.xls","丸金商贸"),
 ("乐线","乐线/发生额及余额表2025.xlsx","乐线/2025年度报表新版（试用企业会计准则）.xls","乐线"),
 ("同进","同进/科目余额表-同进-新.xls","同进/同进202512.xlsx","同进置业"),
 ("明璞","明璞/科目余额表2025.xls","明璞/202512资产负债表.xls","明璞资产"),
 ("安堡罗","安堡罗/科目余额表2025.xls","安堡罗/202512报表-报表以此为准.xlsx","安堡罗"),
 ("舜壹","舜壹/舜壹余额表.xls","舜壹/2025年12月报表（更新）.xlsx","舜壹"),
 ("维曼","维曼/维曼余额表2025.xlsx","维曼/2026.AR. NO.报表-维曼.xls","维曼医疗"),
 ("集瑞船务","集瑞船务/科目余额表2025.xlsx",None,"集瑞船务"),
]
results=[]
for name,tbf,fsf,client in CASES:
    row={"company":name}
    try:
        tb=parse_tb(f"{B}/{tbf}")
        fs_cash=None
        if fsf:
            sts=[s for s in load_statements(f"{B}/{fsf}") if s.kind=="bs"]
            for st in sts:
                r=st.get("货币资金")
                if r and r.get("end") is not None:
                    fs_cash=r["end"]; break
        tpl=Template(TPL)
        tpl.prefill_directory(client,"2025年度",preparer="AI",date="2026-11-23")
        plan=fill_money(tpl,tb)
        out=tpl.save(f"out/{name}/1流动资产_货币资金.xlsx")
        vals=recalc(out,{"货币资金审定表":["B11","E11"],"货币资金明细表":["I35","L35"]})
        tb_begin=sum(tb.begin_std(c) for c in ("1001","1002","1012"))
        tb_end=sum(tb.end_std(c) for c in ("1001","1002","1012"))
        row.update({
          "cells":plan.get("cells"),"warnings":plan.get("warnings"),
          "tb_begin":tb_begin,"tb_end":tb_end,"fs_end":fs_cash,
          "calc_begin":vals.get("货币资金审定表!B11"),
          "calc_end":vals.get("货币资金审定表!E11"),
        })
        row["diff_end"]=None if fs_cash is None or row["calc_end"] is None else round(row["calc_end"]-fs_cash,2)
        row["ok"]=row["diff_end"] is not None and abs(row["diff_end"])<0.01
    except Exception as e:
        row["error"]=f"{type(e).__name__}: {e}"
    results.append(row)
    print(json.dumps(row,ensure_ascii=False), flush=True)
json.dump(results,open("out/货币资金批量.json","w"),ensure_ascii=False,indent=1)
