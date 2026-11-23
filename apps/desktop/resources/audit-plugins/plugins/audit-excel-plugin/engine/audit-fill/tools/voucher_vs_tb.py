"""账证核对：凭证汇总 vs 科目余额表发生额，按标准科目比对。

用途：发现凭证不完整、跨期、或凭证与总账不一致（如维曼收入差 1,563 万）。
"""
import sys, json, warnings
warnings.filterwarnings("ignore"); sys.path.insert(0,".")
from auditfill.tb import parse_tb
from auditfill.vouchers import parse_vouchers
from auditfill.cashflow import std_lookup
from auditfill import chart

B="/Users/macbook/Documents/审计底稿"
CASES=[("中天","中天/科目余额表_2026012011003528_100409中天亚东格式一.xlsx","中天/凭证_2026012011043634_100409中天亚东.xlsx"),
("中延","中延/中延余额表.xls","中延/中延-2025年度序时账.xls"),
("丸金","丸金/发生额及余额表1至12月人民币.xlsx","丸金/填制凭证1-12月.xlsx"),
("舜壹","舜壹/舜壹余额表.xls","舜壹/舜壹-2025年度序时账.xls"),
("赞富","赞富/科目余额表.xls","赞富/25年时序.xls"),
("维曼","维曼/维曼余额表2025.xlsx","维曼/维曼（上海）医疗器械贸易有限公司-凭证数据 (2025).xlsx"),
("集瑞船务","集瑞船务/科目余额表2025.xlsx","集瑞船务/序时账2025-有特殊注明不计提使用权资产.xlsx")]
rows=[]
for n,tbf,vf in CASES:
    try:
        tb=parse_tb(f"{B}/{tbf}"); es=parse_vouchers(f"{B}/{vf}")
        resolve=std_lookup(tb)
        vd={}; vc={}
        for e in es:
            s=resolve(e.code,e.name)
            if not s: continue
            vd[s]=vd.get(s,0)+e.debit; vc[s]=vc.get(s,0)+e.credit
        td={}; tc={}
        for std in {a.std for a in tb.accounts if a.std}:
            for a in tb.by_std(std):
                td[std]=td.get(std,0)+a.debit; tc[std]=tc.get(std,0)+a.credit
        diffs=[]
        for s in sorted(set(vd)|set(vc)|set(td)|set(tc)):
            d=round(vd.get(s,0)-td.get(s,0),2); c=round(vc.get(s,0)-tc.get(s,0),2)
            if abs(d)>1 or abs(c)>1:
                diffs.append({"std":s,"name":(chart.by_code(s) or ("",""))[1] if False else "",
                              "debit_diff":d,"credit_diff":c})
        rows.append({"company":n,"accounts":len(td),"diffs":diffs})
        print(json.dumps({"company":n,"diff_count":len(diffs),"top":sorted(diffs,key=lambda x:-abs(x['debit_diff']))[:3]},ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"company":n,"error":f"{type(e).__name__}: {e}"},ensure_ascii=False))
json.dump(rows,open("out/账证核对.json","w"),ensure_ascii=False,indent=1)
