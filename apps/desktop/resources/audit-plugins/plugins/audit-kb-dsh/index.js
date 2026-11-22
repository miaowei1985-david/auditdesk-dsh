/**
 * audit-kb Host 插件：把共享知识库服务（mini4pro:8030）暴露为 DSH 模型工具。
 *
 * 边界：只做检索与原文读取，不生成审计结论；回答必须引用检索结果的 ref 与文档元数据。
 */
import { HarnessError } from '@deepseek-ai/dsh-error'
import { defineTool, ToolArgsError } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { checkQuotes } from './verify.js'

/** Cordis 插件名。 */
export const name = 'audit-kb-tools'

/** 工具注册表就绪后再注册。 */
export const inject = ['tools']

/** 共享知识库默认地址（mini4pro，Tailscale/内网）。 */
export const DEFAULT_BASE_URL = 'http://100.101.170.7:8030'

/** 插件配置。 */
export const Config = Schema.object({
  baseUrl: Schema.string().default(DEFAULT_BASE_URL).description('共享知识库网关地址，如 http://100.101.170.7:8030'),
  token: Schema.string().default('').description('共享知识库访问 token（Authorization: Bearer）'),
  timeoutMs: Schema.number().default(20000).description('单次请求超时（毫秒）'),
})

class KbError extends HarnessError {
  constructor(message, code, options) {
    super(message, code, options)
    this.name = 'KbError'
  }
}

const REVIEW_NOTICE = '本工具只做知识库检索，不生成审计结论；回答必须标注出处（分类/文件名 › 段落），查不到就说查不到，不得编造条款号。'

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new ToolArgsError([`${field} 不能为空`])
  return value.trim()
}

function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function renderHits(payload) {
  const hits = asArray(payload.hits)
  const lines = [
    `知识库检索：query=${JSON.stringify(payload.query ?? '')}，命中 ${hits.length} 条（库内 ${payload.total_chunks ?? '?'} 块）。`,
  ]
  for (const [i, raw] of hits.entries()) {
    const hit = asRecord(raw)
    const doc = asRecord(hit.doc)
    lines.push(
      `${i + 1}. [${doc.code ?? '?'}] ${doc.title ?? ''}${doc.docno ? `（${doc.docno}）` : ''}`
      + `${doc.effective ? ` 生效:${doc.effective}` : ''}`
      + `${hit.validity ? ` · ${hit.validity}` : ''}`
      + `${hit.article_no_cn ? ` · ${hit.article_no_cn}` : ''}`
      + `\n   锚点：${hit.anchor ?? '—'}${hit.heading_path ? `（${hit.heading_path}）` : ''}`
      + `\n   出处：${hit.ref ?? ''}\n   原文：${String(hit.text ?? '').slice(0, 240)}`,
    )
  }
  if (hits.length === 0) lines.push('未命中：告诉用户知识库没有找到相关内容，不要推测或编造。')
  lines.push(`提示：${REVIEW_NOTICE}`)
  return [{ type: 'text', text: lines.join('\n') }]
}

async function callApi(settings, path, params) {
  if (typeof settings.token !== 'string' || settings.token.trim() === '') {
    throw new KbError('未配置共享知识库 token；请在插件配置中填写 token（auditor 或 admin）。', 'KB_TOKEN_MISSING')
  }
  const url = new URL(path, settings.baseUrl)
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }
  let response
  try {
    response = await fetch(url, {
      headers: { authorization: `Bearer ${settings.token}` },
      signal: AbortSignal.timeout(settings.timeoutMs),
    })
  } catch (error) {
    throw new KbError(`共享知识库请求失败：${error instanceof Error ? error.message : String(error)}（${url}）`, 'KB_NETWORK_ERROR', { cause: error })
  }
  if (!response.ok) {
    throw new KbError(`共享知识库返回 ${response.status}：${(await response.text()).slice(0, 300)}`, 'KB_HTTP_ERROR')
  }
  return await response.json()
}

/** 注册 kb_search / kb_get_doc / kb_list_docs。 */
export function apply(ctx, config) {
  const settings = {
    baseUrl: config.baseUrl || DEFAULT_BASE_URL,
    token: config.token || '',
    timeoutMs: config.timeoutMs || 20000,
  }

  // 本轮会话已返回过的锚点 → 原文，供 kb_verify_quotes 核对。
  const anchors = new Map()
  const remember = (payload) => {
    const record = asRecord(payload)
    const entries = [
      ...asArray(record.hits).map((hit) => ({ anchor: hit.anchor, text: hit.text, ref: hit.ref, title: asRecord(hit.doc).title, article: hit.article_no_cn, validity: hit.validity })),
      ...asArray(record.chunks).map((chunk) => ({ anchor: chunk.anchor, text: chunk.text, ref: record.doc, title: asRecord(record.meta).title, article: chunk.article_no_cn, validity: chunk.validity })),
    ]
    for (const entry of entries) {
      if (!entry.anchor) continue
      anchors.delete(entry.anchor)
      anchors.set(entry.anchor, entry)
    }
    while (anchors.size > 400) {
      anchors.delete(anchors.keys().next().value)
    }
  }

  ctx.tools.register(defineTool({
    name: 'kb_search',
    description: '在事务所共享知识库（审计准则/会计准则/税法/职业道德/法规）中做混合检索，返回带文档元数据与出处的条文段落。回答准则、法规、事务所制度类问题前必须先调用；不得凭记忆编造条款。' + REVIEW_NOTICE,
    parameters: {
      q: { type: 'string', required: true, description: '检索问题或关键词（用核心实体，如「存货跌价准备 计提」）。' },
      top_k: { type: 'number', description: '返回条数 1-20，默认 5。' },
      codes: { type: 'string', description: '限定分类，逗号分隔，如 K-01,K-02；省略则按 token 授权范围。' },
      include_expired: { type: 'boolean', description: '是否包含已过期版本，默认 false。' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => renderHits(asRecord(value)) },
    async execute(args) {
      const q = requireText(args.q, 'q')
      const topK = args.top_k === undefined ? 5 : Math.max(1, Math.min(20, Number(args.top_k)))
      const result = await callApi(settings, '/kb/search', {
        q, top_k: topK, codes: args.codes ?? '', include_expired: args.include_expired ? 'true' : '',
      })
      remember(result)
      return result
    },
  }))

  ctx.tools.register(defineTool({
    name: 'kb_get_doc',
    description: '按引用路径读取共享知识库中的整篇文档切块（用于核对上下文或引用原文）。doc 取自 kb_search 返回的 ref 前半段（形如 active/K-02/xxx.txt）。' + REVIEW_NOTICE,
    parameters: {
      doc: { type: 'string', required: true, description: '文档路径，如 active/K-02/xxx.txt（不含「› 段落」部分）。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        const payload = asRecord(value)
        const meta = asRecord(payload.meta)
        const chunks = asArray(payload.chunks)
        return [{
          type: 'text',
          text: [
            `文档：${meta.title ?? ''}（${meta.code ?? ''}${meta.docno ? ` / ${meta.docno}` : ''}）`,
            `路径：${payload.doc ?? ''}，切块 ${chunks.length} 块。`,
            ...chunks.slice(0, 8).map((c) => `- [${asRecord(c).section ?? ''} 第${asRecord(c).ord ?? ''}段] ${String(asRecord(c).text ?? '').slice(0, 200)}`),
            `提示：${REVIEW_NOTICE}`,
          ].join('\n'),
        }]
      },
    },
    async execute(args) {
      const doc = requireText(args.doc, 'doc')
      const result = await callApi(settings, '/kb/doc', { doc })
      remember(result)
      return result
    },
  }))

  ctx.tools.register(defineTool({
    name: 'kb_verify_quotes',
    description: '核对引用：传入本轮 kb_search / kb_get_doc 返回的锚点（anchor）与拟引用的原文片段，逐条校验锚点是否存在、片段是否为该段原文的子串。写「第 X 条」「条款依据」「应用指南段落」前必须先调用；ok=false 的不得作为依据，也不得把失败片段改写成概括后继续挂锚。' + REVIEW_NOTICE,
    parameters: {
      quotes: { type: 'string', required: true, description: 'JSON 数组，每项形如 {"anchor":"kb-xxxx","quote":"拟引用的原文片段"}。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        const payload = asRecord(value)
        const results = asArray(payload.results)
        const lines = [
          `引用核验：${payload.passed ?? 0}/${results.length} 通过（可用锚点 ${payload.known ?? 0} 个）。`,
          ...results.map((raw) => {
            const item = asRecord(raw)
            return `- ${item.ok ? 'PASS' : 'FAIL'} ${item.anchor ?? ''}`
              + `${item.article ? ` ${item.article}` : ''}`
              + `${item.title ? `《${item.title}》` : ''}`
              + `${item.reason ? ` — ${item.reason}` : ''}`
          }),
          payload.passed === results.length && results.length > 0
            ? '全部通过：可以在回答中引用这些锚点与原文。'
            : '存在未通过项：不得引用对应锚点/条号；请重新 kb_search 或 kb_get_doc 后再核验。',
          `提示：${REVIEW_NOTICE}`,
        ]
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const raw = requireText(args.quotes, 'quotes')
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new ToolArgsError(['quotes 必须是 JSON 数组字符串'])
      }
      if (!Array.isArray(parsed)) throw new ToolArgsError(['quotes 必须是 JSON 数组'])
      return checkQuotes(anchors, parsed)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'kb_list_docs',
    description: '列出共享知识库中已发布文档（可按分类）及其编号、生效日期，用于确认某个准则是否在库。' + REVIEW_NOTICE,
    parameters: {
      code: { type: 'string', description: '分类编号，如 K-01；省略则列出 token 授权范围内全部。' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        const payload = asRecord(value)
        const docs = asArray(payload.docs)
        return [{
          type: 'text',
          text: [
            `知识库文档：${payload.count ?? docs.length} 篇。`,
            ...docs.slice(0, 30).map((d) => {
              const item = asRecord(d)
              return `- [${item.code}] ${item.title}${item.docno ? `（${item.docno}）` : ''}${item.effective ? ` 生效:${item.effective}` : ''}`
            }),
            docs.length > 30 ? `（仅列前 30 篇）` : '',
            `提示：${REVIEW_NOTICE}`,
          ].filter(Boolean).join('\n'),
        }]
      },
    },
    async execute(args) {
      return await callApi(settings, '/kb/docs', { code: args.code ?? '' })
    },
  }))
}
