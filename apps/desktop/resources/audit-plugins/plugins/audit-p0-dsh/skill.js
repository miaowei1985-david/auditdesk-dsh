/**
 * audit-p0 skill 插件：把包内 `skills/audit-risk-assessment/SKILL.md` 注册为运行时 skill。
 *
 * DSH 的 `dsh-skill` 注册表提供 `ctx.skills.register(skill)` 用于内嵌（in-memory）skill；
 * 这里读取包内 SKILL.md，剥离 YAML frontmatter 后注册正文，并给出目录型 resource base，
 * 使模型加载 skill 后能按相对路径读取同目录资源。
 *
 * @module @local/dsh-audit-p0/skill
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Cordis 插件名。 */
export const name = 'audit-p0-skill'

/** skill 注册表就绪后再注册。 */
export const inject = ['skills']

/** 包内 skill 目录（绝对路径）。 */
const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), 'skills', 'audit-risk-assessment')

/** SKILL.md 绝对路径。 */
const SKILL_FILE = join(SKILL_DIR, 'SKILL.md')

/** frontmatter 缺失或解析失败时的回退元数据。 */
const FALLBACK = {
  name: 'audit-risk-assessment',
  description: '按中国审计准则第 1211 号执行风险评估：用 audit-p0 工具生成科目表、重要性、抽样、勾稽与底稿。',
}

/**
 * 剥离 SKILL.md 开头的 YAML frontmatter，并解析其中单行的 `key: value` 字段。
 * 只支持本文件实际使用的单行标量；复杂 YAML 不属于本插件契约。
 * @param {string} text SKILL.md 全文。
 * @returns {{ meta: Record<string, string>, body: string }} 元数据与正文。
 */
function parseSkillFile(text) {
  const source = text.replace(/\r\n/g, '\n')
  if (!source.startsWith('---\n')) return { meta: {}, body: source.trim() }
  const end = source.indexOf('\n---', 4)
  if (end === -1) return { meta: {}, body: source.trim() }
  const header = source.slice(4, end)
  const meta = {}
  for (const line of header.split('\n')) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
    if (match === null) continue
    let value = match[2].trim()
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1)
    }
    meta[match[1]] = value
  }
  return { meta, body: source.slice(end + 4).trim() }
}

/**
 * 读取 SKILL.md 并注册为运行时 skill。
 * @param {import('@deepseek-ai/cordis').Context} ctx Cordis 上下文。
 */
export function apply(ctx) {
  let text
  try {
    text = readFileSync(SKILL_FILE, 'utf8')
  } catch (error) {
    ctx.logger?.warn(`[audit-p0] 无法读取 skill 文件 ${SKILL_FILE}：${String(error)}`)
    return
  }

  const { meta, body } = parseSkillFile(text)
  if (body === '') {
    ctx.logger?.warn(`[audit-p0] skill 文件 ${SKILL_FILE} 的正文为空，跳过注册`)
    return
  }

  const skill = {
    name: meta.name || FALLBACK.name,
    description: meta.description || FALLBACK.description,
    ...(meta.whenToUse === undefined || meta.whenToUse === '' ? {} : { whenToUse: meta.whenToUse }),
    content: body,
    path: SKILL_FILE,
    resourceBase: { kind: 'directory', path: SKILL_DIR },
    source: 'bundled',
  }

  // 用插件自身的 effect 包住注册，插件卸载/HMR 时注销该 skill。
  ctx.effect(() => ctx.skills.register(skill))
}
