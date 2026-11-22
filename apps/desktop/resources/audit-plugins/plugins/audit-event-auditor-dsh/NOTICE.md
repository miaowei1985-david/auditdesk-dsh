# 来源与许可

本目录是社区插件 [`@qing3a/dsh-event-auditor`](https://github.com/qing3a/dsh-event-auditor) v0.1.0 的 vendored 副本，MIT License。

为在 AuditDesk（DSH 0.2.2-rc.5）上运行，仅做了一处兼容补丁：
`lib/index.js` 中原 `installSettingsSection / settingsNamespace` 导入在 0.2.2-rc.5 中已不存在，
替换为本地空实现；面板、`/api/audit/events`、命令行与工具功能不变。
