#!/usr/bin/env node
// 纯逻辑单元测试：node test/unit.mjs
import { checkQuotes, normalizeQuote } from '../verify.js'

const anchors = new Map([
  ['kb-abc123456789', { text: '第十五条 资产负债表日，存货应当按照成本与可变现净值孰低计量。', article: '第十五条', title: '企业会计准则第1号——存货', validity: '现行有效' }],
])

const good = checkQuotes(anchors, [{ anchor: 'kb-abc123456789', quote: '存货应当按照成本与可变现净值孰低计量' }])
const badQuote = checkQuotes(anchors, [{ anchor: 'kb-abc123456789', quote: '这是编造的原文XYZ' }])
const ghost = checkQuotes(anchors, [{ anchor: 'kb-ffffffffffff', quote: '第十五条' }])
const shortQuote = checkQuotes(anchors, [{ anchor: 'kb-abc123456789', quote: '存货' }])

const cases = [
  ['normalizeQuote 去除空白', normalizeQuote('a b\n c') === 'abc'],
  ['正常引用通过', good.passed === 1 && good.results[0].ok === true],
  ['编造引用失败', badQuote.passed === 0 && /不一致/.test(badQuote.results[0].reason)],
  ['伪造锚点失败', ghost.passed === 0 && /不在本轮/.test(ghost.results[0].reason)],
  ['过短引用失败', shortQuote.passed === 0 && /过短/.test(shortQuote.results[0].reason)],
]
let failed = 0
for (const [name, ok] of cases) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) failed += 1
}
console.log(failed === 0 ? 'UNIT: PASS' : `UNIT: FAIL (${failed})`)
process.exit(failed === 0 ? 0 : 1)
