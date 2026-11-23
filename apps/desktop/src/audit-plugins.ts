/** Install the bundled AuditDesk plugins into the Electron-owned desktop profile. */
import { execFile } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
let logPath = ''
function log(message: string): void {
  if (!logPath) return
  try { appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`) } catch { /* best effort */ }
}
const PLUGIN_NAMES = ['audit-workbench-dsh', 'audit-kb-dsh', 'audit-p0-dsh', 'audit-event-auditor-dsh', 'audit-excel-plugin'] as const

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

function readManifest(path: string): ProfileManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as ProfileManifest
}

function writeManifest(path: string, manifest: ProfileManifest): void {
  writeFileSync(path, `${JSON.stringify(manifest, undefined, 2)}\n`, { mode: 0o600 })
}

/**
 * Copy bundled audit plugins into the user's DSH home, install them as `file:`
 * dependencies of the desktop profile, and add them to `dsh.profile.bundles`.
 * Idempotent; a missing bundle directory or a failed install is logged, never fatal.
 * @param profileDir - Electron-owned desktop profile directory (`<dshHome>/profiles/desktop`).
 * @param resourcesPath - Electron `process.resourcesPath` containing `audit-plugins/plugins`.
 * @param dshCli - bundled `dsh` executable used to run `dsh plugin add`.
 * @returns true when the profile ended up with every audit bundle enabled.
 */
export async function ensureAuditPlugins(profileDir: string, resourcesPath: string, dshCli: string): Promise<boolean> {
  const sourceRoot = join(resourcesPath, 'audit-plugins', 'plugins')
  const manifestPath = join(profileDir, 'package.json')
  if (!existsSync(sourceRoot) || !existsSync(manifestPath)) {
    console.info('audit plugins: bundled plugins or desktop profile missing; skipped')
    return false
  }

  const dshHome = join(profileDir, '..', '..')
  logPath = join(dshHome, 'audit-plugins-bootstrap.log')
  log(`bootstrap start resources=${sourceRoot} profile=${profileDir}`)
  const targetRoot = join(dshHome, 'plugins', 'auditdesk')
  mkdirSync(targetRoot, { recursive: true })

  const plugins: Array<{ directory: string; name: string; target: string }> = []
  for (const directory of PLUGIN_NAMES) {
    const source = join(sourceRoot, directory)
    if (!existsSync(join(source, 'package.json'))) continue
    const target = join(targetRoot, directory)
    try {
      rmSync(target, { recursive: true, force: true })
      cpSync(source, target, { recursive: true })
    } catch (error) {
      log(`copy ${directory} failed: ${String(error)}`)
      throw error
    }
    const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as { name?: string }
    if (typeof pkg.name === 'string') plugins.push({ directory, name: pkg.name, target })
  }
  if (plugins.length === 0) return false
  const names = plugins.map(plugin => plugin.name)

  let manifest = readManifest(manifestPath)
  const installed = new Set(Object.keys(manifest.dependencies ?? {}))
  const needsInstall = names.filter(name => !installed.has(name))
  const env = { ...process.env, DSH_HOME: dshHome }
  for (const plugin of plugins.filter(item => needsInstall.includes(item.name))) {
    const spec = `file:${plugin.target}`
    if (process.platform === 'win32') {
      // .cmd shims cannot be spawned directly. Write a tiny batch file with fully
      // quoted paths instead of relying on nested cmd.exe quoting.
      const batchPath = join(targetRoot, `.install-${plugin.directory}-${Date.now()}.cmd`)
      try {
        writeFileSync(batchPath, `@echo off\r\ncall "${dshCli}" plugin --profile desktop add "${spec}"\r\n`, 'utf8')
        await run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', batchPath], { env, timeout: 180_000, windowsHide: true })
        log(`plugin add ok (win): ${plugin.name}`)
      } catch (error) { log(`plugin add failed (win): ${plugin.name}: ${String(error)}`); throw error }
      finally { try { rmSync(batchPath, { force: true }) } catch { /* best effort */ } }
    } else {
      try {
        await run(dshCli, ['plugin', '--profile', 'desktop', 'add', spec], { env, timeout: 180_000, windowsHide: true })
        log(`plugin add ok: ${plugin.name}`)
      } catch (error) { log(`plugin add failed: ${plugin.name}: ${String(error)}`); throw error }
    }
  }

  // Fallback: materialize packages into profile node_modules even if pnpm add failed,
  // so bundle resolution still finds them on the next launch.
  const modulesRoot = join(profileDir, 'node_modules')
  manifest = readManifest(manifestPath)
  for (const plugin of plugins) {
    const destination = join(modulesRoot, ...plugin.name.split('/'))
    if (existsSync(destination)) continue
    try {
      mkdirSync(join(destination, '..'), { recursive: true })
      cpSync(plugin.target, destination, { recursive: true })
      manifest.dependencies ??= {}
      manifest.dependencies[plugin.name] = `file:${plugin.target}`
      log(`fallback copied ${plugin.name} to profile node_modules`)
    } catch (error) {
      log(`fallback copy failed ${plugin.name}: ${String(error)}`)
    }
  }
  writeManifest(manifestPath, manifest)

  manifest = readManifest(manifestPath)
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const missing = names.filter(name => !bundles.includes(name))
  if (missing.length > 0) {
    manifest.dsh ??= { profile: { bundles: [] } }
    manifest.dsh.profile ??= { bundles: [] }
    manifest.dsh.profile.bundles = [...bundles, ...missing]
    writeManifest(manifestPath, manifest)
  }
  const finalBundles = new Set(readManifest(manifestPath).dsh?.profile?.bundles ?? [])
  const present = names.every(name => finalBundles.has(name))
  log(`bootstrap done present=${present} bundles=${[...finalBundles].join(',')}`)
  console.info(`audit plugins: ${present ? 'ready' : 'incomplete'} (${names.join(', ')})`)
  return present
}
