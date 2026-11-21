# AuditDesk 审计插件一键安装（Windows PowerShell）
# 用法：powershell -ExecutionPolicy Bypass -File install-windows.ps1 [-Profile desktop]
param(
  [string]$Profile = "desktop"
)
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PluginSrc = Join-Path $ScriptDir "plugins"
$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE ".dsh" }

function Find-Dsh {
  if ($env:DSH_BIN -and (Test-Path $env:DSH_BIN)) { return $env:DSH_BIN }
  $candidates = @(
    (Join-Path (Split-Path -Parent $ScriptDir) "runtime\cli\bin\dsh.cmd"),
    (Join-Path $env:LOCALAPPDATA "Programs\AuditDesk\resources\runtime\cli\bin\dsh.cmd"),
    (Join-Path $env:PROGRAMFILES "AuditDesk\resources\runtime\cli\bin\dsh.cmd"),
    (Join-Path $env:LOCALAPPDATA "Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"),
    (Join-Path $env:PROGRAMFILES "DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}

$DshCmd = Find-Dsh
if (-not $DshCmd) {
  Write-Error "找不到 dsh.cmd，请设置 DSH_BIN 环境变量指向 dsh.cmd"
  exit 1
}
Write-Host "使用 dsh：$DshCmd"
Write-Host "目标 profile：$Profile（DSH_HOME=$DshHome）"

$TargetDir = Join-Path $DshHome "plugins\auditdesk"
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
foreach ($plugin in @("audit-workbench-dsh", "audit-kb-dsh", "audit-p0-dsh")) {
  $dest = Join-Path $TargetDir $plugin
  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  Copy-Item -Recurse -Force (Join-Path $PluginSrc $plugin) $dest
}

$ProfileDir = Join-Path $DshHome "profiles\$Profile"
New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
$ProfileFile = Join-Path $ProfileDir "package.json"
if (-not (Test-Path $ProfileFile)) {
  Write-Host "初始化 profile $Profile ..."
  & $DshCmd plugin --profile $Profile add ("file:" + (Join-Path $TargetDir "audit-kb-dsh"))
}
if (-not (Test-Path $ProfileFile)) {
  Write-Error "无法初始化 profile：$ProfileFile"
  exit 1
}
foreach ($plugin in @("audit-workbench-dsh", "audit-p0-dsh")) {
  & $DshCmd plugin --profile $Profile add ("file:" + (Join-Path $TargetDir $plugin))
}
Write-Host "安装完成。请重启 AuditDesk，左侧应出现审计功能面板。"
