"""用 LibreOffice 重算成品底稿，验证审定表公式算出的数与报表一致。"""
import sys, os, glob, subprocess, warnings, json
warnings.filterwarnings("ignore"); sys.path.insert(0,".")
import openpyxl
from auditfill.fs import load_book

SOFF="/Applications/LibreOffice.app/Contents/MacOS/soffice"
CASES=[
 ("中天","中天/财务报告_中天亚东-202512（未审计稿2026.1.19）.xlsx",{
   "1流动资产2025.xlsx":[("货币资金审定表","E11","货币资金"),("应收账款审定表","E13","应收账款"),
                        ("其他应收款审定表","E13","其他应收款"),("存货审定表","G19","存货")],
   "3流动负债&权益2025.xlsx":[("应付账款审定表","E12","应付账款"),("预收款项审定表","E12","预收款项"),
                              ("应交税费审定表","E19","应交税费"),("实收资本审定表","E12","实收资本")],
   "5损益2025.xlsx":[("营业收入、营业成本审定表","D10","营业收入")]}),
 ("丸金","丸金/资产负债表12月.xls",{
   "1流动资产2025.xlsx":[("货币资金审定表","E11","货币资金"),("应收账款审定表","E13","应收账款")],
   "3流动负债&权益2025.xlsx":[("应付账款审定表","E12","应付账款"),("实收资本审定表","E12","实收资本")]}),
]
out=[]
for name,fsf,cells in CASES:
    fs=load_book(f"/Users/macbook/Documents/审计底稿/{fsf}")
    for wb,items in cells.items():
        path=f"out/{name}/底稿包/{wb}"
        if not os.path.exists(path): continue
        tmp=f"/tmp/rc/{name}/{wb}"; os.makedirs(tmp,exist_ok=True)
        subprocess.run([SOFF,"--headless","--convert-to","xlsx","--outdir",tmp,path],
                       stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=300)
        conv=glob.glob(f"{tmp}/*.xlsx")
        if not conv:
            out.append({"company":name,"file":wb,"error":"转换失败"}); continue
        book=openpyxl.load_workbook(conv[0],data_only=True)
        for sheet,cell,line in items:
            v=book[sheet][cell].value
            r=fs.get(line)
            fv=r["end"] if r else None
            diff=None if (v is None or fv is None) else round(v-fv,2)
            out.append({"company":name,"file":wb,"sheet":sheet,"cell":cell,
                        "calc":None if v is None else round(v,2),"fs":fv,"diff":diff})
            print(json.dumps(out[-1],ensure_ascii=False), flush=True)
json.dump(out,open("out/重算验证.json","w"),ensure_ascii=False,indent=1)
