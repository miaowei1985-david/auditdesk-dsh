/**
 * audit-p0 Host 插件：把本地 `python3 -m audit_p0` 审计 CLI 暴露为 5 个模型工具。
 *
 * 设计约束：
 * - 只做确定性计算与结果整理，不生成审计结论；结论需人工复核。
 * - 每次调用以 `config.repoPath` 为 cwd 执行
 *   `<pythonPath> -m audit_p0 --db <dbPath> <command> [args] --json`。
 * - CLI stdout 必须是单个 JSON 对象；所有失败都转换为 HarnessError，避免未捕获异常。
 *
 * @module @local/dsh-audit-p0
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { HarnessError } from '@deepseek-ai/dsh-error'
import { defineTool, ToolArgsError } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'

/** Cordis 插件名。 */
export const name = 'audit-p0-tools'

/** 工具注册表就绪后再注册工具。 */
export const inject = ['tools']

/** audit-p0 仓库默认目录。 */
export const DEFAULT_REPO_PATH = '/Users/macbook/Documents/deepseek-harness/default-workspace/audit-p0'

/** CLI 默认超时（毫秒）。 */
export const DEFAULT_TIMEOUT_MS = 120000

/** 单次 CLI 调用允许的最大 stdout（32 MiB）。 */
const MAX_BUFFER_BYTES = 32 * 1024 * 1024

/** 插件配置；默认值写在 Schemastery schema 中，缺省字段由 Cordis 填充。 */
export const Config = Schema.object({
  repoPath: Schema.string()
    .default(DEFAULT_REPO_PATH)
    .description('audit-p0 仓库根目录，同时作为 CLI 进程的 cwd；必须包含 audit_p0 Python 包。'),
  pythonPath: Schema.string()
    .default('python3')
    .description('Python 解释器，可传绝对路径（虚拟环境）或 PATH 中的命令名。'),
  dbPath: Schema.string()
    .default('')
    .description('审计数据库路径；留空时使用 <repoPath>/data/audit.db。'),
  timeoutMs: Schema.number()
    .default(DEFAULT_TIMEOUT_MS)
    .description('单次 CLI 调用的超时时间（毫秒），超时后 CLI 进程被终止并返回错误。'),
})

/** CLI 进程内的预期失败；code 供重试策略与 UI 路由，message 给模型阅读。 */
class AuditP0CliError extends HarnessError {
  /**
   * @param {string} message 面向人的失败说明。
   * @param {string} code 稳定的 UPPER_SNAKE_CASE 失败码。
   * @param {ErrorOptions} [options] 可选 cause。
   */
  constructor(message, code, options) {
    super(message, code, options)
    this.name = 'AuditP0CliError'
  }
}

/** 工具描述统一结尾：强调确定性计算与人工复核。 */
const REVIEW_NOTICE = '本工具只做确定性计算，不生成审计结论；结论需人工复核。'

/** 公司代码参数。 */
const companyParameter = {
  type: 'string',
  required: true,
  description: '公司代码，与被审计单位数据中的 company 字段一致（例如 DEMO）。',
}

/** 会计期间参数。 */
const periodParameter = {
  type: 'string',
  required: true,
  description: '会计期间，与数据中的 period 字段一致（例如 2025 或 2025-12-31）。',
}

/**
 * 渲染模型可见内容：中文摘要 + 完整原始 JSON。
 * @param {unknown} payload CLI 返回的 JSON 对象。
 * @param {string[]} summaryLines 中文摘要行。
 * @returns {Array<{ type: 'text', text: string }>} 内容块。
 */
function renderPayload(payload, summaryLines) {
  let raw
  try {
    raw = JSON.stringify(payload)
  } catch {
    raw = '"[unserializable]"'
  }
  const lines = [...summaryLines.filter(line => typeof line === 'string' && line.length > 0), '', `原始 JSON：${raw}`, `提示：${REVIEW_NOTICE}`]
  return [{ type: 'text', text: lines.join('\n') }]
}

/**
 * 把任意 JSON 值格式化为一段可读文本（不抛异常）。
 * @param {unknown} value 任意值。
 * @returns {string} 可读文本。
 */
function display(value) {
  if (value === undefined) return '未知'
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable]'
  }
}

/**
 * 取数组并限制条目数。
 * @param {unknown} value 候选数组。
 * @returns {unknown[]} 数组或空数组。
 */
function asArray(value) {
  return Array.isArray(value) ? value : []
}

/**
 * 取普通对象。
 * @param {unknown} value 候选对象。
 * @returns {Record<string, unknown>} 对象或空对象。
 */
function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}
}

/**
 * 校验非空字符串参数。
 * @param {unknown} value 模型输入。
 * @param {string} field 参数名。
 * @returns {string} 去除首尾空白的值。
 */
function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolArgsError([`${field} 不能为空`])
  }
  return value.trim()
}

/**
 * 校验 0-100 的百分比数值参数。
 * 工具参数使用百分比语义（5 表示 5%）；调用 CLI 前再换算为小数比例（0.05）。
 * @param {unknown} value 模型输入。
 * @param {string} field 参数名。
 * @returns {number} 校验后的百分比数值。
 */
function requirePercentage(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new ToolArgsError([`${field} 必须是 0 到 100 之间的百分比数值（如 5 表示 5%）`])
  }
  return value
}

/**
 * 校验正整数参数。
 * @param {unknown} value 模型输入。
 * @param {string} field 参数名。
 * @returns {number} 校验后的整数。
 */
function requirePositiveInteger(value, field) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ToolArgsError([`${field} 必须是正整数`])
  }
  return value
}

/**
 * 校验整数参数。
 * @param {unknown} value 模型输入。
 * @param {string} field 参数名。
 * @returns {number} 校验后的整数。
 */
function requireInteger(value, field) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ToolArgsError([`${field} 必须是整数`])
  }
  return value
}

/**
 * 执行一次 audit_p0 CLI 调用并解析 JSON。
 * @param {object} settings 已解析的插件设置。
 * @param {string} settings.repoPath CLI cwd。
 * @param {string} settings.pythonPath Python 解释器。
 * @param {string} settings.dbPath 数据库路径。
 * @param {number} settings.timeoutMs 超时时间。
 * @param {string} command CLI 子命令。
 * @param {string[]} commandArgs 子命令参数（不含 --json）。
 * @param {{ signal: AbortSignal }} exec 工具执行上下文。
 * @returns {Promise<Record<string, unknown>>} CLI 返回的 JSON 对象。
 */
async function runCli(settings, command, commandArgs, exec) {
  if (!existsSync(settings.repoPath)) {
    throw new AuditP0CliError(
      `repoPath 不存在：${settings.repoPath}。请把插件配置 repoPath 指向 audit-p0 仓库根目录。`,
      'AUDIT_P0_REPO_PATH_MISSING',
    )
  }
  if (typeof settings.pythonPath !== 'string' || settings.pythonPath.trim() === '') {
    throw new AuditP0CliError(
      'pythonPath 为空。请在插件配置中指定可用的 Python 解释器（默认 python3）。',
      'AUDIT_P0_PYTHON_MISSING',
    )
  }
  const args = ['-m', 'audit_p0', '--db', settings.dbPath, command, ...commandArgs, '--json']
  const commandLine = `${settings.pythonPath} ${args.join(' ')}`

  return await new Promise((resolve, reject) => {
    execFile(settings.pythonPath, args, {
      cwd: settings.repoPath,
      timeout: settings.timeoutMs,
      maxBuffer: MAX_BUFFER_BYTES,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      signal: exec.signal,
    }, (error, stdout, stderr) => {
      const stdoutText = typeof stdout === 'string' ? stdout.trim() : ''
      const stderrText = typeof stderr === 'string' ? stderr.trim() : ''

      if (error) {
        // 让调用方取消保持 AbortError/ABORTED 语义，不包装成普通错误。
        if (error.name === 'AbortError' || error.code === 'ABORT_ERR') {
          reject(error)
          return
        }

        // CLI 约定：失败时 stdout 仍是单个 JSON：{"ok":false,"error":"..."}。
        let reported
        try {
          reported = JSON.parse(stdoutText)
        } catch {
          reported = undefined
        }
        if (typeof reported === 'object' && reported !== null && reported.ok === false && typeof reported.error === 'string') {
          reject(new AuditP0CliError(
            `audit_p0 ${command} 返回失败：${reported.error}（命令：${commandLine}）`,
            'AUDIT_P0_CLI_REPORTED_ERROR',
          ))
          return
        }

        if (error.killed === true && (error.signal !== null && error.signal !== undefined)) {
          reject(new AuditP0CliError(
            `audit_p0 ${command} 超过 ${settings.timeoutMs}ms 未完成，进程已被终止（signal=${error.signal}；命令：${commandLine}）。`,
            'AUDIT_P0_TIMEOUT',
          ))
          return
        }

        if (error.code === 'ENOENT') {
          reject(new AuditP0CliError(
            `找不到 Python 解释器 ${JSON.stringify(settings.pythonPath)}（cwd=${settings.repoPath}）。请检查插件配置 pythonPath，或先在仓库内执行 pip install -r requirements.txt。`,
            'AUDIT_P0_PYTHON_NOT_FOUND',
            { cause: error },
          ))
          return
        }

        if (error.code === 'EACCES') {
          reject(new AuditP0CliError(
            `Python 解释器 ${JSON.stringify(settings.pythonPath)} 不可执行（EACCES）。请检查文件权限或改用绝对路径。`,
            'AUDIT_P0_PYTHON_NOT_EXECUTABLE',
            { cause: error },
          ))
          return
        }

        if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          reject(new AuditP0CliError(
            `audit_p0 ${command} 的 stdout 超过 ${MAX_BUFFER_BYTES} 字节上限，已终止。请缩小查询范围。`,
            'AUDIT_P0_OUTPUT_TOO_LARGE',
            { cause: error },
          ))
          return
        }

        const detail = stderrText !== '' ? stderrText : (stdoutText !== '' ? stdoutText : error.message)
        reject(new AuditP0CliError(
          `audit_p0 ${command} 退出码 ${display(error.code)}：${detail}（命令：${commandLine}）`,
          'AUDIT_P0_EXIT_NONZERO',
          { cause: error },
        ))
        return
      }

      let payload
      try {
        payload = JSON.parse(stdoutText === '' ? 'null' : stdoutText)
      } catch (cause) {
        reject(new AuditP0CliError(
          `audit_p0 ${command} 的 stdout 不是合法 JSON：${stdoutText.slice(0, 500) || '(空)'}`,
          'AUDIT_P0_INVALID_JSON',
          { cause },
        ))
        return
      }

      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        reject(new AuditP0CliError(
          `audit_p0 ${command} 返回的 JSON 不是对象：${stdoutText.slice(0, 500) || '(空)'}`,
          'AUDIT_P0_INVALID_JSON',
        ))
        return
      }

      if (payload.ok !== true) {
        const reason = typeof payload.error === 'string' ? payload.error : 'CLI 未返回 ok:true'
        reject(new AuditP0CliError(
          `audit_p0 ${command} 返回失败：${reason}（命令：${commandLine}）`,
          'AUDIT_P0_CLI_REPORTED_ERROR',
        ))
        return
      }

      resolve(payload)
    })
  })
}

/**
 * 注册 audit-p0 的 5 个工具。
 * @param {import('@deepseek-ai/cordis').Context} ctx Cordis 上下文。
 * @param {object} config 已按 Config 校验的插件配置。
 */
export function apply(ctx, config) {
  /** 解析后的设置；dbPath 的动态默认值在此按 repoPath 计算。 */
  const settings = {
    repoPath: config.repoPath,
    pythonPath: config.pythonPath,
    dbPath: typeof config.dbPath === 'string' && config.dbPath.trim() !== ''
      ? config.dbPath.trim()
      : join(config.repoPath, 'data', 'audit.db'),
    timeoutMs: config.timeoutMs,
  }

  ctx.tools.register(defineTool({
    name: 'audit_tb',
    description: '读取被审计单位的科目表（试算平衡表）：返回科目、期末借贷方发生额/余额与借贷合计。用于了解报表结构、执行分析性程序前的数据准备。' + REVIEW_NOTICE,
    parameters: {
      company: companyParameter,
      period: periodParameter,
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        const payload = asRecord(value)
        const accounts = asArray(payload.accounts)
        const totals = asRecord(payload.totals)
        return renderPayload(payload, [
          `科目表（试算平衡表）：公司 ${display(payload.company)}，期间 ${display(payload.period)}。`,
          `科目 ${accounts.length} 个；借方合计 ${display(totals.debit)}，贷方合计 ${display(totals.credit)}。`,
        ])
      },
    },
    async execute(args, exec) {
      const company = requireText(args.company, 'company')
      const period = requireText(args.period, 'period')
      return await runCli(settings, 'tb', ['--company', company, '--period', period], exec)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'audit_materiality',
    description: '按指定基准与比率计算整体重要性、执行重要性和明显微小错报临界值，并返回备选基准计算结果。基准选择与比率属于审计判断输入，由调用方明确提供；rate/performance/trivial 按 0-100 的百分比数值传入（如 5 表示 5%），工具内部换算为小数比例后调用 CLI。' + REVIEW_NOTICE,
    parameters: {
      company: companyParameter,
      period: periodParameter,
      benchmark: {
        type: 'string',
        required: true,
        enum: ['pbt', 'revenue', 'assets'],
        description: '重要性基准：pbt（税前利润）、revenue（营业收入）或 assets（资产总额）。',
      },
      rate: {
        type: 'number',
        required: true,
        description: '整体重要性占基准的百分比（0-100，如 5 表示 5%）。工具内部除以 100 后传给 CLI；越界抛参数错误。',
      },
      performance: {
        type: 'number',
        required: true,
        description: '执行重要性占整体重要性的百分比（0-100，如 75 表示 75%）。工具内部除以 100 后传给 CLI；越界抛参数错误。',
      },
      trivial: {
        type: 'number',
        required: true,
        description: '明显微小错报临界值占整体重要性的百分比（0-100，如 5 表示 5%）。工具内部除以 100 后传给 CLI；越界抛参数错误。',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        const payload = asRecord(value)
        return renderPayload(payload, [
          `重要性水平：公司 ${display(payload.company)}，期间 ${display(payload.period)}；基准 ${display(payload.benchmark)}，基准值 ${display(payload.benchmark_value)}，比率 ${display(payload.rate)}。`,
          `整体重要性 ${display(payload.materiality)}；执行重要性 ${display(payload.performance_materiality)}；明显微小错报临界值 ${display(payload.trivial_threshold)}。`,
          `备选基准计算结果 ${asArray(payload.alternatives).length} 项；计算说明：${display(payload.calculation)}`,
        ])
      },
    },
    async execute(args, exec) {
      const company = requireText(args.company, 'company')
      const period = requireText(args.period, 'period')
      const rate = requirePercentage(args.rate, 'rate')
      const performance = requirePercentage(args.performance, 'performance')
      const trivial = requirePercentage(args.trivial, 'trivial')
      // CLI 契约接收小数比例（0.05 = 5%），工具参数接收百分比（5 = 5%）。
      return await runCli(settings, 'materiality', [
        '--company', company,
        '--period', period,
        '--benchmark', args.benchmark,
        '--rate', String(rate / 100),
        '--performance', String(performance / 100),
        '--trivial', String(trivial / 100),
      ], exec)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'audit_sample',
    description: '按货币单位抽样（MUS）从凭证总体中确定样本量与样本，返回总体规模、抽样间隔、覆盖率与选中凭证明细。用于细节测试的样本选取。' + REVIEW_NOTICE,
    parameters: {
      company: companyParameter,
      period: periodParameter,
      method: {
        type: 'string',
        enum: ['mus'],
        default: 'mus',
        description: '抽样方法；当前契约只支持 mus（货币单位抽样），省略时按 mus 处理。',
      },
      size: {
        type: 'integer',
        required: true,
        description: '计划样本量，必须是正整数。',
      },
      seed: {
        type: 'integer',
        required: true,
        description: '随机种子（整数），用于复现同一组样本。',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        const payload = asRecord(value)
        const population = asRecord(payload.population)
        const selected = asArray(payload.selected)
        return renderPayload(payload, [
          `抽样（MUS）：公司 ${display(payload.company)}，期间 ${display(payload.period)}；方法 ${display(payload.method)}，种子 ${display(payload.seed)}。`,
          `总体 ${display(population.count)} 笔、金额 ${display(population.value)}；样本量 ${display(payload.sample_size)}，抽样间隔 ${display(payload.interval)}，覆盖率 ${display(payload.coverage)}，达到计划样本量：${payload.met === true ? '是' : '否'}。`,
          `已选样本 ${selected.length} 笔。`,
        ])
      },
    },
    async execute(args, exec) {
      const company = requireText(args.company, 'company')
      const period = requireText(args.period, 'period')
      const method = args.method ?? 'mus'
      if (method !== 'mus') throw new ToolArgsError(['method 目前只支持 mus'])
      const size = requirePositiveInteger(args.size, 'size')
      const seed = requireInteger(args.seed, 'seed')
      return await runCli(settings, 'sample', [
        '--company', company,
        '--period', period,
        '--method', method,
        '--size', String(size),
        '--seed', String(seed),
      ], exec)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'audit_tieout',
    description: '执行账表勾稽检查：核对科目表、凭证与报告数据之间的一致性，返回逐项检查结果与按严重程度分级的发现。用于识别数据层面的错报风险线索。' + REVIEW_NOTICE,
    parameters: {
      company: companyParameter,
      period: periodParameter,
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        const payload = asRecord(value)
        const checks = asArray(payload.checks)
        const findings = asArray(payload.findings)
        const failedChecks = checks.filter(check => asRecord(check).passed !== true)
        const findingLines = findings.slice(0, 5).map((finding) => {
          const item = asRecord(finding)
          return `- [${display(item.severity)}] ${display(item.code)}：${display(item.message)}`
        })
        return renderPayload(payload, [
          `账表勾稽：公司 ${display(payload.company)}，期间 ${display(payload.period)}；总体结果 ${payload.passed === true ? '通过' : '未通过'}。`,
          `检查 ${checks.length} 项（未通过 ${failedChecks.length} 项）；发现 ${findings.length} 条${findings.length > findingLines.length ? `（仅列前 ${findingLines.length} 条，完整内容见原始 JSON）` : ''}。`,
          ...findingLines,
        ])
      },
    },
    async execute(args, exec) {
      const company = requireText(args.company, 'company')
      const period = requireText(args.period, 'period')
      return await runCli(settings, 'tieout', ['--company', company, '--period', period], exec)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'audit_run',
    description: '按给定参数一次性运行完整风险评估底稿流程：计算重要性、执行抽样与勾稽检查，并写出工作底稿文件。返回各阶段结果、底稿文件清单与引用清单。用于生成可复核的底稿材料。' + REVIEW_NOTICE,
    parameters: {
      company: companyParameter,
      period: periodParameter,
      out: {
        type: 'string',
        required: true,
        description: '工作底稿输出目录；相对路径按 repoPath 解析，目录不存在时由 CLI 创建。',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        const payload = asRecord(value)
        const materiality = asRecord(payload.materiality)
        const sampling = asRecord(payload.sampling)
        const tieout = asRecord(payload.tieout)
        const workpapers = asRecord(payload.workpapers)
        const files = asArray(workpapers.files)
        const citations = asArray(workpapers.citations)
        const fileLines = files.slice(0, 10).map((file) => {
          const item = asRecord(file)
          return `- ${display(item.title)}：${display(item.path)}`
        })
        return renderPayload(payload, [
          `风险评估底稿运行完成：公司 ${display(payload.company)}，期间 ${display(payload.period)}。`,
          `整体重要性 ${display(materiality.materiality)}；抽样样本量 ${display(sampling.sample_size)}；勾稽结果 ${tieout.passed === true ? '通过' : '未通过'}。`,
          `工作底稿 ${files.length} 个${files.length > fileLines.length ? `（仅列前 ${fileLines.length} 个，完整清单见原始 JSON）` : ''}：`,
          ...fileLines,
          `引用 ${citations.length} 条。`,
        ])
      },
    },
    async execute(args, exec) {
      const company = requireText(args.company, 'company')
      const period = requireText(args.period, 'period')
      const out = requireText(args.out, 'out')
      return await runCli(settings, 'run', ['--company', company, '--period', period, '--out', out], exec)
    },
  }))
}
