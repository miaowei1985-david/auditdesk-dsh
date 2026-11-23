"""回归自检：用真实客户文件锁定关键解析结果，防止改逻辑后悄悄跑偏。"""
import sys, warnings
warnings.filterwarnings("ignore"); sys.path.insert(0,".")
from auditfill.tb import parse_tb
from auditfill.fs import load_book

B="/Users/macbook/Documents/审计底稿"
CASES=[
 # 名称, TB, 检查[(std, 期望值, 说明)]
 ("中天","中天/科目余额表_2026012011003528_100409中天亚东格式一.xlsx",
  [("1002",8402.15,"多币种科目取本位币"),("1122",6260033.64,"应收")]),
 ("丸金","丸金/发生额及余额表1至12月人民币.xlsx",
  [("1122",1408429.17,"应收"),("1002",1081349.52,"银行存款")]),
 ("机施教育","机施教育/科目余额表-以此为准.xlsx",
  [("2221",-116443.42,"方向列不二次取负"),("2241",-24088.46,"其他应付贷方")]),
 ("赞富","赞富/科目余额表.xls",
  [("1002",150586.36,"综合本位币续行"),("1405",5128664.54,"库存商品")]),
 ("乐线","乐线/发生额及余额表2025.xlsx",
  [("1122",18893077.66,"英文科目别名"),("1221",15164996.78,"长期借款/押金归其他应收")]),
 ("统一能科","统一能科/科目余额表2025-全币种.XLS",
  [("1002",102996818.10,"全币种表"),("1122",11568701.44,"应收")]),
 ("舜壹","舜壹/舜壹余额表.xls",
  [("5401",29773.60,"工程施工归合同履约成本"),("1403",0.0,"工程用材料不再算存货")]),
 ("明璞","明璞/科目余额表2025.xls",
  [("1601",269117.39,"固定资产原值")]),
 ("安堡罗","安堡罗/科目余额表2025.xls",
  [("1122",1571192.0,"汇总层应收")]),
 ("同进","同进/科目余额表-同进-新.xls",
  [("1501",738001737.0,"长期投资归长期股权投资")]),
]

ok=fail=0
for name, tbf, checks in CASES:
    try:
        tb=parse_tb(f"{B}/{tbf}")
    except Exception as e:
        print(f"[FAIL] {name}: 解析失败 {type(e).__name__}: {e}"); fail+=len(checks); continue
    for std, expect, note in checks:
        got=round(tb.end_std(std),2)
        good=abs(got-expect)<0.02
        ok+=good; fail+=not good
        print(("[ OK ]" if good else "[FAIL]"), f"{name} {std} 期望 {expect:,.2f} 实际 {got:,.2f}（{note}）")
print(f"\n自检：通过 {ok}，失败 {fail}")
sys.exit(0 if fail==0 else 1)
