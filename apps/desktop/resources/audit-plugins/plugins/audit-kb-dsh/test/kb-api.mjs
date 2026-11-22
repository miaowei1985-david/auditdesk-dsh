#!/usr/bin/env node
// 线上 KB 接口自测：node test/kb-api.mjs（需要 KB_TOKEN 环境变量）
const BASE = process.env.KB_BASE_URL || 'http://100.101.170.7:8030'
const TOKEN = process.env.KB_TOKEN || ''
if (!TOKEN) {
  console.error('缺少 KB_TOKEN 环境变量（auditor/admin token）')
  process.exit(2)
}
const headers = { 'X-KB-Token': TOKEN }
const get = async (path) => {
  const response = await fetch(BASE + path, { headers })
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`)
  return response.json()
}
const search = await get('/kb/search?q=' + encodeURIComponent('可变现净值 存货') + '&top_k=2&codes=K-02')
const hit = (search.hits || [])[0]
if (!hit?.anchor) throw new Error('search 未返回 anchor')
const doc = hit.ref.split(' › ')[0]
const docData = await get('/kb/doc?doc=' + encodeURIComponent(doc))
const sameAnchor = (docData.chunks || []).some((chunk) => chunk.anchor === hit.anchor)
const checks = [
  ['search anchor 非空', Boolean(hit.anchor)],
  ['article 可识别或为空', typeof hit.article_no === 'number'],
  ['validity 非空', Boolean(hit.validity)],
  ['sha256 非空', Boolean(hit.sha256)],
  ['search 与 doc 锚点一致', sameAnchor],
]
let failed = 0
for (const [name, ok] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) failed += 1
}
console.log(failed === 0 ? 'KB-API: PASS' : `KB-API: FAIL (${failed})`)
if (failed === 0) {
  console.log({ anchor: hit.anchor, article: hit.article_no_cn, validity: hit.validity })
}
process.exit(failed === 0 ? 0 : 1)
