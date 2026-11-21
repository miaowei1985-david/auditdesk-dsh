# AuditDesk 审计插件安装包

本目录用于给已安装的 AuditDesk / DeepSeek Harness 桌面端安装「审计工作台」功能插件。

## 包含插件

| 插件 | 作用 |
|---|---|
| `audit-workbench-dsh` | 左侧栏「客户与项目 / 知识库 / 操作留痕 / 用户管理 / 系统状态」 |
| `audit-kb-dsh` | 共享知识库检索工具（kb_search / kb_get_doc / kb_list_docs） |
| `audit-p0-dsh` | 审计 P0 工具（科目表、重要性、抽样、勾稽、底稿生成） |

## 安装（Windows）

```powershell
powershell -ExecutionPolicy Bypass -File install-windows.ps1
```

## 安装（macOS）

```bash
bash install-macos.sh
```

可选参数：`--profile desktop`（默认）。

脚本会：

1. 把插件复制到 `~/.dsh/plugins/auditdesk/`；
2. 写入目标 profile 的 `package.json`（依赖 + bundle 列表）；
3. 执行 `dsh plugin --profile desktop install`；
4. 重启桌面端后生效。

## 依赖

- 知识库/项目数据服务：mini4pro `http://100.101.170.7:8030`（需在事务所内网或 Tailscale 内）；
- 默认演示账号：auditor/auditor123（审计员）、manager/manager123（项目经理）、partner/partner123（合伙人）、admin/admin123（管理员）。
