# 审计工作台接入说明

本项目的「Excel 处理能力」有三种调用方式，工作台任选一种。

## 1. Python 库（推荐，零进程开销）

```python
from auditfill.workbench import process_company

res = process_company(
    company="中天",
    tb="中天/科目余额表.xlsx",          # 相对 base_dir
    fs="中天/财务报告.xlsx",
    voucher="中天/凭证.xlsx",           # 可空
    base_dir="/Users/macbook/Documents/审计底稿",
    out_dir="out/中天/底稿包",
)
print(res["ok"], res["lines"])       # 逐项勾稽结果
```

返回结构：

```json
{"ok": true, "company": "...", "workbooks": [...], "lines": [...], "cashflow": {...},
 "outputs": {"package_dir": "...", "master": "..."}}
```

失败时返回 `{"ok": false, "error": "..."}`。

## 2. 命令行（进程隔离，工作台用 HTTP/调度器调它）

```bash
python -m auditfill.workbench \
  --company 中天 \
  --tb "中天/科目余额表_….xlsx" \
  --fs "中天/财务报告_….xlsx" \
  --voucher "中天/凭证_….xlsx" \
  --base-dir "/Users/macbook/Documents/审计底稿" \
  --out "out/中天/底稿包"
```

stdout 输出一行 JSON，退出码 0 成功、1 失败。

## 2.5 HTTP 服务（标准库，零依赖）

```bash
python3 tools/workbench_server.py --port 8801
```

| 接口 | 说明 |
|---|---|
| `GET /health` | 健康检查 |
| `GET /companies` | 已登记公司 |
| `POST /process` | `{"company","tb","fs","voucher","base_dir","out"}` → 结果 JSON |

示例：

```bash
curl -X POST http://127.0.0.1:8801/process -H 'Content-Type: application/json' \
  -d '{"company":"中天","tb":"中天/科目余额表.xlsx","fs":"中天/财务报告.xlsx",
       "base_dir":"/Users/macbook/Documents/审计底稿","out":"out/中天/底稿包"}'
```

返回与库调用一致：`ok / workbooks / lines / cashflow / outputs`。
服务只监听 127.0.0.1，不暴露公网。

## 3. 批量 + 台账

```bash
python3 tools/run_all.py          # 12 家全跑
python3 tools/load_db.py          # 入库
python3 tools/export_workbench.py # 导出 CSV/JSON/DB
python3 tools/export_workbench_excel.py  # 导出 Excel 台账
```

工作台读 `out/工作台导出/审计底稿台账.xlsx`（公司汇总/勾稽明细/待取证/文件清单）
或 `out/工作台导出/manifest.json` 即可拿到全部公司索引。

## 4. 输入要求

| 输入 | 必需 | 格式 |
|---|---|---|
| 科目余额表 | 是 | xlsx/xls/HTML 伪装均可；需有科目代码/名称/期初/发生/期末 |
| 财务报表 | 是 | xlsx/xls；资产负债表、利润表（可选现金流量表） |
| 凭证/序时账 | 否 | 有则做账龄 FIFO、账证核对、现金流量表 |

特殊格式（流水式科目汇总表、PDF 报表、多币种续行）会自动降级或标记未识别，
不会静默填错。

## 5. 输出结构

```
<out_dir>/                 # 4 本明细底稿 + 填写清单
<out_dir>/../01主底稿.xlsx  # 封面 + 三张报表
<out_dir>/../J_现金流量表.xlsx
```

模板取自 `templates/`（由所里模板转换而来，表名/单元格位置不变）。

## 6. 错误处理约定

- 单个科目填不了：不中断，写 warning（如「TB 无该科目余额」）；
- 整家失败：返回 `ok=false` 与异常类型，工作台可重试或转人工；
- 所有写入都有 basis，落 `*.填写清单.csv`，可审计追溯。

## 7. 作为 DSH（DeepSeek Harness）工具集成

已安装 Host 插件 `@local/audit-excel`（bundle 源码：`../audit-excel-plugin`），在当前 Profile 提供三个工具：

| 工具 | 作用 |
|---|---|
| `audit_fill_process` | 处理一家客户：生成四本明细底稿 + 01 主底稿 + 现金流量表，返回逐项勾稽 |
| `audit_fill_companies` | 列出已配置的 12 家客户及资料 |
| `audit_fill_ledger` | 刷新数据库并导出 Excel 台账 |
| `audit_workflow` | 按审计流程给出每家所处阶段与下一步 |
| `audit_memo` | 生成审计备忘录（结论：可否出具） |
| `audit_status` | 查看 12 家的勾稽状态与待取证数量 |
| `audit_fill_batch` | 批量重跑（省略客户即全部 12 家），跑完自动刷新库与台账 |

在 DSH 里直接说「帮我填中天的底稿」即可调用，无需命令行。
插件入口：`include:audit-excel`；关闭/启用用插件管理器（Plugins）。

实现要点：DSH Host 插件的工具返回值必须是**无损 JSON**，
非有限数（NaN/Infinity）和 -0 会被拒收，插件里统一清洗为有限数或 null。
