# @local/dsh-audit-kb

DSH 组合包：把事务所共享知识库（mini4pro:8030）暴露为模型工具。

- `kb_search`：混合检索（准则/会计准则/税法/职业道德/法规），返回原文 + 出处 + 元数据
- `kb_get_doc`：按 ref 取整篇切块
- `kb_list_docs`：列出已发布文档
- `audit-knowledge` skill：强制「先检索、标出处、查不到说查不到、不编条款号」

安装：`dsh plugin --profile <profile> add file:<本目录>`，或 GUI 插件页添加本地目录。
配置：`cordis.patch.yml` 中的 `baseUrl` 与 `token`（当前使用共享 auditor token）。

## 引用锚点与核验（2026-11 新增）

`kb_search` / `kb_get_doc` 现在为每个命中返回稳定锚点与版本信息：

- `anchor`：`kb-<12位哈希>`，同一版本同一段每次检索一致；
- `article_no` / `article_no_cn`：能识别时给出「第十五条」；
- `heading_path`：章节/段落路径；
- `validity`：现行有效 / 已过期 / 已被替代；
- `sha256`：文档内容校验值。

新增工具 `kb_verify_quotes`：传入 `[{"anchor":"kb-...","quote":"拟引用原文"}]`，逐条核验
锚点是否在本轮检索结果中、片段是否为该锚点原文子串。skill 已要求：写条号/条款依据前必须核验，
未通过不得引用，也不得改写后继续挂锚。

自测脚本：

- `node test/unit.mjs`：引用核验纯逻辑单元测试（无需网络/DSH）；
- `KB_TOKEN=... node test/kb-api.mjs`：线上接口自测（anchor/条号/时效/search 与 doc 锚点一致）。
