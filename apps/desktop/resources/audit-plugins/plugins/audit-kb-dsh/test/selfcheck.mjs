#!/usr/bin/env node
// 自测：验证 kb_search 锚点与 kb_verify_quotes 的核验逻辑。
// 用法：node test/selfcheck.mjs   （需要能访问共享 KB 网关与 token）
import { apply } from '../index.js'

const tools = new Map()
apply({ tools: { register: (tool) => tools.set(tool.name, tool) } }, {
  baseUrl: process.env.KB_BASE_URL || 'http://100.101.170.7:8030',
  token: process.env.KB_TOKEN || '',
  timeoutMs: 20000,
})

const search = tools.get('kb_search')
const verify = tools.get('kb_verify_quotes')
if (!search || !verify) throw new Error('tools not registered')

const result = await search.execute({ q: '可变现净值 存货', top_k: 2, codes: 'K-02' })
const hit = (result.hits || [])[0]
if (!hit?.anchor) throw new Error('kb_search 未返回 anchor')
const quote = String(hit.text).slice(0, 25)
const good = await verify.execute({ quotes: JSON.stringify([{ anchor: hit.anchor, quote }]) })
const bad = await verify.execute({ quotes: JSON.stringify([{ anchor: hit.anchor, quote: '这是编造的原文XYZ' }]) })
const ghost = await verify.execute({ quotes: JSON.stringify([{ anchor: 'kb-000000000000', quote }]) })
if (!good.results[0].ok) throw new Error('正常引用未通过')
if (bad.results[0].ok) throw new Error('编造引用竟然通过')
if (ghost.results[0].ok) throw new Error('伪造锚点竟然通过')
console.log('KB citation selfcheck: PASS', {
  anchor: hit.anchor,
  article: hit.article_no_cn,
  validity: hit.validity,
  good: good.results[0].ok,
  bad: bad.results[0].ok,
  ghost: ghost.results[0].ok,
})
