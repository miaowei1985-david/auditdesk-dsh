import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'

// 插件目录（安装到 ~/.dsh/plugins/auditdesk/audit-excel-plugin 时引擎随之复制到 engine/audit-fill）
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))
function resolveProject() {
  if (process.env.DSH_AUDIT_PROJECT) return process.env.DSH_AUDIT_PROJECT
  const candidates = [
    path.join(PLUGIN_DIR, 'engine', 'audit-fill'),   // 安装包内布局
    path.join(PLUGIN_DIR, '..', 'audit-fill'),        // 开发态 link 布局
  ]
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  return candidates[0]
}
const PROJECT = resolveProject()
const BASE_DIR = process.env.DSH_AUDIT_BASE
  || path.join(os.homedir(), 'Documents', '审计底稿')

function resolvePython() {
  if (process.env.DSH_AUDIT_PYTHON) return process.env.DSH_AUDIT_PYTHON
  const candidates = []
  const resources = process.resourcesPath || ''
  if (resources) {
    candidates.push(
      path.join(resources, 'runtime', 'primary-runtime', 'dependencies', 'python', 'bin', 'python3'),
      path.join(resources, 'runtime', 'primary-runtime', 'dependencies', 'python', 'bin', 'python'),
    )
  }
  candidates.push('/usr/bin/python3', 'python3')
  for (const candidate of candidates) {
    try {
      if (candidate === 'python3' || candidate === '/usr/bin/python3' || existsSync(candidate)) return candidate
    } catch { /* ignore */ }
  }
  return 'python3'
}
const PYTHON = resolvePython()
const GATEWAY_CANDIDATES = [
  process.env.DSH_AUDIT_GATEWAY,
  'http://169.254.163.107:8030',
  'http://192.168.2.2:8030',
  'http://macmini4prodemac-mini.local:8030',
  'http://100.101.170.7:8030',
].filter(Boolean)
let GATEWAY = GATEWAY_CANDIDATES[0]

async function resolveGateway() {
  for (const url of GATEWAY_CANDIDATES) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 1500)
      const resp = await fetch(url + '/health', { signal: controller.signal })
      clearTimeout(timer)
      if (resp.ok) { GATEWAY = url; return url }
    } catch { /* try next */ }
  }
  return GATEWAY
}
const TIMEOUT_MS = Number(process.env.DSH_AUDIT_TIMEOUT_MS || 15 * 60 * 1000)

function runPython(args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, args, { cwd: existsSync(PROJECT) ? PROJECT : os.tmpdir(), env: process.env })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS)
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', (d) => { err += d.toString() })
    const onAbort = () => child.kill('SIGKILL')
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
      if (code !== 0) return reject(new Error((err || out || `exit ${code}`).trim().slice(-1500)))
      resolve(out)
    })
  })
}

function lastJson(text) {
  const lines = text.trim().split(/\r?\n/).reverse()
  for (const line of lines) {
    const s = line.trim()
    if (!s.startsWith('{')) continue
    try { return JSON.parse(s) } catch { /* keep looking */ }
  }
  throw new Error('no JSON in output: ' + text.slice(-400))
}

function clean(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? (Object.is(v, -0) ? 0 : v) : null
  if (Array.isArray(v)) return v.map(clean)
  if (v && typeof v === 'object') {
    const out = {}
    for (const [k, val] of Object.entries(v)) out[k] = clean(val)
    return out
  }
  return v
}

function text(t) {
  return [{ type: 'text', text: t }]
}

function summarize(data) {
  const lines = Array.isArray(data.lines) ? data.lines : []
  const ok = lines.filter((l) => l.diff === 0).length
  const missing = lines.filter((l) => l.diff === null || l.diff === undefined)
  const diffs = lines.filter((l) => l.diff !== null && l.diff !== undefined && Math.abs(l.diff) > 0.01)
  const head = `${data.company || ''}：勾稽 ${ok}/${lines.length} 一致` +
    (missing.length ? `，报表无此行 ${missing.length} 项` : '') +
    (diffs.length ? `，差异 ${diffs.length} 项：` + diffs.slice(0, 6)
      .map((d) => `${d.line} ${Number(d.diff).toFixed(2)}`).join('、') : '')
  const outs = data.outputs ? `\n底稿目录：${data.outputs.package_dir}\n主底稿：${data.outputs.master}` : ''
  return head + outs
}

const processTool = {
  name: 'audit_fill_process',
  description: '处理一家客户的 Excel 资料（科目余额表、财务报表、可选凭证），按事务所模板生成流动资产/非流动资产/流动负债及权益/损益四本底稿、01 主底稿和现金流量表，返回逐项勾稽结果。',
  parameters: {
    type: 'object',
    properties: {
      company: { type: 'string', description: '客户代码，作为输出目录名，如 "中天"。' },
      tb: { type: 'string', description: '科目余额表路径；相对路径按 base_dir 解析。' },
      fs: { type: 'string', description: '客户财务报表路径（资产负债表/利润表）。' },
      voucher: { type: 'string', description: '凭证或序时账路径，可选；提供后可做账龄与账证核对。' },
      client: { type: 'string', description: '报表抬头公司全称，默认同 company。' },
      base_dir: { type: 'string', description: '资料根目录，默认 /Users/macbook/Documents/审计底稿。' },
      out: { type: 'string', description: '输出目录，默认 out/<company>/底稿包（相对项目目录）。' },
    },
    required: ['company', 'tb', 'fs'],
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => text(summarize(value || {})),
  },
  async execute(args, exec) {
    const script = [
      'import json, sys',
      'sys.path.insert(0, ".")',
      'from auditfill.workbench import process_company',
      'a = json.loads(sys.argv[1])',
      'print(json.dumps(process_company(a["company"], a["tb"], a["fs"], a.get("voucher"), a.get("client"), a.get("base_dir"), a.get("out")), ensure_ascii=False, default=str))',
    ].join('; ')
    const payload = { ...args, base_dir: args.base_dir || BASE_DIR }
    const out = await runPython(['-c', script, JSON.stringify(payload)], exec.signal)
    const data = lastJson(out)
    const lines = (data.lines || []).map((l) => clean(l))
    return clean({
      ok: !!data.ok,
      company: data.company,
      lines,
      cashflow: data.cashflow,
      outputs: data.outputs,
    })
  },
}

const listTool = {
  name: 'audit_fill_companies',
  description: '列出已配置的客户代码及其资料文件，用于选择要处理的客户。',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  output: {
    schema: { type: 'object', properties: { companies: { type: 'array' } }, additionalProperties: true },
    render: (_a, v) => text((v.companies || []).map((c) => `${c.name}: ${c.tb || ''}`).join('\n') || '无'),
  },
  async execute(_args, _exec) {
    const script = [
      'import json, sys',
      'sys.path.insert(0, "tools")',
      'import run_company',
      'print(json.dumps({"companies":[{"name":k,"tb":v[0],"fs":v[1],"voucher":v[2]} for k,v in run_company.CASES.items()]}, ensure_ascii=False))',
    ].join('; ')
    const out = await runPython(['-c', script], undefined)
    return lastJson(out)
  },
}

const ledgerTool = {
  name: 'audit_fill_ledger',
  description: '把当前数据库里的全部公司汇总、勾稽明细、待取证和文件清单导出为 Excel 台账，返回文件路径；可同时刷新数据库。',
  parameters: {
    type: 'object',
    properties: {
      refresh: { type: 'boolean', description: '先重新装载数据库再导出，默认 true。' },
    },
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', properties: { path: { type: 'string' } }, additionalProperties: true },
    render: (_a, v) => text(`台账已生成：${v.path}`),
  },
  async execute(args, exec) {
    if (args.refresh !== false) {
      await runPython(['tools/load_db.py'], exec.signal)
      await runPython(['tools/load_evidence.py'], exec.signal)
      await runPython(['tools/load_sources.py'], exec.signal)
    }
    await runPython(['tools/export_workbench_excel.py'], exec.signal)
    return { path: `${PROJECT}/out/工作台导出/审计底稿台账.xlsx` }
  },
}

const statusTool = {
  name: 'audit_status',
  description: '查看全部客户的填表与勾稽状态：每家多少项一致、实质差异、列报差异、报表无此行、待取证数量，以及底稿包路径。',
  parameters: {
    type: 'object',
    properties: {
      company: { type: 'string', description: '只看某一家，省略则返回全部。' },
    },
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_a, v) => text((v.rows || []).map((r) =>
      `${r.company}：一致 ${r.checks?.ok ?? 0}，实质 ${r.checks?.sub ?? 0}，列报 ${r.checks?.pres ?? 0}，无此行 ${r.checks?.missing ?? 0}，待取证 ${r.evidence ?? 0}`).join('\n') || '无数据'),
  },
  async execute(args, exec) {
    await runPython(['tools/export_workbench.py'], exec.signal)
    const fsPath = `${PROJECT}/out/工作台导出/manifest.json`
    const { readFile } = await import('node:fs/promises')
    const manifest = JSON.parse(await readFile(fsPath, 'utf8'))
    let rows = manifest.companies || []
    if (args.company) rows = rows.filter((r) => r.company === args.company)
    return clean({ generated_at: manifest.generated_at, rows })
  },
}

const batchTool = {
  name: 'audit_fill_batch',
  description: '批量重跑已配置客户的底稿并刷新数据库与台账。省略 companies 时跑全部 12 家；耗时数分钟。',
  parameters: {
    type: 'object',
    properties: {
      companies: { type: 'array', items: { type: 'string' }, description: '只跑这些客户代码，省略则全部。' },
      refresh: { type: 'boolean', description: '跑完后刷新数据库与台账，默认 true。' },
    },
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_a, v) => text((v.results || []).join('\n') || '无结果'),
  },
  async execute(args, exec) {
    const results = []
    if (Array.isArray(args.companies) && args.companies.length) {
      for (const name of args.companies) {
        try {
          await runPython(['tools/run_company.py', name], exec.signal)
          results.push(`${name}: 完成`)
        } catch (e) {
          results.push(`${name}: 失败 ${String(e.message).slice(0, 200)}`)
        }
      }
    } else {
      try {
        const out = await runPython(['tools/run_all.py'], exec.signal)
        results.push(...out.trim().split(/\r?\n/).filter(Boolean).slice(-14))
      } catch (e) {
        results.push(`批量失败 ${String(e.message).slice(0, 300)}`)
      }
    }
    if (args.refresh !== false) {
      try { await runPython(['tools/load_db.py'], exec.signal) } catch { /* ignore */ }
      try { await runPython(['tools/export_workbench_excel.py'], exec.signal) } catch { /* ignore */ }
    }
    return clean({ results })
  },
}

const memoTool = {
  name: 'audit_memo',
  description: '为每家客户生成审计备忘录（资料来源、执行情况、未解决差异、待取证、是否可出具的结论），返回文件路径。',
  parameters: {
    type: 'object',
    properties: {
      company: { type: 'string', description: '只生成某一家，省略则全部 12 家。' },
    },
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_a, v) => text((v.memos || []).map((m) =>
      `${m.company}：${m.verdict}（${m.path}）`).join('\n') || '无'),
  },
  async execute(args, exec) {
    const out = await runPython(['tools/make_memo.py'], exec.signal)
    const data = lastJson(out)
    let memos = data.memos || []
    if (args.company) memos = memos.filter((m) => m.company === args.company)
    return clean({ memos })
  },
}

const workflowTool = {
  name: 'audit_workflow',
  description: '按审计流程给出每家客户所处阶段（资料接收→底稿填制→勾稽核对→差异处理→出具备忘录→复核→归档）和下一步动作。',
  parameters: {
    type: 'object',
    properties: {
      company: { type: 'string', description: '只看某一家，省略则全部。' },
    },
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_a, v) => text((v.workflow || []).map((w) =>
      `${w.company}｜阶段 ${w.stage} ${w.stage_name}｜下一步：${w.next}`).join('\n') || '无'),
  },
  async execute(args, exec) {
    const out = await runPython(['tools/workflow_status.py'], exec.signal)
    const data = lastJson(out)
    let wf = data.workflow || []
    if (args.company) wf = wf.filter((w) => w.company === args.company)
    return clean({ workflow: wf })
  },
}

const reviewTool = {
  name: 'audit_review',
  description: '登记或查看某家底稿的复核留痕：复核人、备注、时间，并快照当时的勾稽计数。复核后流程进入归档阶段。',
  parameters: {
    type: 'object',
    properties: {
      company: { type: 'string', description: '客户代码。' },
      reviewer: { type: 'string', description: '复核人；省略则只查看历史记录。' },
      note: { type: 'string', description: '复核备注。' },
    },
    required: ['company'],
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_a, v) => v.reviews
      ? text(`${v.company} 复核记录：\n` + v.reviews.map((r) => `${r.reviewed_at} ${r.reviewer}：${r.note}`).join('\n'))
      : text(`${v.company} 已登记复核：${v.reviewer}`),
  },
  async execute(args, exec) {
    const cmd = ['tools/review.py', '--company', args.company]
    if (args.reviewer) { cmd.push('--reviewer', args.reviewer); cmd.push('--note', args.note || '') }
    else cmd.push('--show')
    const out = await runPython(cmd, exec.signal)
    return clean(lastJson(out))
  },
}

export const inject = ['tools', 'systemPrompt', 'webServer']

const WORKFLOW_GUIDE = [
  '审计底稿能力按流程阶段使用：资料接收→底稿填制→勾稽核对→差异处理→出具备忘录→复核→归档。',
  '用户提到某家客户时，先 audit_workflow 看它处在哪一阶段，再按 next 动作执行，不要跳步。',
  '填表用 audit_fill_process；看差异用 audit_status；出备忘录用 audit_memo；复核用 audit_review；导台账用 audit_fill_ledger。',
  '差异分三类：实质差异（客户资料/口径，需补或确认）、列报差异（位置或总额净额，不追）、报表无此行（不算差异）。不要把列报差异说成错报。',
  '任何数字都要能追溯到科目/报表行/假设；缺资料就说缺，不要编。',
].join('\n')

// 前端数据接口契约：改前端时优先读接口，不把数据写死在 client.js
const API_GUIDE = [
  '前端工作台的数据全部来自本机接口（base：/api/audit-fill/），改前端时读接口，不硬编码数据：',
  '  GET  /api/audit-fill/program-tables           86 张程序表列表；?subject=货币资金 → 单张详情（审计目标5认定+实质性程序）',
  '  GET  /api/audit-fill/dict                     底稿表格字典（表名→索引号/表类/簿）；?prefix=ZA 按索引号前缀过滤',
  '  GET  /api/audit-fill/companies                已配置客户列表（含资料文件路径）',
  '  GET  /api/audit-fill/status                   全部公司勾稽状态',
  '  GET  /api/audit-fill/company?name=中天         单家：验数门禁 + 勾稽明细 + 填表明细',
  '  POST /api/audit-fill/run                      上传资料生成底稿（company/tb/fs，可带 voucher）',
  '改前端的完整方法见 auditdesk-design/ 手册（产品文档/开发文档/使用方法等）。',
].join('\n')

// 改前端的方法：agent 用原生 read/edit 文件工具改 client.js，让它读上面的接口
const FRONTEND_METHOD = [
  '改前端的方法（前端代码 = client.js，React + window.__ModuleLoader__）：',
  '  1. 前端代码在 ~/Documents/deepseek-harness/default-workspace/audit-workbench-dsh/client.js（权威源）；',
  '     运行中 harness 实际加载 ~/.dsh/profiles/desktop/node_modules/@local/dsh-audit-workbench/client.js（file: 副本，需同步）。',
  '  2. 数据一律 fetch /api/audit-fill/*（见 audit-api 接口清单），不把数据硬编码进 client.js。',
  '  3. 用 read 工具读 client.js 找要改的组件（CompaniesPage / 审计程序 zone），再用 edit / str_replace 改。',
  '  4. 改完用 bash 跑 node --check 验语法；前端刷新即生效（client.js 由 workbench 插件加载）。',
  '  5. 改前端的完整口径见 auditdesk-design/ 手册（产品文档 / 开发文档 / 使用方法 / 接口文档）。',
].join('\n')

const changesTool = {
  name: 'audit_changes',
  description: '查看底稿变动留痕：每次刷新数据库时，与上一版不同的单元格（工作簿/工作表/单元格/旧值/新值/时间）。',
  parameters: {
    type: 'object',
    properties: {
      company: { type: 'string', description: '只看某一家，省略则全部。' },
      limit: { type: 'integer', description: '最多返回条数，默认 50。' },
    },
    additionalProperties: false,
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_a, v) => text((v.changes || []).length
      ? v.changes.map((c) => `${c.changed_at} ${c.name} ${c.sheet}!${c.cell}: ${c.old_value} → ${c.new_value}`).join('\n')
      : '暂无变动记录'),
  },
  async execute(args, exec) {
    const cmd = ['tools/changes.py', '--limit', String(args.limit || 50)]
    if (args.company) cmd.push('--company', args.company)
    const out = await runPython(cmd, exec.signal)
    return clean(lastJson(out))
  },
}

const selfcheckTool = {
  name: 'audit_selfcheck',
  description: '回归自检：用真实客户文件校验关键解析结果（多币种、方向列、英文科目、工程施工等），返回通过/失败项。',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_a, v) => text(`自检：通过 ${v.ok}，失败 ${v.fail}\n` + (v.fails || []).join('\n')),
  },
  async execute(_args, exec) {
    let out = ''
    try {
      out = await runPython(['tools/selfcheck.py'], exec.signal)
    } catch (e) {
      out = String(e.message || e)
    }
    const lines = out.trim().split(/\r?\n/)
    const fails = lines.filter((l) => l.startsWith('[FAIL]'))
    const m = out.match(/通过 (\d+)，失败 (\d+)/)
    return clean({ ok: m ? Number(m[1]) : 0, fail: m ? Number(m[2]) : fails.length, fails })
  },
}

const clientsTool = {
  name: 'audit_clients',
  description: '列出客户与项目：每家客户下的项目（期间/业务类型）、所处阶段、已关联资料数量。',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_a, v) => text((v.clients || []).map((c) =>
      `${c.client}：` + (c.projects.map((p) => `${p.project}（${p.stage}，资料 ${p.files}）`).join('；') || '暂无项目')).join('\n') || '无客户'),
  },
  async execute(_args, exec) {
    const out = await runPython(['tools/projects.py', '--list'], exec.signal)
    return clean(lastJson(out))
  },
}

const projectCreateTool = {
  name: 'audit_project_create',
  description: '为客户新建一个审计项目（默认年报审计），客户不存在时自动创建。',
  parameters: {
    type: 'object',
    properties: {
      client: { type: 'string', description: '客户代码，如中天。' },
      period: { type: 'string', description: '会计期间，如 2026。' },
      engagement: { type: 'string', description: '业务类型，默认年报审计。' },
    },
    required: ['client', 'period'],
    additionalProperties: false,
  },
  output: { schema: { type: 'object', additionalProperties: true },
            render: (_a, v) => text(`已建项目：${v.project}（客户 ${v.client}）`) },
  async execute(args, exec) {
    const cmd = ['tools/projects.py', '--create', '--client', args.client, '--period', args.period]
    if (args.engagement) cmd.push('--engagement', args.engagement)
    return clean(lastJson(await runPython(cmd, exec.signal)))
  },
}

const projectAttachTool = {
  name: 'audit_project_attach',
  description: '给项目关联资料：科目余额表、财务报表、凭证（路径相对资料根目录）。',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: '项目代码，如 中天-2025。' },
      tb: { type: 'string', description: '科目余额表路径。' },
      fs: { type: 'string', description: '财务报表路径。' },
      voucher: { type: 'string', description: '凭证/序时账路径，可选。' },
    },
    required: ['project'],
    additionalProperties: false,
  },
  output: { schema: { type: 'object', additionalProperties: true },
            render: (_a, v) => text(`已关联：${v.project} 共 ${v.files} 个文件`) },
  async execute(args, exec) {
    const cmd = ['tools/projects.py', '--attach', '--project', args.project]
    for (const k of ['tb', 'fs', 'voucher']) if (args[k]) cmd.push('--' + k, args[k])
    return clean(lastJson(await runPython(cmd, exec.signal)))
  },
}

const projectRunTool = {
  name: 'audit_project_run',
  description: '按项目已关联的资料生成底稿，返回逐项勾稽，并把项目阶段推进到勾稽核对。',
  parameters: {
    type: 'object',
    properties: { project: { type: 'string', description: '项目代码，如 中天-2025。' } },
    required: ['project'],
    additionalProperties: false,
  },
  output: { schema: { type: 'object', additionalProperties: true },
            render: (_a, v) => text(`${v.project}：${v.summary}`) },
  async execute(args, exec) {
    const out = await runPython(['tools/projects.py', '--run', '--project', args.project], exec.signal)
    return clean(lastJson(out))
  },
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

// ===== 前端数据接口的公共工具 =====
function parseQuery(req) {
  const q = {}
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    for (const [k, v] of url.searchParams.entries()) q[k] = v
  } catch { /* ignore */ }
  return q
}

async function readJsonFile(file) {
  const { readFile } = await import('node:fs/promises')
  return JSON.parse(await readFile(file, 'utf8'))
}

async function readJsonFileOr(file, fallback) {
  try { return await readJsonFile(file) } catch { return fallback }
}

// 底稿包输出目录：优先带期间（out/<company>/<period>/底稿包），回退无期间
function packageDirs(company, period) {
  const base = path.join(PROJECT, 'out', company)
  const dirs = []
  if (period) dirs.push(path.join(base, String(period), '底稿包'))
  dirs.push(path.join(base, '底稿包'))
  return dirs
}

async function listCompanies() {
  const script = [
    'import json, sys',
    'sys.path.insert(0, "tools")',
    'import run_company',
    'print(json.dumps({"companies":[{"name":k,"tb":v[0],"fs":v[1],"voucher":v[2],"client":v[3]} for k,v in run_company.CASES.items()]}, ensure_ascii=False))',
  ].join('; ')
  const out = await runPython(['-c', script], undefined)
  return (lastJson(out).companies || [])
}

export function apply(ctx) {
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'audit-workflow',
    order: 60,
    text: () => WORKFLOW_GUIDE,
  }))
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'audit-api',
    order: 61,
    text: () => API_GUIDE,
  }))
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'audit-frontend',
    order: 62,
    text: () => FRONTEND_METHOD,
  }))
  ctx.effect(() => ctx.tools.register(processTool))
  ctx.effect(() => ctx.tools.register(listTool))
  ctx.effect(() => ctx.tools.register(ledgerTool))
  ctx.effect(() => ctx.tools.register(statusTool))
  ctx.effect(() => ctx.tools.register(batchTool))
  ctx.effect(() => ctx.tools.register(memoTool))
  ctx.effect(() => ctx.tools.register(workflowTool))
  ctx.effect(() => ctx.tools.register(reviewTool))
  ctx.effect(() => ctx.tools.register(changesTool))
  ctx.effect(() => ctx.tools.register(selfcheckTool))
  ctx.effect(() => ctx.tools.register(clientsTool))
  ctx.effect(() => ctx.tools.register(projectCreateTool))
  ctx.effect(() => ctx.tools.register(projectAttachTool))
  ctx.effect(() => ctx.tools.register(projectRunTool))

  // 同源接口：客户与项目页面的「生成底稿」按钮调用本机引擎
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/audit-fill/run',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
      let body
      try { body = await readJson(req) } catch (e) { return sendJson(res, 400, { ok: false, error: 'bad json' }) }
      const { company, client, period, tb, fs, voucher, project: gwProject, token } = body || {}
      if (!company || !tb || !fs) return sendJson(res, 400, { ok: false, error: 'company/tb/fs required' })
      const os = await import('node:os')
      const path = await import('node:path')
      const fsp = await import('node:fs/promises')
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'auditfill-'))
      async function write(name, file) {
        if (!file || !file.data) return null
        const target = path.join(dir, name)
        await fsp.writeFile(target, Buffer.from(file.data, 'base64'))
        return target
      }
      try {
        const tbPath = await write('tb' + (path.extname(tb.name || '') || '.xlsx'), tb)
        const fsPath = await write('fs' + (path.extname(fs.name || '') || '.xlsx'), fs)
        const voucherPath = voucher ? await write('voucher' + (path.extname(voucher.name || '') || '.xlsx'), voucher) : null
        const outDir = path.join(PROJECT, 'out', company, String(period || '2025'), '底稿包')
        const args = ['-m', 'auditfill.workbench', '--company', company, '--tb', tbPath, '--fs', fsPath,
                      '--client', client || company, '--out', outDir]
        if (voucherPath) args.push('--voucher', voucherPath)
        const out = await runPython(args, undefined)
        const data = lastJson(out)
        const lines = (data.lines || []).map(clean)
        let uploaded = 0
        const uploadErrors = []
        if (gwProject && token) {
          await resolveGateway()
          const dir = data.outputs && data.outputs.package_dir
          const master = data.outputs && data.outputs.master
          const names = []
          if (dir) {
            try {
              for (const f of await fsp.readdir(dir)) if (f.endsWith('.xlsx')) names.push([path.join(dir, f), f])
            } catch (e) { uploadErrors.push(String(e && e.message || e)) }
          }
          if (master) names.push([master, path.basename(master)])
          for (const [file, name] of names) {
            try {
              const buf = await fsp.readFile(file)
              const kind = name.replace(/\.xlsx$/, '').replace(/2025/g, '').trim()
              const url = `${GATEWAY}/audit/workpapers/upload?project=${encodeURIComponent(gwProject)}&kind=${encodeURIComponent(kind)}&filename=${encodeURIComponent(name)}`
              const r = await fetch(url, { method: 'POST', headers: { 'X-KB-Token': token, 'Content-Type': 'application/octet-stream' }, body: buf })
              if (r.ok) uploaded += 1
              else uploadErrors.push(`${name}: HTTP ${r.status}`)
            } catch (e) { uploadErrors.push(`${name}: ${String(e && e.message || e)}`) }
          }
        }
        return sendJson(res, 200, clean({
          ok: !!data.ok, company,
          lines,
          outputs: data.outputs,
          uploaded,
          upload_errors: uploadErrors.slice(0, 5),
          summary: summarize ? summarize(data) : '',
        }))
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: String(e && e.message || e) })
      } finally {
        try { await fsp.rm(dir, { recursive: true, force: true }) } catch {}
      }
    },
  }))

  // ===== 前端数据接口（前端 client.js 直接读这些接口，后端只管把数据备齐）=====

  // 86 张程序表：列表（轻量）或详情（?subject=货币资金）
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/audit-fill/program-tables',
    handler: async (req, res) => {
      try {
        const q = parseQuery(req)
        const programs = await readJsonFile(path.join(PROJECT, 'data', 'program_tables.json'))
        if (q.subject) {
          const p = programs[q.subject]
          if (!p) return sendJson(res, 404, { ok: false, error: 'subject not found: ' + q.subject })
          return sendJson(res, 200, { ok: true, program: p })
        }
        const subjects = Object.entries(programs).map(([subject, p]) => ({
          subject,
          idx: p.idx,
          proj: p.proj,
          objective_count: (p.objectives || []).length,
          proc_count: (p.procs || []).length,
        }))
        sendJson(res, 200, { ok: true, count: subjects.length, subjects })
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String(e && e.message || e) })
      }
    },
  }))

  // 底稿表格字典（表名→索引号/表类/簿），供「程序表→附表」连线；?prefix=ZA 按索引号前缀过滤
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/audit-fill/dict',
    handler: async (req, res) => {
      try {
        const q = parseQuery(req)
        const dict = await readJsonFile(path.join(PROJECT, 'data', '底稿表格字典.json'))
        if (q.prefix) {
          const pre = String(q.prefix)
          const filtered = {}
          for (const [k, v] of Object.entries(dict)) {
            if (k.startsWith(pre) || String(v['索引号'] || '').startsWith(pre)) filtered[k] = v
          }
          return sendJson(res, 200, { ok: true, count: Object.keys(filtered).length, dict: filtered })
        }
        sendJson(res, 200, { ok: true, count: Object.keys(dict).length, dict })
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String(e && e.message || e) })
      }
    },
  }))

  // 已配置客户列表（CASES，含资料文件路径）
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/audit-fill/companies',
    handler: async (_req, res) => {
      try {
        const companies = await listCompanies()
        sendJson(res, 200, { ok: true, count: companies.length, companies })
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String(e && e.message || e) })
      }
    },
  }))

  // 全部公司勾稽状态（来自工作台导出 manifest.json）
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/audit-fill/status',
    handler: async (_req, res) => {
      try {
        const m = await readJsonFileOr(path.join(PROJECT, 'out', '工作台导出', 'manifest.json'), { companies: [] })
        sendJson(res, 200, { ok: true, generated_at: m.generated_at, rows: m.companies || [] })
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String(e && e.message || e) })
      }
    },
  }))

  // 某家公司的门禁 + 勾稽明细 + 填表明细（?name=中天&period=2025）
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/audit-fill/company',
    handler: async (req, res) => {
      try {
        const q = parseQuery(req)
        if (!q.name) return sendJson(res, 400, { ok: false, error: 'name required' })
        const name = q.name
        const { existsSync } = await import('node:fs')
        let gate = null
        let lines = []
        let workbooks = []
        for (const d of packageDirs(name, q.period)) {
          const reportPath = path.join(d, '校验报告.json')
          if (existsSync(reportPath)) {
            const r = await readJsonFile(reportPath)
            gate = r.gate || null
            lines = r.lines || []
            workbooks = r.workbooks || []
            break
          }
        }
        if (!gate) {
          for (const d of packageDirs(name, q.period)) {
            const gatePath = path.join(d, '验数门禁.json')
            if (existsSync(gatePath)) { const g = await readJsonFile(gatePath); gate = g.gate || g; break }
          }
        }
        const m = await readJsonFileOr(path.join(PROJECT, 'out', '工作台导出', 'manifest.json'), { companies: [] })
        const status = (m.companies || []).find((c) => c.company === name) || null
        sendJson(res, 200, { ok: true, name, gate, status, lines, workbooks })
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String(e && e.message || e) })
      }
    },
  }))

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/audit-fill/health',
    handler: (_req, res) => sendJson(res, 200, { ok: true, service: 'audit-fill', project: PROJECT }),
  }))
}
