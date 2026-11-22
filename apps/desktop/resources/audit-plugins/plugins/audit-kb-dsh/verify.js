/** 引用核验的纯逻辑：与 DSH 运行时解耦，便于单元测试。 */

export function normalizeQuote(text) {
  return String(text ?? '').replace(/\s+/g, '').trim()
}

/**
 * 逐条核验引用。
 * @param {Map<string, {text: string, article?: string, title?: string, validity?: string}>} anchors 本轮检索到的锚点
 * @param {Array<{anchor?: string, quote?: string}>} quotes 待核验引用
 */
export function checkQuotes(anchors, quotes) {
  const results = (Array.isArray(quotes) ? quotes : []).slice(0, 20).map((rawItem) => {
    const item = rawItem && typeof rawItem === 'object' ? rawItem : {}
    const anchor = String(item.anchor ?? '').trim()
    const quote = normalizeQuote(item.quote)
    const known = anchors.get(anchor)
    if (!known) {
      return { anchor, ok: false, reason: '锚点不在本轮检索结果中，请重新 kb_search / kb_get_doc 获取锚点' }
    }
    if (quote.length < 4) {
      return { anchor, ok: false, article: known.article, title: known.title, reason: '引用片段过短（至少 4 个字符）' }
    }
    if (normalizeQuote(known.text).includes(quote)) {
      return { anchor, ok: true, article: known.article, title: known.title, validity: known.validity }
    }
    return { anchor, ok: false, article: known.article, title: known.title, reason: '片段与锚点原文不一致（可能是改写、跨段拼接或版本不符）' }
  })
  return { results, passed: results.filter((item) => item.ok).length, known: anchors.size }
}
