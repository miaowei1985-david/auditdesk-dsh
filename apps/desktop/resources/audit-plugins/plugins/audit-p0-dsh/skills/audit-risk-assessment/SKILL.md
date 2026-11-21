---
name: audit-risk-assessment
description: 按中国审计准则第 1211 号执行风险评估：用 audit_tb / audit_materiality / audit_sample / audit_tieout / audit_run 生成科目表、重要性、抽样、勾稽与底稿，并整理为可复核的风险评估记录。
whenToUse: 用户要求执行 CSA 1211 风险评估、制定审计计划、确定重要性、抽取细节测试样本、核对账表勾稽或生成审计工作底稿时。
---

# 审计风险评估（CSA 1211）——audit-p0 工具作业指引

本 skill 指导 agent 使用 audit-p0 组合包提供的 5 个工具，完成《中国审计准则第 1211 号——通过了解被审计单位及其环境识别和评估重大错报风险》所需的数据准备与底稿材料生成。重要性计算对应《中国审计准则第 1221 号——计划和执行审计工作时的重要性》。

> **硬性边界：这 5 个工具只做确定性计算与数据整理，不生成审计结论。**
> 风险评估结论、重要性基准与比率的选择、样本量与错报评价均由注册会计师作出，并需人工复核。不得把工具输出直接表述为“审计结论”“无重大错报”“风险已消除”。

## 一、开始前检查

1. 确认插件配置的 `repoPath` 指向 audit-p0 仓库根目录，且 `pythonPath` 可执行；CLI 以 `repoPath` 为工作目录运行。
2. 确认数据库中有目标公司（`company`）与期间（`period`）的数据；两者必须与数据库字段完全一致，工具不做模糊匹配。
3. 若任一工具报错，先原样报告错误信息与修复建议，不要猜测数据或伪造结果。

## 二、标准作业流程

### 第 1 步：了解报表结构（audit_tb）

调用 `audit_tb`，参数为 `company`、`period`。

- 目的：取得科目表（试算平衡表），了解科目构成、期末借贷方余额与借贷合计。
- 检查：借贷合计是否相等；科目分类是否完整；是否存在异常余额方向（如资产类贷方余额）。
- 产出：科目数量、借贷合计、异常科目清单，作为后续分析程序的起点。

### 第 2 步：确定重要性（audit_materiality）

调用 `audit_materiality`，参数为 `company`、`period`、`benchmark`（`pbt` / `revenue` / `assets`）、`rate`、`performance`、`trivial`。

- `benchmark`、`rate`、`performance`、`trivial` 是**审计判断输入**，不是工具自行选择的。应向用户确认或采用已批准的重要性政策；如果用户没有给出，先询问，不要自行假定。
- `rate`、`performance`、`trivial` 使用**百分比数值（0-100）**：`rate=5` 表示整体重要性为基准的 5%，`performance=75` 表示执行重要性为整体重要性的 75%，`trivial=5` 表示明显微小错报临界值为整体重要性的 5%。工具内部会除以 100 换算为 CLI 要求的小数比例；不要传 `0.05` 这类小数，超出 0-100 会报参数错误。
- 工具返回 `materiality`（整体重要性）、`performance_materiality`（执行重要性）、`trivial_threshold`（明显微小错报临界值）与 `alternatives`（其余基准的对照计算结果）。
- 用途：`alternatives` 只作基准选择的敏感性参考，最终基准仍需审计判断。
- 提示：执行重要性通常低于整体重要性；明显微小错报临界值通常远低于整体重要性。若输入比率导致三者关系异常，提示用户复核。

### 第 3 步：抽取细节测试样本（audit_sample）

调用 `audit_sample`，参数为 `company`、`period`、`size`、`seed`，`method` 固定为 `mus`（货币单位抽样）。

- 目的：按货币单位抽样选取凭证样本，得到总体规模、抽样间隔、覆盖率与选中凭证明细。
- `size` 与 `seed` 必须记录在底稿中，`seed` 用于复现同一组样本。
- 检查：`met` 是否为 `true`（是否达到计划样本量）；`selected` 的金额分布是否异常集中。
- 选中样本的后续检查（凭证抽查、函证、截止测试等）不属于本工具范围，需要人工执行并记录。

### 第 4 步：账表勾稽与错报线索（audit_tieout）

调用 `audit_tieout`，参数为 `company`、`period`。

- 目的：核对科目表、凭证与报告数据之间的一致性，得到逐项 `checks` 与按严重程度分级的 `findings`。
- 逐条查看未通过的 check 与 finding：记录 `severity`、`code`、`message`、`refs`，并判断属于数据问题、录入错误还是真实错报线索。
- `passed=false` 不等于存在重大错报，只表示数据层面存在需要追查的差异；追查过程与结论由人工完成。

### 第 5 步：生成工作底稿（audit_run）

调用 `audit_run`，参数为 `company`、`period`、`out`（输出目录，相对路径按 `repoPath` 解析）。

- 一次运行完成重要性、抽样、勾稽并写出底稿文件；返回 `materiality`、`sampling`、`tieout`、`workpapers.files`、`workpapers.citations`。
- 记录 `workpapers.files` 中每个底稿的 `id`、`title`、`path`，并核对文件确实存在。
- 引用清单 `citations` 只表示底稿引用的数据来源，不代表审计证据充分。

## 三、工具参数速查

| 工具 | 必填参数 | 主要返回 |
| --- | --- | --- |
| `audit_tb` | `company`, `period` | `accounts[]`, `totals.debit`, `totals.credit` |
| `audit_materiality` | `company`, `period`, `benchmark`, `rate`, `performance`, `trivial`（后三项为 0-100 百分比） | `benchmark_value`, `materiality`, `performance_materiality`, `trivial_threshold`, `alternatives[]`, `calculation` |
| `audit_sample` | `company`, `period`, `size`, `seed`（`method` 可省略，默认 `mus`） | `population`, `sample_size`, `met`, `interval`, `coverage`, `selected[]` |
| `audit_tieout` | `company`, `period` | `passed`, `checks[]`, `findings[]` |
| `audit_run` | `company`, `period`, `out` | `materiality`, `sampling`, `tieout`, `workpapers.files[]`, `workpapers.citations[]` |

所有工具都会在文本结果中附带完整原始 JSON。汇报时优先引用结构化字段，不要从自然语言摘要反推数字。

## 四、结果整理与汇报

完成后按以下结构向用户汇报：

1. **数据范围**：公司、期间、数据库口径、运行时间。
2. **报表结构**：科目数与借贷合计（`audit_tb`）。
3. **重要性**：基准与比率、整体/执行重要性、明显微小错报临界值（`audit_materiality`）。
4. **抽样**：方法、样本量、种子、总体规模、覆盖率、选中凭证数（`audit_sample`）。
5. **勾稽与发现**：检查项通过情况、未通过项与 finding 清单（`audit_tieout`）。
6. **底稿**：`audit_run` 生成的底稿文件路径与引用清单。
7. **待人工判断事项**：基准选择、比率合理性、异常项目追查、是否构成重大错报风险及其应对。

## 五、失败处理

- 工具返回错误文本（如 `repoPath 不存在`、`找不到 Python 解释器`、`超过 …ms 未完成`、`stdout 不是合法 JSON`、`退出码非 0`）：原样保留错误信息，检查 `repoPath` / `pythonPath` / `dbPath` 配置与 Python 依赖，再重试。
- 同一个错误连续两次出现时停止重试，向用户报告具体命令、cwd 与错误码，不要用臆造数据继续流程。
- 工具超时不代表业务失败，应先缩小查询范围（如确认 `company`、`period` 是否正确）再重试。

## 六、禁止事项

- 不得把工具输出包装成审计意见、审计结论或对管理层声明的保证。
- 不得跳过重要性参数的人工确认而自行填默认值。
- 不得修改或伪造返回的 JSON、底稿文件或引用清单。
- 不得在未运行 `audit_tieout` 的情况下声称账表已勾稽。
