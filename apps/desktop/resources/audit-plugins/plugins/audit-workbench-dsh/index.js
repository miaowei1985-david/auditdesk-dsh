/**
 * @local/dsh-audit-workbench Host 侧：
 * 注册 /audit-project 命令，为「公司 / 项目」创建本地目录并注册 DSH Workspace，
 * 让侧栏会话按公司/项目分组。客户端在创建项目对话前调用该命令。
 */
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const inject = ['commands', 'workspaceController']

const COMMAND_NAME = 'audit-project'
const BASE_DIR = 'AuditDeskProjects'

function safeName(value) {
  return String(value || 'project').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
}

function splitInput(rawInput) {
  const text = String(rawInput || '').trim()
  const [company, project] = text.split('|').map(part => part.trim())
  return { company: company || '', project: project || '' }
}

export function apply(ctx) {
  ctx.commands.register({
    name: COMMAND_NAME,
    description: '创建/复用审计项目工作区（参数：公司|项目）',
    recordInput: false,
    handler: async (invocation) => {
      const { company, project } = splitInput(invocation.rawInput)
      if (!company) return { kind: 'error', text: '缺少公司名称，用法：/audit-project 公司|项目' }
      const title = project ? `${company} / ${project}` : company
      const dir = join(homedir(), BASE_DIR, safeName(company), safeName(project || 'project'))
      try {
        await mkdir(dir, { recursive: true })
      } catch (error) {
        return { kind: 'error', text: `创建目录失败：${dir}：${String(error)}` }
      }
      try {
        const created = await ctx.workspaceController.create({ path: dir })
        const workspace = created && created.workspace ? created.workspace : created
        if (workspace && workspace.workspaceId && workspace.title !== title) {
          try {
            await ctx.workspaceController.rename({ workspaceId: workspace.workspaceId, title })
          } catch (error) {
            // 同名冲突等不影响使用，保留默认标题
          }
        }
        return { kind: 'success', text: `项目工作区已就绪：${title}（${dir}）` }
      } catch (error) {
        return { kind: 'error', text: `注册工作区失败：${String(error)}` }
      }
    },
  })
}
