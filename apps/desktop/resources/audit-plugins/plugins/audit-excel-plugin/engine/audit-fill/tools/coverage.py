"""模板填写覆盖率：每个工作簿填了多少张表，剩余是什么类型。"""
import os, csv, re, warnings, json
warnings.filterwarnings("ignore")
import openpyxl

T="/Users/macbook/Downloads/1116/AI审计软件测试手工底稿"
WBS=["1流动资产2025.xlsx","2非流动资产2025.xlsx","3流动负债&权益2025.xlsx","4非流动负债2025.xlsx","5损益2025.xlsx"]
CATS=[("程序表",("程序表",)),("审定表",("审定表",)),("明细表",("明细表",)),
      ("测试/检查/盘点/函证",("测试","检查","盘点","函证","调节","分析","计算","截止")),
      ("目录/封面",("目录","封面","索引")),("其他",())]

def cat(name):
    for label,keys in CATS:
        if keys and any(k in name for k in keys): return label
    return "其他"

def filled_sheets(company):
    out=set()
    for f in WBS:
        p=f"out/{company}/底稿包/{f}.填写清单.csv"
        if not os.path.exists(p): continue
        with open(p,encoding="utf-8-sig") as fh:
            for row in csv.DictReader(fh):
                if row.get("kind")=="data":
                    out.add((f,row["sheet"]))
    return out

companies=["中天","中延","丸金","同进","明璞","舜壹","维曼","乐线","安堡罗"]
lines=["# 模板填写覆盖率（2026-11-23）","",
"按工作簿统计：填了数的表 / 全部表，以及未填表的类型分布。",""]
summary=[]
for c in companies:
    fs=filled_sheets(c)
    if not fs: continue
    lines.append(f"## {c}\n")
    lines.append("| 工作簿 | 表数 | 已填 | 其中审定/明细表 已填/合计 | 未填类型 |")
    lines.append("|---|---:|---:|---:|---|")
    total_f=total_a=0; q_f=q_a=0
    for wb in WBS:
        path=f"{T}/{wb}"
        w=openpyxl.load_workbook(path, read_only=True)
        names=list(w.sheetnames); w.close()
        filled=[n for n in names if (wb,n) in fs]
        rest=[n for n in names if (wb,n) not in fs]
        cnt={}
        for n in rest: cnt[cat(n)]=cnt.get(cat(n),0)+1
        total_f+=len(filled); total_a+=len(names)
        quant=[n for n in names if cat(n) in ("审定表","明细表")]
        qfilled=[n for n in quant if (wb,n) in fs]
        q_f+=len(qfilled); q_a+=len(quant)
        lines.append(f"| {wb.replace('.xlsx','')} | {len(names)} | {len(filled)} | {len(qfilled)}/{len(quant)} | " +
                     "、".join(f"{k} {v}" for k,v in cnt.items()) + " |")
    lines.append("")
    summary.append((c,total_f,total_a,q_f,q_a))
lines.append("## 汇总\n")
lines.append("说明：全表覆盖率低是正常的——499 张表里大部分是程序表、检查表、函证、测试表，需要人工判断和客户证据；")
lines.append("本流水线只负责「有余额、可计算」的审定表/明细表。审定/明细表覆盖率按全部此类表计，")
lines.append("其中不少表对应科目本身余额为 0（如交易性金融资产、应付债券），实际不需要填。\n")
lines.append("| 公司 | 已填表 | 模板表数 | 全表覆盖率 | 审定/明细表覆盖率 |")
lines.append("|---|---:|---:|---:|---:|")
for c,a,b,qa,qb in summary:
    al=f"{a/b:.1%}" if b else "-"
    ql=f"{qa/qb:.1%}" if qb else "-"
    lines.append(f"| {c} | {a} | {b} | {al} | {ql} |")
open("out/模板覆盖率.md","w").write("\n".join(lines))
print("\n".join(lines[-12:]))
