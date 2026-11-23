import sys, warnings, json
warnings.filterwarnings("ignore"); sys.path.insert(0,".")
from auditfill.tb import parse_tb
from auditfill.fs import load_statements, check_balance
B="/Users/macbook/Documents/审计底稿"
rows=[
 ("中天","中天/科目余额表_2026012011003528_100409中天亚东格式一.xlsx","中天/财务报告_中天亚东-202512（未审计稿2026.1.19）.xlsx"),
 ("中延","中延/中延余额表.xls","中延/会计报表-中延-202512.xlsx"),
 ("丸金","丸金/发生额及余额表1至12月人民币.xlsx","丸金/资产负债表12月.xls"),
 ("乐线","乐线/发生额及余额表2025.xlsx","乐线/2025年度报表新版（试用企业会计准则）.xls"),
 ("同进","同进/科目余额表-同进-新.xls","同进/同进202512.xlsx"),
 ("明璞","明璞/科目余额表2025.xls","明璞/202512资产负债表.xls"),
 ("安堡罗","安堡罗/科目余额表2025.xls","安堡罗/202512报表-报表以此为准.xlsx"),
 ("机施教育","机施教育/科目余额表-以此为准.xlsx","机施教育/12月资产负债表.XLS"),
 ("统一能科","统一能科/科目余额表2025-人民币.XLS",None),
 ("维曼","维曼/维曼余额表2025.xlsx","维曼/2026.AR. NO.报表-维曼.xls"),
 ("舜壹","舜壹/舜壹余额表.xls","舜壹/2025年12月报表（更新）.xlsx"),
 ("虹盛","虹盛/上海虹盛商务咨询有限公司科目汇总表[2025年1期-2025年12期]20260115161527.xls","虹盛/2026.AR.NO.032虹盛.xlsx"),
 ("赞富","赞富/科目余额表.xls","赞富/25年12月报表赞富.xls"),
 ("集瑞船务","集瑞船务/科目余额表2025.xlsx","集瑞船务/2025年12月资产负债表、利润表.pdf"),
]
print("| 公司 | TB科目数 | 行级勾稽 | 货币资金(TB) | 货币资金(报表) | 差异 | 报表平衡 |")
print("|---|---:|---|---:|---:|---:|---|")
for name,tbf,fsf in rows:
    try:
        tb=parse_tb(f"{B}/{tbf}"); c=tb.check()
        cash=sum(tb.end_std(x) for x in ("1001","1002","1012"))
        fs_cash=None; bal=""
        if fsf and not fsf.endswith(".pdf"):
            sts=[s for s in load_statements(f"{B}/{fsf}") if s.kind=="bs"]
            if sts:
                cand=[s for s in sts if s.get("货币资金")] or sts
                r=cand[0].get("货币资金"); fs_cash=r["end"] if r else None
                cb=check_balance(sts[0]); bal=f"{cb['diff']}"
        diff = "" if (fs_cash is None or cash==0) else f"{cash-fs_cash:,.2f}"
        print(f"| {name} | {c['accounts']} | {c['row_error_count']} | {cash:,.2f} | {'' if fs_cash is None else f'{fs_cash:,.2f}'} | {diff} | {bal} |")
    except Exception as e:
        print(f"| {name} | - | - | - | - | - | 解析失败: {type(e).__name__} |")
