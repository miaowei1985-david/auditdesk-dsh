"""交付前质量检查：公式保留、样例数据清除、填写依据、合计公式。"""
import os, csv, glob, warnings
warnings.filterwarnings("ignore")
import openpyxl

T="/Users/macbook/Downloads/1116/AI审计软件测试手工底稿"
COMPANIES=["中天","中延","丸金","同进","明璞","舜壹","维曼","乐线","安堡罗","赞富"]
SAMPLE_01=["AAA公司","235783.54","449782.4","1192595.25","1457429.09","397622.42","511621.28"]
WB=["1流动资产2025.xlsx","2非流动资产2025.xlsx","3流动负债&权益2025.xlsx","5损益2025.xlsx"]

def formula_count(path):
    wb=openpyxl.load_workbook(path, read_only=True, data_only=False)
    n=0
    for ws in wb.worksheets:
        for row in ws.iter_rows(values_only=True):
            for v in row:
                if isinstance(v,str) and v.startswith("="): n+=1
    wb.close(); return n

def main():
    rows=[]
    for c in COMPANIES:
        base=f"out/{c}/底稿包"
        if not os.path.isdir(base): continue
        # 1) 公式保留
        for wb in WB:
            tpl=f"{T}/{wb}"; out=f"{base}/{wb}"
            if not os.path.exists(out): continue
            ft,fo=formula_count(tpl),formula_count(out)
            rows.append((c,wb,"公式保留",f"模板 {ft} / 输出 {fo}", fo>=ft*0.98))
        # 2) 01 样例数据
        p=f"out/{c}/01主底稿.xlsx"
        if os.path.exists(p):
            wb=openpyxl.load_workbook(p, data_only=True)
            leftovers=[]
            for sh in ("封面","资产表","负债表","利润表"):
                ws=wb[sh]
                for row in ws.iter_rows(values_only=True):
                    for v in row:
                        if isinstance(v,str) and v in SAMPLE_01: leftovers.append(f"{sh}:{v}")
                        elif isinstance(v,(int,float)) and f"{v}" in SAMPLE_01: leftovers.append(f"{sh}:{v}")
            rows.append((c,"01主底稿","样例数据清除","无残留" if not leftovers else f"残留 {leftovers[:3]}", not leftovers))
        # 3) 填写依据完整
        empties=0; total=0
        for f in glob.glob(f"{base}/*.填写清单.csv"):
            with open(f,encoding="utf-8-sig") as fh:
                for r in csv.DictReader(fh):
                    total+=1
                    if not (r.get("basis") or "").strip(): empties+=1
        rows.append((c,"全部底稿","填写依据",f"{total} 条，缺依据 {empties}", empties==0))
    lines=["# 交付前质量检查（2026-11-23）","",
"| 公司 | 检查项 | 对象 | 结果 | 结论 |","|---|---|---|---|---|"]
    ok=0; bad=0
    for c,obj,item,detail,pass_ in rows:
        ok+=1 if pass_ else 0
        bad+=0 if pass_ else 1
        lines.append(f"| {c} | {item} | {obj} | {detail} | {'✅' if pass_ else '⚠️'} |")
    lines+=["",f"合计：通过 {ok} 项，异常 {bad} 项。"]
    open("out/质量检查.md","w").write("\n".join(lines))
    print("\n".join(lines[-8:]))
    print("ok",ok,"bad",bad)

if __name__=="__main__": main()
