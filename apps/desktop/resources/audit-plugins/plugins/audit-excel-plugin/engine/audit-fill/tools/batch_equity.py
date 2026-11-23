import sys, json, warnings
warnings.filterwarnings("ignore"); sys.path.insert(0,".")
from auditfill.tb import parse_tb
from auditfill.template import Template
from auditfill.fills.equity import fill_paid_in, fill_reserve
from auditfill.fs import load_statements
from auditfill.recalc import recalc
B="/Users/macbook/Documents/审计底稿"
T3="/Users/macbook/Downloads/1116/AI审计软件测试手工底稿/3流动负债&权益2025.xlsx"
CASES=[("中天","中天/科目余额表_2026012011003528_100409中天亚东格式一.xlsx","中天/财务报告_中天亚东-202512（未审计稿2026.1.19）.xlsx","中天亚东"),
("中延","中延/中延余额表.xls","中延/会计报表-中延-202512.xlsx","中延建设"),
("明璞","明璞/科目余额表2025.xls","明璞/202512资产负债表.xls","明璞资产"),
("舜壹","舜壹/舜壹余额表.xls","舜壹/2025年12月报表（更新）.xlsx","舜壹"),
("丸金","丸金/发生额及余额表1至12月人民币.xlsx","丸金/资产负债表12月.xls","丸金商贸"),
("安堡罗","安堡罗/科目余额表2025.xls","安堡罗/202512报表-报表以此为准.xlsx","安堡罗"),
("同进","同进/科目余额表-同进-新.xls","同进/同进202512.xlsx","同进置业"),
("维曼","维曼/维曼余额表2025.xlsx","维曼/2026.AR. NO.报表-维曼.xls","维曼医疗")]
ALIAS={"实收资本":("实收资本(或股本)","实收资本（或股本）","实收资本","股本"),
       "资本公积":("资本公积",),"盈余公积":("盈余公积",)}
out=[]
for name,tbf,fsf,client in CASES:
    row={"company":name,"lines":[]}
    try:
        tb=parse_tb(f"{B}/{tbf}")
        sts=[s for s in load_statements(f"{B}/{fsf}") if s.kind=="bs"]
        fs=next((s for s in sts if s.get("实收资本") or s.get("实收资本(或股本)") or s.get("实收资本（或股本）")), None)
        tpl=Template(T3); tpl.prefill_directory(client,"2025年度",preparer="AI",date="2026-11-23")
        fill_paid_in(tpl,tb)
        fill_reserve(tpl,tb,std="4101",sheet="盈余公积明细表")
        fill_reserve(tpl,tb,std="4002",sheet="资本公积明细表")
        p=tpl.save(f"out/{name}/3流动负债_权益.xlsx")
        vals=recalc(p,{"实收资本审定表":["E12"],"盈余公积审定表":["E15"],"资本公积审定表":["E16"]})
        for label,key in [("实收资本","实收资本审定表!E12"),("盈余公积","盈余公积审定表!E15"),("资本公积","资本公积审定表!E16")]:
            calc=vals.get(key)
            fv=None
            if fs:
                r=fs.get(*ALIAS[label]); fv=r["end"] if r else None
            diff=None if (calc is None or fv is None) else round(calc-fv,2)
            row["lines"].append({"line":label,"calc":calc,"fs":fv,"diff":diff})
    except Exception as e:
        row["error"]=f"{type(e).__name__}: {e}"
    out.append(row); print(json.dumps(row,ensure_ascii=False), flush=True)
json.dump(out,open("out/权益批量.json","w"),ensure_ascii=False,indent=1)
