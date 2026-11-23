import sys, warnings
warnings.filterwarnings("ignore"); sys.path.insert(0,".")
from auditfill.tb import parse_tb
from auditfill.vouchers import parse_vouchers
from auditfill.cashflow import classify, cash_change
B="/Users/macbook/Documents/审计底稿"
CASES=[("中天","中天/科目余额表_2026012011003528_100409中天亚东格式一.xlsx","中天/凭证_2026012011043634_100409中天亚东.xlsx"),
("中延","中延/中延余额表.xls","中延/中延-2025年度序时账.xls"),
("丸金","丸金/发生额及余额表1至12月人民币.xlsx","丸金/填制凭证1-12月.xlsx"),
("舜壹","舜壹/舜壹余额表.xls","舜壹/舜壹-2025年度序时账.xls"),
("赞富","赞富/科目余额表.xls","赞富/25年时序.xls"),
("维曼","维曼/维曼余额表2025.xlsx","维曼/维曼（上海）医疗器械贸易有限公司-凭证数据 (2025).xlsx"),
("统一能科","统一能科/科目余额表2025-人民币.XLS","统一能科/序时账2025.XLS"),
("集瑞船务","集瑞船务/科目余额表2025.xlsx","集瑞船务/序时账2025-有特殊注明不计提使用权资产.xlsx")]
lines=["# 现金流量表（直接法）原型（2026-11-23）","",
"按凭证逐张把现金收付归类为经营/投资/筹资，并用「三类合计 = 现金净变动」自校验。","",
"| 公司 | 经营活动 | 投资活动 | 筹资活动 | 合计 | 现金净变动 | 差异 |","|---|---:|---:|---:|---:|---:|---:|"]
ok=0; bad=0
for n,tbf,vf in CASES:
    try:
        tb=parse_tb(f"{B}/{tbf}"); es=parse_vouchers(f"{B}/{vf}")
        cf=classify(es,tb); ch=cash_change(tb); d=round(cf["net"]-ch,2)
        if abs(d)<0.01: ok+=1
        else: bad+=1
        lines.append(f"| {n} | {cf['operating']:,.2f} | {cf['investing']:,.2f} | {cf['financing']:,.2f} | {cf['net']:,.2f} | {ch:,.2f} | {d:,.2f} |")
    except Exception as e:
        lines.append(f"| {n} | - | - | - | - | - | 解析失败：{type(e).__name__} |")
lines+=["", f"自校验：{ok} 家完全一致，{bad} 家不一致。","",
"## 方法","",
"1. 现金科目 = 1001 库存现金 / 1002 银行存款 / 1012 其他货币资金；",
"2. 按顺序把凭证行分组（用友导出里后续行可能不带凭证号，归到上一张）；",
"3. 每张凭证的净现金变动 = Σ现金借方 − Σ现金贷方；",
"4. 按凭证内非现金科目归类：长期资产→投资，借款/权益→筹资，其余→经营；",
"5. 三类合计必须等于现金净变动，不等就是分类或数据有问题。","",
"## 已知局限","",
"- 按**整张凭证**归类，一张凭证同时含投资和经营项目时会被整笔归入投资（粗分类，可接受但不精确）；",
"- 现金等价物只含 1001/1002/1012，不含定期存款/理财；",
"- 模板 `J---现金流量表底稿目录-.xls` 是 .xls，暂无法写入；本表是分析结果，待转换成 xlsx 后可回填。"]
open("out/现金流量表原型.md","w").write("\n".join(lines))
print("\n".join(lines))
