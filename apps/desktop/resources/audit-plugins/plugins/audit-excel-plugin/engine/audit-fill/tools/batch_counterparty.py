import sys, json, warnings
warnings.filterwarnings("ignore"); sys.path.insert(0,".")
from auditfill.tb import parse_tb
from auditfill.template import Template
from auditfill.fills.counterparty import fill_counterparty, summary_total_row, SUBJECTS
from auditfill.fs import load_statements
from auditfill.recalc import recalc

B="/Users/macbook/Documents/审计底稿"
TPL1="/Users/macbook/Downloads/1116/AI审计软件测试手工底稿/1流动资产2025.xlsx"
TPL3="/Users/macbook/Downloads/1116/AI审计软件测试手工底稿/3流动负债&权益2025.xlsx"
CASES=[
 ("中天","中天/科目余额表_2026012011003528_100409中天亚东格式一.xlsx","中天/财务报告_中天亚东-202512（未审计稿2026.1.19）.xlsx","中天亚东"),
 ("中延","中延/中延余额表.xls","中延/会计报表-中延-202512.xlsx","中延建设"),
 ("明璞","明璞/科目余额表2025.xls","明璞/202512资产负债表.xls","明璞资产"),
 ("舜壹","舜壹/舜壹余额表.xls","舜壹/2025年12月报表（更新）.xlsx","舜壹"),
 ("同进","同进/科目余额表-同进-新.xls","同进/同进202512.xlsx","同进置业"),
 ("安堡罗","安堡罗/科目余额表2025.xls","安堡罗/202512报表-报表以此为准.xlsx","安堡罗"),
]
ASSETS=[s for s in SUBJECTS if s.sign>0]
LIABS=[s for s in SUBJECTS if s.sign<0]
out=[]
for name,tbf,fsf,client in CASES:
    try:
        tb=parse_tb(f"{B}/{tbf}")
        sts=[s for s in load_statements(f"{B}/{fsf}") if s.kind=="bs"]
        fs=next((s for s in sts if s.get("货币资金") and s.get("货币资金").get("end") is not None), sts[0])
        for tpl_path,outf,subs in [(TPL1,f"out/{name}/1流动资产_往来.xlsx",ASSETS),(TPL3,f"out/{name}/3流动负债_往来.xlsx",LIABS)]:
            tpl=Template(tpl_path); tpl.prefill_directory(client,"2025年度",preparer="AI",date="2026-11-23")
            plans={s.name:fill_counterparty(tpl,tb,s) for s in subs}
            tpl.dump_report(outf.replace(".xlsx","_填写清单.csv")); path=tpl.save(outf)
            cells={}; rows={}
            for s in subs:
                ws=tpl.sheet(s.summary_sheet)
                r0=next((r for r in range(1,ws.max_row+1) if "1年以内" in str(ws.cell(r,1).value or "")), None)
                tr=summary_total_row(ws,r0) if r0 else None
                rows[s.name]=(r0,tr)
                if tr: cells[s.summary_sheet]=[f"D{tr}",f"E{tr}",f"G{tr}"]
            vals=recalc(path,cells) if cells else {}
            for s in subs:
                r0,tr=rows[s.name]
                key=f"{s.summary_sheet}!G{tr}"
                calc=vals.get(key)
                fsrow=fs.get(s.fs_line)
                fsend=fsrow["end"] if fsrow else None
                diff=None if (calc is None or fsend is None) else round(calc-fsend,2)
                rec={"company":name,"subject":s.name,"plan":plans[s.name].get("ok"),
                     "warnings":plans[s.name].get("warnings"),
                     "calc":calc,"fs":fsend,"diff":diff,"ok":diff==0 if diff is not None else None}
                out.append(rec); print(json.dumps(rec,ensure_ascii=False), flush=True)
    except Exception as e:
        print(json.dumps({"company":name,"error":f"{type(e).__name__}: {e}"},ensure_ascii=False), flush=True)
json.dump(out,open("out/往来批量.json","w"),ensure_ascii=False,indent=1)
