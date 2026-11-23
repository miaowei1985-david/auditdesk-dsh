"""资产负债表全行勾稽：TB → 报表（不经过模板），检验科目映射的完整度。"""
import sys, json, warnings
warnings.filterwarnings("ignore"); sys.path.insert(0,".")
from auditfill.tb import parse_tb
from auditfill.fs import load_book

B="/Users/macbook/Documents/审计底稿"
ASSET=[("货币资金",["1001","1002","1012"]),("应收票据",["1121"]),("应收账款",["1122","1231"]),
 ("预付款项",["1123"]),("其他应收款",["1221"]),("存货",["1401","1402","1403","1404","1405","1406","1408","1411","1471","5001"]),
 ("其他流动资产",["1901"]),("长期股权投资",["1501"]),("固定资产",["1601","1602","1603"]),
 ("在建工程",["1604"]),("使用权资产",["1605"]),("无形资产",["1701","1702"]),
 ("长期待摊费用",["1801"]),("递延所得税资产",["1811"]),
 ("合同履约成本",["5401"]),("债权投资",["1503"])]
LIAB=[("短期借款",["2001"]),("应付票据",["2201"]),("应付账款",["2202"]),("预收款项",["2203"]),
 ("应付职工薪酬",["2211"]),("应交税费",["2221"]),("应付股利",["2231"]),("其他应付款",["2241"]),
 ("长期借款",["2501"]),("租赁负债",["2601"]),("长期应付款",["2701"])]
EQ=[("实收资本",["4001"]),("资本公积",["4002"]),("盈余公积",["4101"]),("未分配利润",["4103","4104"])]
CASES=[("中天","中天/科目余额表_2026012011003528_100409中天亚东格式一.xlsx","中天/财务报告_中天亚东-202512（未审计稿2026.1.19）.xlsx"),
("中延","中延/中延余额表.xls","中延/会计报表-中延-202512.xlsx"),
("丸金","丸金/发生额及余额表1至12月人民币.xlsx","丸金/资产负债表12月.xls"),
("乐线","乐线/发生额及余额表2025.xlsx","乐线/2025年度报表新版（试用企业会计准则）.xls"),
("同进","同进/科目余额表-同进-新.xls","同进/同进202512.xlsx"),
("明璞","明璞/科目余额表2025.xls","明璞/202512资产负债表.xls"),
("安堡罗","安堡罗/科目余额表2025.xls","安堡罗/202512报表-报表以此为准.xlsx"),
("舜壹","舜壹/舜壹余额表.xls","舜壹/2025年12月报表（更新）.xlsx"),
("维曼","维曼/维曼余额表2025.xlsx","维曼/2026.AR. NO.报表-维曼.xls"),
("赞富","赞富/科目余额表.xls","赞富/25年12月报表赞富.xls"),
("集瑞船务","集瑞船务/科目余额表2025.xlsx",None)]
ALIAS={"实收资本":("实收资本(或股本)","实收资本（或股本）","实收资本","股本"),
 "未分配利润":("未分配利润",),"存货":("存货",),"固定资产":("固定资产净额","固定资产净值","固定资产账面价值","固定资产")}
out=[]
for name,tbf,fsf in CASES:
    row={"company":name,"missing":[],"diffs":[],"tb_total":{},"fs_total":{}}
    try:
        tb=parse_tb(f"{B}/{tbf}")
        fs=None
        if fsf:
            fs=load_book(f"{B}/{fsf}")
        def leaves_of(std):
            pool=[a for a in tb.accounts if a.std==std]
            return [a for a in pool if not any(b is not a and b.key.startswith(a.key) for b in pool)] or pool

        def side(asset_std, liab_std):
            """按余额方向重分类后的资产侧/负债侧金额。"""
            a = sum(x.end for x in leaves_of(asset_std) if x.end > 0)
            a += sum(x.end for x in leaves_of(liab_std) if x.end > 0)
            l = sum(-x.end for x in leaves_of(liab_std) if x.end < 0)
            l += sum(-x.end for x in leaves_of(asset_std) if x.end < 0)
            return a, l

        settle = min(0.0, tb.end_std("5402"))  # 工程结算贷方=预收（用根科目避免父子重复）
        reclass = {"应收账款": side("1122","2203")[0], "预收款项": side("1122","2203")[1] - settle,
                   "应付账款": side("1123","2202")[1], "预付款项": side("1123","2202")[0],
                   "其他应收款": side("1221","2241")[0], "其他应付款": side("1221","2241")[1]}
        # 列报口径：客户可能重分类，也可能不重分类。两种都算，取与报表一致的那种。
        net = {"应收账款": tb.end_std("1122"), "预收款项": -tb.end_std("2203") - settle,
               "应付账款": -tb.end_std("2202"), "预付款项": tb.end_std("1123"),
               "其他应收款": tb.end_std("1221"), "其他应付款": -tb.end_std("2241")}
        if fs is not None:
            for label in list(reclass):
                r=fs.get(*ALIAS.get(label,(label,)))
                fv=r["end"] if r else None
                if fv is None: continue
                if abs(net[label]-fv) < abs(reclass[label]-fv):
                    reclass[label]=net[label]

        def total(group,sign):
            s=0; miss=[]
            for label,stds in group:
                v = reclass.get(label)
                if v is None:
                    v = sign*sum(tb.end_std(x) for x in stds)
                s+=v
                if fs is not None:
                    r=fs.get(*ALIAS.get(label,(label,)))
                    fv=r["end"] if r else None
                    if fv is not None and abs(v-fv)>0.01:
                        row["diffs"].append({"line":label,"tb":round(v,2),"fs":round(fv,2),"diff":round(v-fv,2)})
                    if v is None: v = sign*sum(tb.end_std(x) for x in stds)
                if v==0 and fv not in (None,0):
                        row["missing"].append({"line":label,"fs":fv})
            return s
        row["tb_total"]={"assets":round(total(ASSET,1),2),"liab":round(total(LIAB,-1),2),"equity":round(total(EQ,-1),2)}
        if fs:
            row["fs_total"]={"assets":fs.total("资产总计","资产合计"),"liab":fs.total("负债合计"),
                             "equity":fs.total("所有者权益合计","股东权益合计","所有者权益（或股东权益）合计")}
    except Exception as e:
        row["error"]=f"{type(e).__name__}: {e}"
    out.append(row); print(json.dumps({k:row[k] for k in ("company","tb_total","fs_total")},ensure_ascii=False), flush=True)
json.dump(out,open("out/资产负债表勾稽.json","w"),ensure_ascii=False,indent=1)
