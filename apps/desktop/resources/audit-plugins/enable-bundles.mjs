#!/usr/bin/env node
// 把审计插件加入 desktop profile 的 dsh.profile.bundles（install-* 脚本调用）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const manifestPath = process.argv[2]
const names = ['@local/dsh-audit-workbench', '@local/dsh-audit-kb', '@local/dsh-audit-p0']
if (!manifestPath || !existsSync(manifestPath)) {
  console.error('用法：node enable-bundles.mjs <profile/package.json>')
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.dsh ??= {}
manifest.dsh.profile ??= {}
manifest.dsh.profile.bundles ??= []
for (const name of names) if (!manifest.dsh.profile.bundles.includes(name)) manifest.dsh.profile.bundles.push(name)
writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
console.log('enabled bundles:', manifest.dsh.profile.bundles.filter((name) => names.includes(name)).join(', '))
