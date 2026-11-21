# @local/dsh-audit-kb

DSH 组合包：把事务所共享知识库（mini4pro:8030）暴露为模型工具。

- `kb_search`：混合检索（准则/会计准则/税法/职业道德/法规），返回原文 + 出处 + 元数据
- `kb_get_doc`：按 ref 取整篇切块
- `kb_list_docs`：列出已发布文档
- `audit-knowledge` skill：强制「先检索、标出处、查不到说查不到、不编条款号」

安装：`dsh plugin --profile <profile> add file:<本目录>`，或 GUI 插件页添加本地目录。
配置：`cordis.patch.yml` 中的 `baseUrl` 与 `token`（当前使用共享 auditor token）。
