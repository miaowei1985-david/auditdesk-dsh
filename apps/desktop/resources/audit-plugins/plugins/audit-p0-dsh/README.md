# @local/dsh-audit-p0

DeepSeek Harness（DSH）组合包（bundle）：把本地 audit-p0 Python 审计 CLI 暴露为 5 个模型工具，并附带一个中文 skill，指导 agent 按《中国审计准则第 1211 号》风险评估流程作业。

- 包类型：Host-only bundle（无构建步骤、无运行时 npm 依赖，纯 ESM JavaScript）
- 目标 DSH 版本：`0.2.2-rc.5`（`engines.dsh: >=0.2.0 <0.3.0`）
- 工具只做确定性计算，不生成审计结论；结论需人工复核

## 目录结构

```text
dsh/
├── package.json                 # dsh.bundle.patch 指向 cordis.patch.yml
├── cordis.patch.yml             # 安装 bundle 时插入的工具行 + skill 行
├── index.js                     # Host 插件：注册 5 个工具
├── skill.js                     # Host 插件：把 SKILL.md 注册为运行时 skill
├── skills/audit-risk-assessment/SKILL.md
├── locale/zh.json               # 插件管理页显示元数据
├── locale/en.json
└── README.md
```

## 前置条件

1. **audit-p0 Python CLI 可用**：仓库根目录 `/Users/macbook/Documents/deepseek-harness/default-workspace/audit-p0` 内存在 `audit_p0/` 包，且能在该目录执行 `python3 -m audit_p0 --help`。
2. **Python 依赖**：在仓库根目录执行 `pip install -r requirements.txt`（若该仓库未提供 `requirements.txt`，按 audit-p0 CLI 的说明安装；CLI 与 `requirements.txt` 由 audit-p0 仓库维护）。
3. **数据库**：默认使用 `<repoPath>/data/audit.db`；也可在配置中用 `dbPath` 指定其他路径。
4. **DSH**：0.2.x（本包按 0.2.2-rc.5 的 `defineTool` / Schemastery / `ctx.skills.register` API 编写）。

不需要 `npm install`、不需要构建步骤。`index.js` 的 `@deepseek-ai/*` import 由 DSH 的 linked-import peer 解析按本包 `package.json` 的 `peerDependencies` 从 DSH 安装内取副本，因此**安装/加载时请保留 `package.json` 与 `index.js` 的目录关系**。

## 安装

四种方式任选其一。**安装后新开一个会话或重启 DSH**，再用 `audit_tb` 等工具验证。

### 方式 1：DSH GUI「插件 → 添加插件」

在 Plugins（插件）页面选择 **Add plugin / 添加插件**，选中本地目录：

```text
/Users/macbook/Documents/deepseek-harness/default-workspace/audit-p0/dsh
```

安装完成后确认插件清单出现 `audit-p0 审计工具` 一行（以及 skill 行），标题与描述来自 `locale/*.json`。

### 方式 2：通过 `plugin_manager` 工具

```text
plugin_manager action=install_bundle target=/Users/macbook/Documents/deepseek-harness/default-workspace/audit-p0/dsh
```

（需要 DSH 的 `plugin_manager` 工具可用；安装后按返回的 `application` / `warnings` 判断是否已生效。）

### 方式 3：`dsh plugin add`（CLI）

```sh
dsh plugin --profile <profile-name> add file:/Users/macbook/Documents/deepseek-harness/default-workspace/audit-p0/dsh
```

首次使用会初始化 profile。安装后先不启动、只验证配置层：

```sh
dsh --profile <profile-name> --dump-config
```

应能看到 `# == @local/dsh-audit-p0` 层以及 `audit-p0-tools`、`audit-p0-skill` 两行。

### 方式 4：隔离 profile 试装（不污染主 profile，推荐用于验证）

```sh
export DSH_HOME=/tmp/dsh-audit-p0-test          # 隔离的 Harness home
dsh plugin --profile web add file:/Users/macbook/Documents/deepseek-harness/default-workspace/audit-p0/dsh
dsh --profile web --port 5189                    # 用完后删掉 /tmp/dsh-audit-p0-test 即可
```

> 已实测：`dsh plugin add file:` 安装成功，`--dump-config` 能看到本包层与两行插件，`dsh web` 启动时**无插件激活失败**（两条行均激活）。安装是 pnpm 硬链接，修改源码后建议重新执行一次 `dsh plugin add`。
>
> 不要用 `dsh web --patch ./cordis.yml` 这种“不安装直接加载”的方式：overlay 加载的本地 `.js` 无法解析 `@deepseek-ai/*` 运行时依赖（实测报 `ERR_MODULE_NOT_FOUND`），只有经 profile 安装的 bundle 才有 linked-peer 解析。

### 安装失败时

- 若安装器提示 `engines.dsh` 或 peer 版本不匹配：把 DSH 升级/降级到 0.2.x，或把本包 `engines.dsh` 调整为实际使用的 0.2.x 版本。
- 若插件行 `failed`：看 DSH 启动诊断里的 import/Config 报错；常见原因是 `repoPath` 不存在（工具调用时才报）或 peer 未声明（检查 `package.json` 的 `peerDependencies` 是否被误删）。
- 本包没有 `install`/`prepare` 脚本，安装时不需要授权任何构建脚本。

## 配置

`index.js` 导出的 Schemastery `Config` 字段：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `repoPath` | `/Users/macbook/Documents/deepseek-harness/default-workspace/audit-p0` | audit-p0 仓库根目录，同时作为 CLI 的 `cwd`；必须包含 `audit_p0` Python 包。 |
| `pythonPath` | `python3` | Python 解释器；可用绝对路径指向虚拟环境。 |
| `dbPath` | 空字符串 | 审计数据库路径。Schemastery 的默认值不能引用同层其他字段，因此 **schema 默认值为空串，`apply()` 时代码解析为 `<repoPath>/data/audit.db`**；显式填写则原样使用。 |
| `timeoutMs` | `120000` | 单次 CLI 调用超时（毫秒），超时后子进程被终止。 |

`cordis.patch.yml` 与 `cordis.yml` 都显式写入了 `repoPath` / `pythonPath` / `dbPath` / `timeoutMs`。若要改配置，建议在自己的 profile 层按 **行 id** 覆盖，并重述全部字段（patch 的 `config` 是整行替换，不做深合并）：

```yaml
# $DSH_HOME/profiles/<profile>/cordis.patch.yml
- id: audit-p0-tools
  config:
    repoPath: /Users/macbook/Documents/deepseek-harness/default-workspace/audit-p0
    pythonPath: /Users/macbook/Documents/deepseek-harness/default-workspace/audit-p0/.venv/bin/python
    dbPath: /Users/macbook/Documents/deepseek-harness/default-workspace/audit-p0/data/audit.db
    timeoutMs: 180000
```

## 工具清单

每个工具都以 `cwd=repoPath` 执行：

```text
<pythonPath> -m audit_p0 --db <dbPath> <command> [args] --json
```

并解析 stdout 的单个 JSON。失败时 CLI 约定 stdout 为 `{"ok":false,"error":"..."}` 且退出码非 0；插件把这类失败、超时、非 JSON 输出、Python 不存在等统一转换为工具错误文本，不会抛未捕获异常。

| 工具 | CLI 子命令 | 参数 | 返回要点 |
| --- | --- | --- | --- |
| `audit_tb` | `tb` | `company`, `period` | `accounts[]`, `totals.debit`, `totals.credit` |
| `audit_materiality` | `materiality` | `company`, `period`, `benchmark`(`pbt`/`revenue`/`assets`), `rate`, `performance`, `trivial` | `benchmark_value`, `materiality`, `performance_materiality`, `trivial_threshold`, `alternatives[]`, `calculation` |
| `audit_sample` | `sample` | `company`, `period`, `size`, `seed`；`method` 可省略（默认 `mus`） | `population`, `sample_size`, `met`, `interval`, `coverage`, `selected[]` |
| `audit_tieout` | `tieout` | `company`, `period` | `passed`, `checks[]`, `findings[]` |
| `audit_run` | `run` | `company`, `period`, `out` | `materiality`, `sampling`, `tieout`, `workpapers.files[]`, `workpapers.citations[]` |

每个工具的模型可见文本包含：中文摘要、**完整原始 JSON**、以及“只做确定性计算、结论需人工复核”的提示。工具定义本身也写明了该边界。

`audit_materiality` 的三个比率参数使用**百分比语义（0-100）**：

- `rate=5` 表示整体重要性为基准值的 5%；
- `performance=75` 表示执行重要性为整体重要性的 75%；
- `trivial=5` 表示明显微小错报临界值为整体重要性的 5%。

插件在调用 CLI 前统一除以 100，换算成 CLI 契约要求的小数比例（`0.05` / `0.75` / `0.05`）。任一项超出 0-100 会抛 `ToolArgsError`（`INVALID_ARGS`），不会把 `5` 当成 `500%` 传给 CLI。

超时与取消：`execFile` 使用 `timeout=timeoutMs`，并转发 DSH 的 `exec.signal`；调用被取消时保留 `AbortError` 语义，不包装成普通错误。

## 作用域与挂载层（为什么插在 profile 根层）

`cordis.patch.yml` 把 `audit-p0-tools` / `audit-p0-skill` 插在 **profile 根层（Host 层）**。这是 DSH 用户 bundle 的标准挂载位置，**不需要**写进 agent preset 的 `plugins` 列表：

- Host 插件负责提供/使用共享服务（工具注册表、prompt 注册表等）。`ctx.tools.register()` 在 Host 层注册的是全局工具，agent 默认继承；只有 `ctx.tools.restrict()` 才会按 agent 收窄（见 `@deepseek-ai/dsh-tools` README 的 “Restrict tools per agent” 一节）。
- DSH 教程《开发一个工具》同样是通过 `--patch` 覆盖层（根层）插入工具插件，然后在 Web 会话里直接调用（`docs/user/develop/basic/tool.zh.md`）。
- Web profile 会把 `dsh-base` 里的一批 **shipped** 工具行（`tool-bash`、`tool-fs`、`tool-todo` 等）覆盖为 `disabled: true`，因为 Web 把可配置工具重新组合进各 preset（`dsh-web-app/cordis.patch.yml` 中 `- id: tool-*` + `disabled: true` 区块）。本包的插件行 id 是 `audit-p0-tools`，不在该禁用列表里；shipped 的 `standard` / `ptc` / `minimal` preset 也没有调用 `ctx.tools.restrict()`，所以根层注册的 5 个工具对所有 preset 的 agent 可见。
- skill 同理：`ctx.skills.register()` 写入 skill 注册表的全局层，preset 内的 `tool-skill` 会读取全局层 + preset 层（见 `dsh-web-app/cordis.patch.yml` 的 skill 注释与 `@deepseek-ai/dsh-skill` README 的 host+per-scope 分层说明）。

若确实只想让某个自定义 preset 看到这些工具，可另做一个 preset bundle（preset 由 bundle patch 中的 `@deepseek-ai/dsh-agent-preset` 声明，格式见 dsh-doc `references/compositions.md`）：

```yaml
- insert:
    - id: preset-audit
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: audit
        name: Audit
        description: 只挂载 audit-p0 工具的审计 agent。
        order: 10
        plugins:
          - id: audit-p0-tools
            name: '@local/dsh-audit-p0'
            config:
              repoPath: /Users/macbook/Documents/deepseek-harness/default-workspace/audit-p0
              pythonPath: python3
              dbPath: /Users/macbook/Documents/deepseek-harness/default-workspace/audit-p0/data/audit.db
              timeoutMs: 120000
          - id: audit-p0-skill
            name: '@local/dsh-audit-p0/skill'
```

该片段需要与 `package.json` 一起作为另一个 bundle 安装，或写入你自己的 profile patch 层；本包默认走根层挂载，与 preset 方案**二选一**，避免同名工具同时出现在全局层与 preset 层造成遮蔽混淆。

## Skill

`skill.js` 在 `ctx.skills.register({...})` 中注册运行时 skill：

- 名称：`audit-risk-assessment`（来自 `SKILL.md` frontmatter）
- 描述：见 frontmatter 的 `description`
- 正文：`SKILL.md` 剥离 frontmatter 后的 Markdown
- 资源基目录：`skills/audit-risk-assessment/`（模型可用相对路径读取同目录资源）
- `source: 'bundled'`，默认 model/user 均可调用

`SKILL.md` 的 `name`、`description`、`whenToUse` 由 `skill.js` 做**单行** `key: value` 解析后传入注册表；修改 frontmatter 后需重新加载插件（或重启会话）才会更新 catalog。正文修改同理（运行时 skill 不监听文件变化）。

挂载依据：`dsh-base` 已挂载 `@deepseek-ai/dsh-skill` 注册表；Web profile 保留该 Host 行，只把 `skill-filesystem` 与 `tool-skill` 移入各 preset（`dsh-web-app/cordis.patch.yml`）。因此宿主只需在 `ctx.skills` 上注册内嵌 skill，preset 里的 `tool-skill` 会读取全局层。这一点在 DSH 0.2.2-rc.5 的 `dsh-skill/src/index.ts`（`SkillRegistry.register()`）与 `dsh-base/cordis.patch.yml` 中确认。

## 验证步骤（未在本机执行安装）

```sh
# 1. JS 语法
node --check /Users/macbook/Documents/deepseek-harness/default-workspace/audit-p0/dsh/index.js
node --check /Users/macbook/Documents/deepseek-harness/default-workspace/audit-p0/dsh/skill.js

# 2. JSON/YAML 可解析
python3 -m json.tool /Users/macbook/Documents/deepseek-harness/default-workspace/audit-p0/dsh/package.json >/dev/null
python3 -c "import yaml,sys; yaml.safe_load(open('/Users/macbook/Documents/deepseek-harness/default-workspace/audit-p0/dsh/cordis.patch.yml'))"

# 3. 直接验证 Python CLI（绕过 DSH）
cd /Users/macbook/Documents/deepseek-harness/default-workspace/audit-p0
python3 -m audit_p0 --db data/audit.db tb --company DEMO --period 2025 --json

# 4. 隔离安装并验证配置层
export DSH_HOME=/tmp/dsh-audit-p0-test
dsh plugin --profile web add file:/Users/macbook/Documents/deepseek-harness/default-workspace/audit-p0/dsh
dsh --profile web --dump-config | grep -A 6 audit-p0

# 5. 启动后在新会话里调用：Use audit_tb for company DEMO001 period 2025.
```

## 未经验证的 API 点与已知限制

已在 2026-11-21 用 DSH 0.2.2-rc.5（桌面版内置 CLI）做过的验证：
（1）`index.js`/`skill.js` 能被 Electron ESM 加载，5 个 `defineTool` schema 编译并注册成功，工具执行/渲染、参数校验与失败分支用**替身 CLI** 跑通；
（2）**实测安装**：`DSH_HOME=/tmp/dsh-audit-p0-test dsh plugin --profile web add file:<本目录>` 成功，profile 的 `package.json` 记录 bundle，`--dump-config` 显示本包层与两行；
（3）**实测启动**：该 profile `dsh web --port 5189` 启动成功，启动诊断**没有** “entry did not activate” 警告，说明工具插件与 skill 插件均已激活（peer 依赖由 profile 的 linked-import 解析从 DSH 安装内取得）；
（4）**桌面版真实会话实测**：装入 `desktop` profile 后 HMR 即时生效，5 个工具与 `audit-risk-assessment` skill 出现在会话中，5 个工具全部真实调用成功（`audit_run` 生成 4 份 docx）。
仍未验证：

1. **`ctx.skills.register` 运行时注册**：API 已在 `@deepseek-ai/dsh-skill/src/index.ts`（0.2.2-rc.5，`SkillRegistry.register` + `validateRuntimeSkill`）确认；但“注册后 catalog 出现在会话、`skill` 工具能加载”未在真实会话验证。若该 API 在目标 DSH 版本有变化，skill 行可能加载失败；可先把 `audit-p0-skill` 行设为 `disabled: true`，只保留工具行。
2. ~~真实会话中的工具可见性与执行~~：已在桌面版 0.2.2-rc.5 实测通过（2026-11-21）：tools catalog 出现 5 个工具、skill 出现 `audit-risk-assessment`，5 个工具真实调用成功。
3. **GUI「插件 → 添加插件」路径**：同一套安装机制，但未在桌面 GUI 中实际点击验证。
4. **`plugin_manager` 工具路径**：按文档撰写，未在本会话执行（当前会话无 plugin_manager 工具）。
5. **Python CLI 契约**：`audit_p0` 模块、命令、参数、返回 JSON 字段按契约实现；当前仓库的 CLI 已通过 `scripts/acceptance.py` 20 项验收，与工具调用的命令/字段一致。
6. **`dbPath` 默认值**：Schemastery 的 `.default()` 只接受字面量，无法声明“依赖 repoPath 的动态默认值”；因此 schema 默认空串、`apply()` 时解析为 `<repoPath>/data/audit.db`。这是实现选择，不是 DSH 动态默认 API。
7. **工具级 DSH 超时**：未给 `defineTool` 设置 `timeoutMs`（避免与 `execFile` 超时重复竞争），因此超时只由 `execFile` 的 `timeoutMs` 控制，错误码为 `AUDIT_P0_TIMEOUT`；若希望由 DSH 的 `dsh-tool-call-timeout-policy` 统一兜底，可给 5 个工具加 `timeoutMs: config.timeoutMs`（未改动）。
8. **显示资源**：提供了 `locale/zh.json`、`locale/en.json`，未提供 `icon.svg`/`meta.detail` 文档，插件管理页会使用默认图标、以 README 作为详情回退；未在 GUI 中目视验证。
9. **输出体积**：工具把原始 JSON 完整放入模型可见文本（`maxBuffer` 32 MiB）。`audit_tb` 在科目很多或 `audit_run` 的引用很多时可能消耗较多上下文；如遇上下文压力，可在 `index.js` 的 `renderPayload` 中增加截断提示（当前按“返回完整原始 JSON”的要求未截断）。
10. **失败路径**：Python 解释器不存在、超时、非 JSON stdout、`ok:false` + 非 0 退出、参数校验已用替身 CLI 跑通；`stdout` 超 `maxBuffer` 分支与真实 audit_p0 CLI 的错误输出未实测。
11. **根层工具对 agent 的可见性**：依据 `@deepseek-ai/dsh-tools` 源码（`register` 的 global/scoped 分层；`restrict()` 才按 agent 收窄）、`dsh-web-app/cordis.patch.yml` 的 shipped 工具禁用列表，以及 DSH 工具教程的 `--patch` 根层示例判断为可见；但未在真实 Web 会话确认 5 个工具出现在 tool catalog。若某 preset 未来加入 `ctx.tools.restrict()`，需要把本包行加入该 preset 的 `plugins` 列表（见上文“作用域与挂载层”）。

## 实测发现的问题与后续改进

- **工具返回体积偏大**：每个工具把完整原始 JSON 放进模型可见文本，`audit_sample`（60 笔）与 `audit_run` 会消耗较多上下文。P1 建议：默认只渲染摘要与关键字段，原始 JSON 通过 `presentationMeta` 或截断开关按需返回。
- **CLI `--json` 位置**：真实调用曾暴露 argparse 只在子命令前接受 `--json` 的问题（工具把 `--json` 放末尾），已在 CLI 修复并加验收项。
- **profile 安装副作用**：`dsh plugin add` 会让 pnpm 整理 profile 的 node_modules，把未在依赖树中的历史包移入 `.ignored/`；安装前请备份 profile 配置（本次已备份）。
