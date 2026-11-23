"""全部公司成品底稿的公式重算验证（LibreOffice 重算后读审定表合计）。"""
import sys, os, glob, subprocess, warnings, json, shutil
warnings.filterwarnings("ignore"); sys.path.insert(0,".")
import openpyxl
from auditfill.fs import load_book

SOFF="/Applications/LibreOffice.app/Contents/MacOS/soffice"
B="/Users/macbook/Documents/审计底稿"
CASES={
 "中天":"中天/财务报告_中天亚东-202512（未审计稿2026.1.19）.xlsx",
 "中延":"中延/会计报表-中延-202512.xlsx",
 "丸金":"丸金/资产负债表12月.xls",
 "同进":"同进/同进202512.xlsx",
 "明璞":"明璞/202512资产负债表.xls",
 "舜壹":"舜壹/2025年12月报表（更新）.xlsx",
 "维曼":"维曼/2026.AR. NO.报表-维曼.xls",
 "乐线":"乐线/2025年度报表新版（试用企业会计准则）.xls",
 "安堡罗":"安堡罗/202512报表-报表以此为准.xlsx",
 "赞富":"赞富/25年12月报表赞富.xls",
}
CHECKS=[
 ("1流动资产2025.xlsx","货币资金审定表","E11",("货币资金",)),
 ("1流动资产2025.xlsx","应收账款审定表","E13",("应收账款",)),
 ("1流动资产2025.xlsx","其他应收款审定表","E13",("其他应收款",)),
 ("1流动资产2025.xlsx","存货审定表","G19",("存货",)),
 ("3流动负债&权益2025.xlsx","应付账款审定表","E12",("应付账款",)),
 ("3流动负债&权益2025.xlsx","预收款项审定表","E12",("预收款项","预收账款")),
 ("3流动负债&权益2025.xlsx","应交税费审定表","E19",("应交税费","未交税金")),
 ("3流动负债&权益2025.xlsx","实收资本审定表","E12",("实收资本(或股本)","实收资本（或股本）","实收资本","股本")),
 ("5损益2025.xlsx","营业收入、营业成本审定表","D10",("营业收入","营业总收入")),
]
rows=[]
for name,fsf in CASES.items():
    d=f"out/{name}/底稿包"
    if not os.path.isdir(d): continue
    fs=load_book(f"{B}/{fsf}")
    wbs=sorted({c[0] for c in CHECKS if os.path.exists(f"{d}/{c[0]}")})
    tmp=f"/tmp/ra/{name}"; shutil.rmtree(tmp,ignore_errors=True); os.makedirs(tmp,exist_ok=True)
    prof=f"file:///tmp/lo_prof_co_{abs(hash(name))%100000}"
    try:
        subprocess.run([SOFF,"-env:UserInstallation="+prof,"--headless","--convert-to","xlsx",
                        "--outdir",tmp]+[f"{d}/{w}" for w in wbs],
                       stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=180,check=False)
    except subprocess.TimeoutExpired:
        subprocess.run(["pkill","-f","soffice"],capture_output=True)
    for wb,sheet,cell,aliases in CHECKS:
        path=f"{d}/{wb}"
        if not os.path.exists(path): continue
        conv=[f"{tmp}/{wb}"] if os.path.exists(f"{tmp}/{wb}") else []
        if not conv: continue
        try:
            book=openpyxl.load_workbook(conv[0],data_only=True)
            v=book[sheet][cell].value
        except Exception:
            continue
        r=fs.get(*aliases); fv=r["end"] if r else None
        if fv is None: continue
        diff=None if v is None else round(v-fv,2)
        rows.append({"company":name,"workbook":wb,"sheet":sheet,"cell":cell,
                     "calc":None if v is None else round(v,2),"fs":round(fv,2),"diff":diff})
        print(json.dumps(rows[-1],ensure_ascii=False), flush=True)
json.dump(rows,open("out/重算验证_all.json","w"),ensure_ascii=False,indent=1)
