"""把每家客户的 TB / 报表 / 凭证 / 勾稽 / 填写记录装进 data/audit.db。"""
import sys, os, csv, glob, json, warnings
warnings.filterwarnings("ignore"); sys.path.insert(0,".")
from auditfill.store import (connect, upsert_company, save_accounts, save_fs,
                             save_checks, save_fills, save_vouchers, summary)
from auditfill.tb import parse_tb
from auditfill.fs import load_book
from auditfill.vouchers import parse_vouchers
from auditfill.mapping_rules import apply_mapping_rules

B="/Users/macbook/Documents/审计底稿"
CASES={
 "中天":("中天/科目余额表_2026012011003528_100409中天亚东格式一.xlsx","中天/财务报告_中天亚东-202512（未审计稿2026.1.19）.xlsx","中天/凭证_2026012011043634_100409中天亚东.xlsx"),
 "中延":("中延/中延余额表.xls","中延/会计报表-中延-202512.xlsx","中延/中延-2025年度序时账.xls"),
 "丸金":("丸金/发生额及余额表1至12月人民币.xlsx","丸金/资产负债表12月.xls","丸金/填制凭证1-12月.xlsx"),
 "同进":("同进/科目余额表-同进-新.xls","同进/同进202512.xlsx",None),
 "明璞":("明璞/科目余额表2025.xls","明璞/202512资产负债表.xls",None),
 "舜壹":("舜壹/舜壹余额表.xls","舜壹/2025年12月报表（更新）.xlsx","舜壹/舜壹-2025年度序时账.xls"),
 "维曼":("维曼/维曼余额表2025.xlsx","维曼/2026.AR. NO.报表-维曼.xls","维曼/维曼（上海）医疗器械贸易有限公司-凭证数据 (2025).xlsx"),
 "乐线":("乐线/发生额及余额表2025.xlsx","乐线/2025年度报表新版（试用企业会计准则）.xls",None),
 "安堡罗":("安堡罗/科目余额表2025.xls","安堡罗/202512报表-报表以此为准.xlsx",None),
 "机施教育":("机施教育/科目余额表-以此为准.xlsx","机施教育/12月资产负债表.XLS","机施教育/序时账.XLS"),
 "统一能科":("统一能科/科目余额表2025-全币种.XLS","统一能科/月次決算資料（2025.12月分日本へ).xls",None),
 "赞富":("赞富/科目余额表.xls","赞富/25年12月报表赞富.xls","赞富/25年时序.xls"),
}

def classify(company, line):
    """差异归因：客户资料 / 列报 / 币种 / 口径 / 待查。"""
    d=line.get("diff")
    if d in (0,None): return ""
    if company=="赞富": return "币种（日元本位币）"
    if line.get("hint"): return "列报位置"
    item=line.get("line","")
    if company in ("舜壹","中延") and item in ("存货","营业成本"): return "工程施工口径"
    if company=="乐线": return "客户 TB 缺科目/口径"
    if company=="机施教育":
        if item=="应交税费": return "非营利口径（符号相反）"
        return "客户 TB 口径"
    if company=="统一能科": return "多币种尾差"
    if item in ("其他应收款","其他应付款") and line.get("calc"):
        rel=abs(d)/max(abs(line["calc"]),1)
        if rel<0.02: return "列报（总额/净额）"
    if company=="安堡罗": return "列报（TB 仅汇总层）"
    if company=="维曼":
        if item.startswith("营业收入"):
            return "列报（净额法）"
        if item in ("其他应收款","其他应付款","应收账款","预收款项"):
            return "列报（总额/净额）"
        return "客户凭证/口径"
    if company=="乐线" and item.startswith("营业收入"):
        return "列报位置"
    if item=="应交税费": return "客户 TB 总账≠子科目"
    return "待查"


def main():
    con=connect("data/audit.db")
    for name,(tbf,fsf,vf) in CASES.items():
        tb_path=os.path.join(B,tbf); fs_path=os.path.join(B,fsf)
        if not os.path.exists(tb_path):
            print(f"{name}: TB 缺失 {tbf}", flush=True); continue
        cid=upsert_company(con,name,"2025",tbf,fsf, vf or "")
        tb=parse_tb(tb_path); na=save_accounts(con,cid,tb.accounts)
        nf=0
        if os.path.exists(fs_path):
            nf=save_fs(con,cid,load_book(fs_path))
        rep=f"out/{name}/底稿包/校验报告.json"
        if os.path.exists(rep):
            r=json.load(open(rep))
            lines=r.get("lines",[])
            for l in lines:
                l["cause"]=classify(name, l)
            save_checks(con,cid,lines)
        for f in glob.glob(f"out/{name}/底稿包/*.填写清单.csv"):
            wb=os.path.basename(f).replace(".填写清单.csv","")
            with open(f,encoding="utf-8-sig") as fh:
                save_fills(con,cid,wb,list(csv.DictReader(fh)))
        nv=0
        if vf:
            vp=os.path.join(B,vf)
            if os.path.exists(vp):
                try:
                    nv=save_vouchers(con,cid,parse_vouchers(vp))
                except Exception as e:
                    print(f"{name}: 凭证失败 {e}", flush=True)
        print(json.dumps({"company":name,"accounts":na,"fs":nf,"vouchers":nv},ensure_ascii=False), flush=True)
    n_rules = apply_mapping_rules(con)
    print(f"mapping_rules 叠加层补齐 std：{n_rules} 个", flush=True)
    print("\n库内概况：")
    for r in summary(con):
        print(r)

if __name__=="__main__": main()
