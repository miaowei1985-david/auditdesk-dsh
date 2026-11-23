"""生成一家公司的完整底稿包：1流动资产 / 2非流动资产 / 3流动负债 / 5损益。"""
import os, sys, json, argparse, warnings
warnings.filterwarnings("ignore"); sys.path.insert(0,".")
from auditfill.tb import parse_tb
from auditfill.template import Template
from auditfill.fills.money import fill_money
from auditfill.fills.counterparty import fill_counterparty, SUBJECTS
from auditfill.fills.inventory import fill_inventory
from auditfill.fills.fixed_assets import fill_fixed_assets
from auditfill.fills.tax import fill_tax
from auditfill.fills.equity import fill_paid_in, fill_reserve
from auditfill.fills.retained import fill_retained
from auditfill.fills.details import (fill_payroll, fill_intangible, fill_dividend,
                                     fill_lti, fill_short_loan)
from auditfill.fills.pl import (fill_revenue_cost, fill_tax_surcharge, fill_expenses,
                                fill_income_tax, revenue_total, cost_total, fill_nonop)
from auditfill.fills.monthly import fill_monthly
from auditfill.fills.cashflow_direct import fill_j1, fill_j2
from auditfill.fills.cashflow_supp import fill_cashflow_supp
from auditfill.cashflow import classify
from auditfill.aging import aging_by_account
from auditfill.fills.master import fill_master
from auditfill.vouchers import parse_vouchers
from auditfill.fs import load_book

B = os.environ.get("DSH_AUDIT_BASE") or os.path.expanduser("~/Documents/审计底稿")
_ENGINE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = os.environ.get("DSH_AUDIT_TEMPLATES") or os.path.join(_ENGINE_ROOT, "templates")
CASES={
 "中天":("中天/科目余额表_2026012011003528_100409中天亚东格式一.xlsx","中天/财务报告_中天亚东-202512（未审计稿2026.1.19）.xlsx","中天/凭证_2026012011043634_100409中天亚东.xlsx","中天亚东"),
 "中延":("中延/中延余额表.xls","中延/会计报表-中延-202512.xlsx","中延/中延-2025年度序时账.xls","中延建设"),
 "丸金":("丸金/发生额及余额表1至12月人民币.xlsx","丸金/资产负债表12月.xls","丸金/填制凭证1-12月.xlsx","丸金商贸"),
 "明璞":("明璞/科目余额表2025.xls","明璞/202512资产负债表.xls",None,"明璞资产"),
 "舜壹":("舜壹/舜壹余额表.xls","舜壹/2025年12月报表（更新）.xlsx","舜壹/舜壹-2025年度序时账.xls","舜壹"),
 "同进":("同进/科目余额表-同进-新.xls","同进/同进202512.xlsx",None,"同进置业"),
 "维曼":("维曼/维曼余额表2025.xlsx","维曼/2026.AR. NO.报表-维曼.xls",None,"维曼医疗"),
 "乐线":("乐线/发生额及余额表2025.xlsx","乐线/2025年度报表新版（试用企业会计准则）.xls",None,"乐线"),
 "安堡罗":("安堡罗/科目余额表2025.xls","安堡罗/202512报表-报表以此为准.xlsx",None,"安堡罗"),
 "机施教育":("机施教育/科目余额表-以此为准.xlsx","机施教育/12月资产负债表.XLS","机施教育/序时账.XLS","机施教育"),
 "统一能科":("统一能科/科目余额表2025-全币种.XLS","统一能科/月次決算資料（2025.12月分日本へ).xls",None,"统一能科"),
 "赞富":("赞富/科目余额表.xls","赞富/25年12月报表赞富.xls","赞富/25年时序.xls","赞富"),
}

def run(name, out_dir=None):
    tbf, fsf, vf, client = CASES[name]
    tb=parse_tb(os.path.join(B, tbf))
    fs=load_book(os.path.join(B, fsf))
    fs_is=fs
    out = out_dir or f"out/{name}/底稿包"
    report={"company":name,"workbooks":[],"lines":[]}

    def touch(tpl_path, fname, fillers):
        tpl=Template(f"{T}/{tpl_path}")
        tpl.prefill_directory(client,"2025年度",preparer="AI",date="2026-11-23")
        plans=[]
        for fn in fillers:
            plans.append(fn(tpl))
        tpl.dump_report(f"{out}/{fname}.填写清单.csv")
        tpl.save(f"{out}/{fname}")
        report["workbooks"].append({"file":fname,"writes":len(tpl.writes),
                                    "plans":[p for p in plans if p]})
        return tpl, plans

    entries=None
    if vf:
        entries=parse_vouchers(os.path.join(B, vf))
    aging_ar = aging_by_account(tb, entries, "1122") if entries else None
    aging_or = aging_by_account(tb, entries, "1221") if entries else None
    aging_ap = aging_by_account(tb, entries, "2202", liability=True) if entries else None
    aging_adv = aging_by_account(tb, entries, "2203", liability=True) if entries else None
    aging_oap = aging_by_account(tb, entries, "2241", liability=True) if entries else None
    AGING = {"应收账款": aging_ar, "其他应收款": aging_or, "应付账款": aging_ap,
             "预收款项": aging_adv, "其他应付款": aging_oap}

    # 往来负数：客户若报表里有预收/预付，就重分类；否则留在本科目按净额列示
    pre_adv = fs.get("预收款项", "预收账款")
    keep_negs = not (pre_adv and abs(pre_adv.get("end") or 0) > 0.01)

    # 其他应收/应付：报表若按净额列示（FS 其他应付≈TB 2241 净额），负数不重分类
    oa = fs.get("其他应付款")
    tb_2241 = abs(tb.end_std("2241"))
    keep_negs_oa = bool(oa and tb_2241 and abs(abs(oa.get("end") or 0) - tb_2241) < max(1.0, tb_2241*0.01))

    # 应付/预付：报表按净额列示（FS 应付≈TB 2202 净额）时，预付贷方不重分类
    ap = fs.get("应付账款", "应付帐款")
    tb_2202 = abs(tb.end_std("2202"))
    keep_negs_ap = bool(ap and tb_2202 and abs(abs(ap.get("end") or 0) - tb_2202) < max(1.0, tb_2202*0.01))

    def cp(t, subj):
        extra = None
        if subj.name == "其他应收款" and keep_negs_oa:
            pre = fs.get("预付款项", "预付账款")
            ar = fs.get("其他应收款")
            tb_pre = tb.end_std("1123")
            if (not pre or abs(pre.get("end") or 0) < 0.01) and ar and abs(tb_pre) > 0.01 \
                    and abs((ar.get("end") or 0) - tb_pre) < max(1.0, abs(tb_pre)*0.02):
                extra = [("预付款项（按报表并入其他应收）", tb.begin_std("1123"), tb_pre)]
        if subj.name == "预收款项":
            settle = tb.end_std("5402")   # 工程结算，贷方余额
            if settle < -0.01:
                extra = [("工程结算（合同结算）", -tb.begin_std("5402"), -settle)]
        if subj.name in ("应收账款", "预收款项"):
            kn = keep_negs
        elif subj.name in ("其他应收款", "其他应付款"):
            kn = keep_negs_oa
        elif subj.name in ("应付账款", "预付款项"):
            kn = keep_negs_ap
        else:
            kn = False
        return fill_counterparty(t, tb, subj, aging=AGING.get(subj.name), extra=extra, keep_negatives=kn)

    # 1流动资产
    t1,p1=touch("1流动资产2025.xlsx","1流动资产2025.xlsx",[
        lambda t: fill_money(t,tb),
        *[ (lambda s: (lambda t: cp(t,s)))(s) for s in SUBJECTS if s.sign>0],
        lambda t: fill_inventory(t,tb),
    ])
    # 2非流动资产
    fa_net = None
    r = fs.get("固定资产净额", "固定资产净值", "固定资产账面价值", "固定资产")
    if r: fa_net = r.get("end")
    ia_net = None
    r = fs.get("无形资产净额", "无形资产净值", "无形资产")
    if r: ia_net = r.get("end")
    t2,p2=touch("2非流动资产2025.xlsx","2非流动资产2025.xlsx",[
        lambda t: fill_fixed_assets(t,tb,fs_net=fa_net),
        lambda t: fill_intangible(t,tb,fs_net=ia_net),
        lambda t: fill_lti(t,tb),
    ])
    # 3流动负债&权益
    t3,p3=touch("3流动负债&权益2025.xlsx","3流动负债&权益2025.xlsx",[
        lambda t: fill_tax(t,tb),
        *[ (lambda s: (lambda t: cp(t,s)))(s) for s in SUBJECTS if s.sign<0],
        lambda t: fill_paid_in(t,tb),
        lambda t: fill_reserve(t,tb,std="4101",sheet="盈余公积明细表"),
        lambda t: fill_reserve(t,tb,std="4002",sheet="资本公积明细表"),
        lambda t: fill_retained(t,tb,entries=(entries if vf else None)),
        lambda t: fill_payroll(t,tb),
        lambda t: fill_dividend(t,tb),
        lambda t: fill_short_loan(t,tb),
    ])
    # 5损益
    fillers=[lambda t: fill_revenue_cost(t,tb), lambda t: fill_tax_surcharge(t,tb),
             lambda t: fill_expenses(t,tb,sheet="管理费用审定表",std="6602"),
             lambda t: fill_expenses(t,tb,sheet="销售费用审定表",std="6601"),
             lambda t: fill_expenses(t,tb,sheet="财务费用审定表",std="6603"),
             lambda t: fill_income_tax(t,tb),
             lambda t: fill_nonop(t,tb,sheet="营业外收入审定表",std="6301",revenue=True),
             lambda t: fill_nonop(t,tb,sheet="营业外支出审定表",std="6711",revenue=False),
             lambda t: fill_nonop(t,tb,sheet="投资收益审定表",std="6111",revenue=True)]
    if entries:
        fillers.append(lambda t: fill_monthly(t,entries))
    # 现金流量表（J 工作簿）
    try:
        jt=Template("templates/J_cashflow.xlsx")
        fill_j1(jt,tb)
        fill_j2(jt,tb)
        net=sum(revenue_total(tb,x) for x in ("6001","6051","6301","6111"))-sum(
            cost_total(tb,x) for x in ("6401","6402","6403","6601","6602","6603","6711","6801"))
        direct=classify(entries,tb)["operating"] if entries else None
        cp=fill_cashflow_supp(jt,tb,client,pl_net=net,direct_operating=direct)
        jt.dump_report(f"{out}/J_现金流量表.填写清单.csv"); jt.save(f"{out}/J_现金流量表.xlsx")
        report["cashflow"]=cp
    except Exception as e:
        report["cashflow_error"]=f"{type(e).__name__}: {e}"
    # 01 主底稿
    try:
        mt=Template("templates/01_master.xlsx")
        fill_master(mt, fs, client)
        import os as _os
        _os.makedirs(_os.path.dirname(out) or ".", exist_ok=True)
        mt.save(_os.path.join(_os.path.dirname(out) or ".", "01主底稿.xlsx"))
    except Exception as e:
        report["master_error"]=f"{type(e).__name__}: {e}"
    t5,p5=touch("5损益2025.xlsx","5损益2025.xlsx",fillers)

    # 关键数值校验（用填进去的明细合计 vs 报表）
    def add(line, calc, fsrow, alias=None):
        fv=None
        if fsrow is not None:
            r=fsrow.get(*(alias or (line,))) if fsrow is not None else None
            fv=r["end"] if r else None
        diff=None if (calc is None or fv is None) else round(calc-fv,2)
        if diff is not None and abs(diff) < 0.02:
            diff = 0.0  # 分位舍入不算差异
        hint=""
        if diff not in (0,None) and fsrow is not None:
            # 差额可能只是列报位置不同（如房地产经营收入列在「其他业务利润」）
            for st in fsrow.all:
                for k,v in st.rows.items():
                    if v.get("end") is not None and abs(v["end"]-calc) < 0.01:
                        hint=f"列报为「{k}」"
                        break
                if hint: break
        report["lines"].append({"line":line,"calc":None if calc is None else round(calc,2),
                                "fs":fv,"diff":diff,"hint":hint})
    money=p1[0]; add("货币资金", sum(s["end"] for s in money.get("sections",[])), fs)
    for s in SUBJECTS:
        p=next((x for x in p1+p3 if x.get("subject")==s.name), None)
        if p and p.get("units"): add(s.fs_line, p.get("end"), fs)
    inv=p1[-1];
    if inv.get("ok"): add("存货", inv.get("calc"), fs)
    fa=p2[0]
    if fa.get("ok"): add("固定资产", fa.get("tb_net"), fs, ("固定资产净额","固定资产净值","固定资产账面价值","固定资产"))
    ita=p2[1] if len(p2)>1 else {}
    if ita.get("ok"):
        ia_calc = p2[1].get("tb_cost",0) - p2[1].get("tb_amort",0)
        add("无形资产", ia_calc, fs, ("无形资产净额","无形资产净值","无形资产"))
    add("实收资本", -tb.end_std("4001"), fs, ("实收资本(或股本)","实收资本（或股本）","实收资本","股本"))
    add("盈余公积", -tb.end_std("4101"), fs, ("盈余公积",))
    add("应付股利", -tb.end_std("2231"), fs, ("应付股利", "应付利润"))
    add("未分配利润", -((tb.end_std("4104") + tb.end_std("4103"))), fs, ("未分配利润",))
    if abs(tb.end_std("1501")) > 0.005:
        add("长期股权投资", tb.end_std("1501"), fs, ("长期股权投资",))
    if abs(tb.end_std("2001")) > 0.005:
        add("短期借款", -tb.end_std("2001"), fs, ("短期借款",))
    if abs(tb.end_std("2211")) > 0.005:
        add("应付职工薪酬", -tb.end_std("2211"), fs, ("应付职工薪酬",))
    tax=p3[0]
    if tax.get("tb"): add("应交税费", -tax["tb"]["end"], fs, ("应交税费", "未交税金", "应交税金"))
    if abs(revenue_total(tb,"6301")) > 0.005:
        add("营业外收入", revenue_total(tb,"6301"), fs_is, ("营业外收入",))
    if abs(revenue_total(tb,"6111")) > 0.005:
        add("投资收益", revenue_total(tb,"6111"), fs_is, ("投资收益",))
    if abs(cost_total(tb,"6711")) > 0.005:
        add("营业外支出", cost_total(tb,"6711"), fs_is, ("营业外支出",))
    if fs_is:
        add("营业收入", next((x for x in (p5[0] or {}).items() if x[0]=="rev"), (None,0))[1], fs_is,
            ("营业收入","营业总收入","主营业务收入","房地产经营收入"))
    json.dump(report, open(f"{out}/校验报告.json","w"), ensure_ascii=False, indent=1)
    ok=[l for l in report["lines"] if l["diff"]==0]
    bad=[l for l in report["lines"] if l["diff"] not in (0,None)]
    print(f"{name}: 底稿 {len(report['workbooks'])} 个，勾稽 {len(ok)} 项一致 / {len(bad)} 项差异")
    for l in report["lines"]:
        print(f"   {l['line']:8} calc={l['calc']} fs={l['fs']} diff={l['diff']}")
    return report

if __name__=="__main__":
    ap=argparse.ArgumentParser(); ap.add_argument("company"); a=ap.parse_args()
    run(a.company)
