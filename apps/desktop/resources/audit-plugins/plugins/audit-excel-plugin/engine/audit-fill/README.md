# audit-fill：客户资料 → 事务所底稿模板

把 `/Users/macbook/Documents/审计底稿/<客户>/` 里的科目余额表、财务报表、序时账，
填进 `/Users/macbook/Downloads/1116/AI审计软件测试手工底稿/` 的 5 个标准工作簿。

**核心原则：只写输入格、保留公式、每个数有依据、算不出来就不填。**

---

## 零、环境

- Python 3.9 + openpyxl / xlrd / pandas / formulas
- LibreOffice 25.8.7（`/Applications/LibreOffice.app`），用于 .xls → .xlsx 转换与公式重算：
  ```bash
  soffice --headless --convert-to xlsx --outdir <out> <file.xls>
  ```

## 一、数据库（按公司管理）

`data/audit.db`（SQLite，10 家公司约 3 MB）保存每家的科目余额表、报表行、凭证、勾稽结果与填写记录，
避免每次重跑都重新解析几十 MB 的 Excel。

```bash
python3 tools/load_db.py      # 解析并装入数据库
python3 tools/db_report.py    # 生成跨公司概览 out/数据库概览.md
sqlite3 data/audit.db "SELECT name FROM company;"
```

表：`company` / `account`（含 is_leaf）/ `fs_line` / `voucher` / `audit_check` / `fill` / `evidence`（待取证）。

`tools/db_report.py` 会同时输出：
- `out/数据库概览.md`（跨公司对比、未解决差异、常用 SQL）
- `out/校验报告_数据库版.md`（直接从库汇总，不重新解析 Excel）

## 一之三、给审计工作台调用

```bash
python3 -m auditfill.workbench --company 中天 --tb ... --fs ... --base-dir ... --out ...
python3 tools/workbench_server.py --port 8801     # HTTP 接口
```

详见 `docs/WORKBENCH-INTEGRATION.md`。

## 二、快速开始

```bash
cd ~/Documents/deepseek-harness/default-workspace/audit-fill

# 全部 10 家公司一次跑完（明细底稿 + 01 主底稿 + J + 打包 + 报告）
python3 tools/run_all.py

# 只跑一家
python3 tools/run_company.py 丸金

# 生成 01 主底稿（封面 + 资产表/负债表/利润表）
python3 -c "from auditfill.template import Template; from auditfill.fills.master import fill_master; from auditfill.fs import load_book; \
t=Template('templates/01_master.xlsx'); fill_master(t, load_book('/Users/macbook/Documents/审计底稿/丸金/资产负债表12月.xls'), '丸金'); t.save('out/丸金/01主底稿.xlsx')"

# 资产负债表全行勾稽（不经过模板，TB → 报表）
python3 tools/bs_tieout.py

# 损益类勾稽
python3 tools/batch_pl.py

# 模板填写覆盖率
python3 tools/coverage.py

# 待取证清单（可直接发 PBC）
python3 tools/evidence_gaps.py
```

产物都在 `out/`：

```
out/<客户>/底稿包/
  1流动资产2025.xlsx / 2非流动资产2025.xlsx / 3流动负债&权益2025.xlsx / 5损益2025.xlsx
  J_现金流量表.xlsx        # J-1 经营活动验算 + J-3 间接法补充资料
  *.填写清单.csv          # 每个单元格的值 + 依据（TB 科目/报表行/假设）
  校验报告.json
out/底稿包校验报告.md
out/资产负债表勾稽报告.md
out/损益勾稽报告.md
out/待取证清单.md
out/模板覆盖率.md
docs/FILL-LOGIC.md         # 全部口径与踩坑记录
```

---

## 二、已实现能力

| 环节 | 能力 |
|---|---|
| 文件识别 | 按魔数识别，20 个伪装成 .xls 的 HTML、5 个伪装成 .xls 的 xlsx 都能读 |
| 科目余额表 | 10 余种表头样式（用友/金蝶/SAP B1/繁体/无编码/HTML）自适应解析，合并单元格补全、多币种合并、辅助核算去重 |
| 财务报表 | 双栏/单栏/资产表负债表分表；期末余额、本年累计、本年金额、本月金额等表头 |
| 凭证/序时账 | 借/贷两列、方向+金额、用友单据头摊平三种形态 |
| 科目映射 | 名称优先 + 旧制度 3 位码兜底；子科目继承父科目；备抵科目推定 |
| 模板填写 | 20 余张审定表/明细表：货币资金、应收、预付、其他应收、存货、应付、预收、其他应付、应付职工薪酬、应交税费、固定资产、无形资产、实收资本、资本公积、盈余公积、未分配利润、收入成本、税金、三费、所得税、月度毛利率 |
| 验证 | 公式重算（`formulas`）+ 逐项与报表比对 + 资产负债表全行勾稽 + 损益勾稽 |
| 交付物 | 填写清单、勾稽报告、待取证清单、覆盖率报告 |

---

## 三、准确度现状（2026-11-23）

- **资产负债表层面完全一致**：中延、丸金、同进、明璞；
- **底稿包全项一致**：丸金（11 项）、明璞（7 项）；
- 其余差异均可归因到客户数据（缺备抵科目、缺应收科目、汇总层无明细、币种不一致、工程成本口径）。

处理过的 9 家公司、约 1,700 个填写格，所有数值都能追溯到 TB 科目或报表行。

---

## 四、已知限制

1. **01 主底稿**：已用 LibreOffice（清华镜像 25.8.7）转成 `templates/01_master.xlsx`，可填封面与三张报表；剩余 80 张程序表保持原样；
2. **现金流量表**：需要按现金流项目对凭证逐笔分类，尚未实现；
3. **需要客户证据的判断**：账龄、固定资产分类、减值、资本性质、持股比例、借款类别——缺资料时只写假设并进待取证清单；
4. 模板里约 47% 是程序表/测试表，本工具不填（需审计师判断）。

---

## 五、扩展一个新科目

1. 在 `auditfill/chart.py` 补别名（名称 → 标准科目 → 报表行）；
2. 看模板对应「审定表」是直填还是引用「明细表」；
3. 参照 `auditfill/fills/` 下同类模块写一个 `fill_x`，只写输入格；
4. 在 `tools/run_company.py` 注册，并在 `校验报告` 里加一条与报表的比对；
5. 跑一遍四家基准公司（中天/丸金/明璞/舜壹），差异必须能解释。

---

## 六、代码结构

```
auditfill/
  reader.py      # 魔数识别 + 统一网格（xlsx/xls/html）
  tb.py          # 科目余额表 → 标准账户模型（含重分类辅助）
  chart.py       # 客户科目名/编码 → 标准科目 → 报表行
  fs.py          # 财务报表解析（单表/分表/多期）
  vouchers.py    # 凭证解析 + 月度汇总 + 利润分配摘要归类
  template.py    # 模板读写（合并单元格安全写入、填写清单）
  recalc.py      # formulas 重算
  fills/         # 各科目填写逻辑
tools/           # 批量运行、勾稽、报告、覆盖率
docs/FILL-LOGIC.md
```
