import sys, json, warnings
warnings.filterwarnings("ignore"); sys.path.insert(0,".")
from auditfill.tb import parse_tb
from auditfill.template import Template
from auditfill.fills.money import fill_money
from auditfill.fills.counterparty import fill_counterparty, SUBJECTS
from auditfill.fills.inventory import fill_inventory
from auditfill.fills.fixed_assets import fill_fixed_assets
from auditfill.fs import load_statements

B="/Users/macbook/Documents/审计底稿"
T1="/Users/macbook/Downloads/1116/AI审计软件测试手工底稿/1流动资产2025.xlsx"
T2="/Users/macbook/Downloads/1116/AI审计软件测试手工底稿/2非流动资产2025.xlsx"
T3="/Users/macbook/Downloads/1116/AI审计软件测试手工底稿/3流动负债&权益2025.xlsx"
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
def fs_lookup(path):
    sts=[s for s in load_statements(path) if s.kind=="bs"]
    st=next((s for s in sts if s.get("货币资金") and s.get("货币资金").get("end") is not None), sts[0] if sts else None)
    return st

FS_ALIASES = {
    "固定资产": ("固定资产净额", "固定资产净值", "固定资产账面价值", "固定资产"),
    "存货": ("存货",),
}

def cmp(row, label, calc, fs):
    if calc is None: return
    fv = None
    if fs is not None:
        r=fs.get(*FS_ALIASES.get(label,(label,)))
        fv = r["end"] if r else None
    row.setdefault("lines",[]).append({"line":label,"calc":round(calc,2),"fs":None if fv is None else round(fv,2),
                                       "diff":None if fv is None else round(calc-fv,2)})

results=[]
for name,tbf,fsf,client in CASES:
    row={"company":name,"lines":[]}
    try:
        tb=parse_tb(f"{B}/{tbf}")
        fs=fs_lookup(f"{B}/{fsf}") if fsf else None
        # 1流动资产: money + assets + inventory
        tpl=Template(T1); tpl.prefill_directory(client,"2025年度",preparer="AI",date="2026-11-23")
        mp=fill_money(tpl,tb)
        cmp(row,"货币资金",sum(s["end"] for s in mp.get("sections",[])),fs)
        for s in SUBJECTS:
            if s.sign>0:
                p=fill_counterparty(tpl,tb,s)
                if p.get("ok") and p.get("units"): cmp(row,s.fs_line,p.get("end"),fs)
        ip=fill_inventory(tpl,tb)
        if ip.get("ok"): cmp(row,"存货",ip.get("calc"),fs)
        tpl.dump_report(f"out/{name}/1流动资产_填写清单.csv"); tpl.save(f"out/{name}/1流动资产.xlsx")
        # 3流动负债
        tpl3=Template(T3); tpl3.prefill_directory(client,"2025年度",preparer="AI",date="2026-11-23")
        for s in SUBJECTS:
            if s.sign<0:
                p=fill_counterparty(tpl3,tb,s)
                if p.get("ok") and p.get("units"): cmp(row,s.fs_line,p.get("end"),fs)
        tpl3.dump_report(f"out/{name}/3流动负债_填写清单.csv"); tpl3.save(f"out/{name}/3流动负债.xlsx")
        # 2非流动资产
        tpl2=Template(T2); tpl2.prefill_directory(client,"2025年度",preparer="AI",date="2026-11-23")
        fp=fill_fixed_assets(tpl2,tb)
        if fp.get("ok"): cmp(row,"固定资产",fp.get("tb_net"),fs)
        tpl2.save(f"out/{name}/2非流动资产.xlsx")
    except Exception as e:
        row["error"]=f"{type(e).__name__}: {e}"
    results.append(row)
    print(json.dumps(row,ensure_ascii=False), flush=True)
json.dump(results,open("out/全科目批量.json","w"),ensure_ascii=False,indent=1)
