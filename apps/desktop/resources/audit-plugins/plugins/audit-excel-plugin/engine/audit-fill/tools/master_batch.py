import sys, os, glob, json, subprocess, warnings
warnings.filterwarnings("ignore"); sys.path.insert(0,".")
import openpyxl
from auditfill.template import Template
from auditfill.fills.master import fill_master
from auditfill.fs import load_book, load_statements

B="/Users/macbook/Documents/审计底稿"
SOFF="/Applications/LibreOffice.app/Contents/MacOS/soffice"
CASES=[("中天","中天/财务报告_中天亚东-202512（未审计稿2026.1.19）.xlsx"),
("中延","中延/会计报表-中延-202512.xlsx"),("丸金","丸金/资产负债表12月.xls"),
("乐线","乐线/2025年度报表新版（试用企业会计准则）.xls"),("同进","同进/同进202512.xlsx"),
("明璞","明璞/202512资产负债表.xls"),("安堡罗","安堡罗/202512报表-报表以此为准.xlsx"),
("舜壹","舜壹/2025年12月报表（更新）.xlsx"),("维曼","维曼/2026.AR. NO.报表-维曼.xls"),
("赞富","赞富/25年12月报表赞富.xls")]
out=[]
for n,fsf in CASES:
    path=f"out/{n}/01主底稿.xlsx"
    try:
        fs=load_book(f"{B}/{fsf}")
        tpl=Template("templates/01_master.xlsx"); fill_master(tpl,fs,n); tpl.save(path)
        tmp=f"/tmp/mb/{n}"; os.makedirs(tmp,exist_ok=True)
        subprocess.run([SOFF,"--headless","--convert-to","xlsx","--outdir",tmp,path],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180)
        conv=glob.glob(f"{tmp}/*.xlsx")
        vals={}
        if conv:
            wb=openpyxl.load_workbook(conv[0],data_only=True)
            vals["assets"]=wb["资产表"].cell(44,3).value
            vals["le"]=wb["负债表"].cell(45,3).value
        vals["fs_assets"]=fs.total("资产总计","资产合计")
        vals["diff"]=None if (vals.get("assets") is None or vals["fs_assets"] is None) else round(vals["assets"]-vals["fs_assets"],2)
        out.append({"company":n,**vals})
    except Exception as e:
        out.append({"company":n,"error":f"{type(e).__name__}: {e}"})
    print(json.dumps(out[-1],ensure_ascii=False), flush=True)
json.dump(out,open("out/01主底稿批量.json","w"),ensure_ascii=False,indent=1)
