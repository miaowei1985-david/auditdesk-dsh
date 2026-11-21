/**
 * audit-kb skill 插件：把包内 skills/audit-knowledge/SKILL.md 注册为运行时 skill。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'audit-kb-skill'
export const inject = ['skills']

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), 'skills', 'audit-knowledge')
const SKILL_FILE = join(SKILL_DIR, 'SKILL.md')

const FALLBACK = {
  name: 'audit-knowledge',
  description: '事务所共享知识库检索：准则、会计准则、税法、职业道德、法规；回答必须带出处。',
}

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

export function apply(ctx) {
  let text
  try {
    text = readFileSync(SKILL_FILE, 'utf8')
  } catch (error) {
    ctx.logger?.warn(`[audit-kb] 无法读取 skill 文件 ${SKILL_FILE}：${String(error)}`)
    return
  }
  const { meta, body } = parseSkillFile(text)
  if (body === '') {
    ctx.logger?.warn(`[audit-kb] skill 文件 ${SKILL_FILE} 正文为空，跳过注册`)
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
  ctx.effect(() => ctx.skills.register(skill))
}
