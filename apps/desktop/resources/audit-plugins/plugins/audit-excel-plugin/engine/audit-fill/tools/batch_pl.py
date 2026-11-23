import sys, json, warnings
warnings.filterwarnings("ignore"); sys.path.insert(0,".")
from auditfill.tb import parse_tb
from auditfill.fills.pl import revenue_total, cost_total, pl_amount, leaves
from auditfill.fs import load_book
B="/Users/macbook/Documents/审计底稿"
CASES=[
 ("中天","中天/科目余额表_2026012011003528_100409中天亚东格式一.xlsx","中天/财务报告_中天亚东-202512（未审计稿2026.1.19）.xlsx"),
 ("中延","中延/中延余额表.xls","中延/会计报表-中延-202512.xlsx"),
 ("丸金","丸金/发生额及余额表1至12月人民币.xlsx","丸金/利润表12月.xls"),
 ("乐线","乐线/发生额及余额表2025.xlsx","乐线/2025年度报表新版（试用企业会计准则）.xls"),
 ("同进","同进/科目余额表-同进-新.xls","同进/同进202512.xlsx"),
 ("明璞","明璞/科目余额表2025.xls","明璞/202512利润表.xls"),
 ("安堡罗","安堡罗/科目余额表2025.xls","安堡罗/202512报表-报表以此为准.xlsx"),
 ("舜壹","舜壹/舜壹余额表.xls","舜壹/2025年12月报表（更新）.xlsx"),
 ("维曼","维曼/维曼余额表2025.xlsx","维曼/2026.AR. NO.报表-维曼.xls"),
 ("赞富","赞富/科目余额表.xls","赞富/25年12月报表赞富.xls"),
]
LINES=[("营业收入","6001",True),("营业成本","6401",False),("税金及附加","6403",False),
       ("管理费用","6602",False),("财务费用","6603",False),("所得税费用","6801",False)]
out=[]
for name,tbf,fsf in CASES:
    row={"company":name,"lines":[]}
    try:
        tb=parse_tb(f"{B}/{tbf}")
        st=load_book(f"{B}/{fsf}")
        for label,std,rev in LINES:
            amt=revenue_total(tb,std) if rev else cost_total(tb,std)
            fv=None
            aliases={"营业收入":("营业收入","营业总收入","主营业务收入"),
                     "税金及附加":("税金及附加","营业税金及附加","主营业务税金及附加"),
                     "营业成本":("营业成本","主营业务成本")}.get(label,(label,))
            if st:
                r=st.get(*aliases)
                fv=r["end"] if r else None
            row["lines"].append({"line":label,"calc":round(amt,2),"fs":fv,
                                 "diff":None if fv is None else round(amt-fv,2)})
    except Exception as e:
        row["error"]=f"{type(e).__name__}: {e}"
    out.append(row); print(json.dumps(row,ensure_ascii=False), flush=True)
json.dump(out,open("out/损益批量.json","w"),ensure_ascii=False,indent=1)
