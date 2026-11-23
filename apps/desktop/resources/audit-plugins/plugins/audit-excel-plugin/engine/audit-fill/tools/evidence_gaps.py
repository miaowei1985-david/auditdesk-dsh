"""按公司生成「待取证清单」：把差异、缺失科目、填写假设汇总成要客户补的资料。"""
import json, os, csv, warnings
warnings.filterwarnings("ignore")

B="out"
RULE = [
 ("货币资金", "银行对账单、余额调节表、银行询证函回函"),
 ("应收账款", "应收账龄表、对账单、函证回函、期后回款"),
 ("预付款项", "采购合同、付款凭证、发票、到货验收单"),
 ("其他应收款", "往来性质说明、借款协议、还款计划"),
 ("存货", "存货清单/盘点表、计价方法说明、出入库单"),
 ("固定资产", "固定资产卡片、折旧政策、盘点表、权证"),
 ("无形资产", "无形资产权证、摊销政策、减值测试"),
 ("应付账款", "供应商对账单、采购合同、函证回函"),
 ("预收款项", "销售合同、发货记录、结算单"),
 ("其他应付款", "款项性质说明、还款协议"),
 ("应付职工薪酬", "工资表、社保缴纳凭证、个税申报"),
 ("应交税费", "纳税申报表、汇算清缴报告、完税凭证"),
 ("实收资本", "验资报告、最新章程、股东名册"),
 ("资本公积", "出资/评估资料"),
 ("盈余公积", "股东会决议、利润分配决议"),
 ("未分配利润", "利润分配决议、前期差错更正说明"),
 ("营业收入", "销售合同、发票、结算单、截止性测试资料"),
 ("营业成本", "成本核算表、采购发票、完工验收"),
 ("管理费用", "费用明细账、发票"),
 ("财务费用", "借款合同、利息计算表、汇兑说明"),
 ("所得税费用", "纳税申报表、递延所得税计算表"),
]

def load(p):
    try: return json.load(open(p))
    except Exception: return None

def company_gaps(name):
    gaps=[]
    # 1) 报表 vs TB 差异
    bs=load(f"{B}/资产负债表勾稽.json") or []
    for r in bs:
        if r.get("company")==name and r.get("diffs"):
            for d in r["diffs"]:
                doc=next((v for k,v in RULE if d["line"].startswith(k)), "相关支持性文件")
                gaps.append({"type":"报表与底表差异","item":d["line"],
                             "detail":f'TB {d["tb"]:,.2f} vs 报表 {d["fs"]:,.2f}',
                             "doc":doc})
    # 2) 底稿包勾稽差异
    pkg=load(f"{B}/{name}/底稿包/校验报告.json")
    if pkg:
        for l in pkg.get("lines",[]):
            if l["diff"] not in (0,None):
                doc=next((v for k,v in RULE if l["line"].startswith(k)), "相关支持性文件")
                gaps.append({"type":"底稿与报表差异","item":l["line"],
                             "detail":f'底稿 {l["calc"]:,.2f} vs 报表 {l["fs"]:,.2f}',
                             "doc":doc})
    # 3) 填写假设（按 sheet + 假设文本聚合，避免逐格刷屏）
    agg={}
    for f in ("1流动资产2025","2非流动资产2025","3流动负债&权益2025","5损益2025"):
        path=f"{B}/{name}/底稿包/{f}.xlsx.填写清单.csv"
        if not os.path.exists(path): continue
        with open(path, encoding="utf-8-sig") as fh:
            for row in csv.DictReader(fh):
                basis=row.get("basis","")
                if any(k in basis for k in ("暂", "未取得", "倒推")):
                    key=(row["sheet"], basis)
                    agg[key]=agg.get(key,0)+1
    for (sheet,basis),cnt in agg.items():
        doc=next((v for k,v in RULE if sheet.startswith(k[:2])), "相关支持性文件")
        gaps.append({"type":"填写假设","item":f"{sheet}（{cnt} 格）",
                     "detail":basis[:80],"doc":doc})
    # 合并：同一科目同时出现在「报表与底表差异」和「底稿与报表差异」时只留一条
    merged={}
    for g in gaps:
        key=(g["item"], g["detail"]) if g["type"]!="填写假设" else (g["item"], g["detail"])
        if g["type"]!="填写假设":
            key=(g["item"],)
        if key in merged:
            m=merged[key]
            if g["type"]=="底稿与报表差异":
                m["type"]="底稿/报表差异"; m["detail"]=g["detail"]
            continue
        merged[key]=dict(g)
    return list(merged.values())

names=["中天","中延","丸金","乐线","同进","明璞","安堡罗","舜壹","维曼","赞富","集瑞船务"]
summary=[]
for n in names:
    g=company_gaps(n)
    diff=sum(1 for x in g if x["type"]!="填写假设")
    asum=sum(1 for x in g if x["type"]=="填写假设")
    summary.append((n,diff,asum))
lines=["# 待取证清单（按公司，2026-11-23）","",
"汇总三类问题：报表与底表差异、底稿与报表差异、填写时用了假设的单元格。",
"「需补充资料」是按差异科目给出的取证建议，可据此发 PBC 清单。","",
"| 公司 | 数值差异 | 填写假设 |","|---|---:|---:|"]
for n,d,a in summary:
    if d or a: lines.append(f"| {n} | {d} | {a} |")
lines.append("")
for n in names:
    g=company_gaps(n)
    if not g: continue
    lines.append(f"## {n}（{len(g)} 项）\n")
    lines.append("| 类型 | 事项 | 差异/假设 | 需补充资料 |")
    lines.append("|---|---|---|---|")
    for x in g[:40]:
        det=x["detail"].replace("|","/")
        lines.append(f'| {x["type"]} | {x["item"]} | {det} | {x["doc"]} |')
    lines.append("")
open(f"{B}/待取证清单.md","w").write("\n".join(lines))
print("\n".join(lines[:20]))
print("... companies:", sum(1 for n in names if company_gaps(n)))
