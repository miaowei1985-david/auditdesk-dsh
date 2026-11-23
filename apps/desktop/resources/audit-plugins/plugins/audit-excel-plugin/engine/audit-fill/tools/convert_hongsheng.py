"""把虹盛「科目汇总表」（流水式）转成标准科目余额表 xlsx。

格式：每个科目一段，段头 `（1001）库存现金`；段内逐笔：日期/凭证/摘要/对方科目/金额/借贷/余额。
跳过「本日合计 / 本期合计 / 本年累计」行。
"""
import os, re, sys, warnings
warnings.filterwarnings("ignore"); sys.path.insert(0,".")
import openpyxl
from auditfill.reader import load_grid

SRC="/Users/macbook/Documents/审计底稿/虹盛/上海虹盛商务咨询有限公司科目汇总表[2025年1期-2025年12期]20260115161527.xls"
OUT=os.path.join(os.path.dirname(__file__), "..", "out", "转换", "虹盛_科目余额表.xlsx")

def num(v):
    try: return float(str(v).replace(",", ""))
    except Exception: return 0.0

def is_header(cells):
    for c in cells:
        m=re.match(r"^[（(]\s*(\d{4,})\s*[)）]\s*(.+)$", (c or "").strip())
        if m:
            return m.group(1), m.group(2).strip()
    return None

g=load_grid(SRC)
heads=[]
for r in range(g.nrows):
    cells=[g.text(r,c) for c in range(g.ncols)]
    h=is_header(cells)
    if h: heads.append((r, h[0], h[1]))

acc={}
for i,(r0,code,name) in enumerate(heads):
    r1 = heads[i+1][0] if i+1 < len(heads) else g.nrows
    begin=0.0; bdir="借"; debit=0.0; credit=0.0; end=0.0; edir="借"
    for r in range(r0+1, r1):
        cells=[g.text(r,c) for c in range(g.ncols)]
        joined="".join(cells)
        if "合计" in joined or "累计" in joined:
            continue
        if "期初余额" in joined:
            begin=num(cells[7]); bdir=cells[6] or "借"
            if cells[7]: end=begin; edir=bdir
            continue
        if not re.match(r"\d{4}-\d{2}-\d{2}", cells[0]):
            continue
        amt=num(cells[5]); d=cells[6] or "借"
        if d=="借": debit+=amt
        else: credit+=amt
        if cells[7]:
            end=num(cells[7]); edir=d
    bs = begin if bdir=="借" else -begin
    es = end if edir=="借" else -end
    acc[code]={"name":name,"begin":bs,"debit":debit,"credit":credit,"end":es}

wb=openpyxl.Workbook(); ws=wb.active
ws.append(["科目代码","科目名称","期初余额","本期借方","本期贷方","期末余额"])
for code,a in sorted(acc.items()):
    ws.append([code,a["name"],round(a["begin"],2),round(a["debit"],2),round(a["credit"],2),round(a["end"],2)])
os.makedirs(os.path.dirname(OUT),exist_ok=True)
wb.save(OUT)
tot_end=sum(a["end"] for a in acc.values())
print("accounts",len(acc),"sum end",round(tot_end,2),"saved",OUT)
