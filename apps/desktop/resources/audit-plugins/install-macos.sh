#!/bin/bash
# AuditDesk 审计插件一键安装（macOS）
# 用法：bash install-macos.sh [--profile desktop]
set -euo pipefail

PROFILE="desktop"
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    *) echo "未知参数：$1"; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_SRC="$SCRIPT_DIR/plugins"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"

find_dsh() {
  if [ -n "${DSH_BIN:-}" ] && [ -x "$DSH_BIN" ]; then echo "$DSH_BIN"; return; fi
  for candidate in \
    "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
    "/Applications/AuditDesk.app/Contents/Resources/runtime/cli/bin/dsh" \
    "$HOME/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"; do
    if [ -x "$candidate" ]; then echo "$candidate"; return; fi
  done
  command -v dsh 2>/dev/null || true
}

DSH_BIN_PATH="$(find_dsh)"
if [ -z "$DSH_BIN_PATH" ]; then
  echo "找不到 dsh 可执行文件，请设置 DSH_BIN 环境变量指向 dsh"
  exit 1
fi
echo "使用 dsh：${DSH_BIN_PATH}"
echo "目标 profile：${PROFILE}（DSH_HOME=${DSH_HOME}）"

DOC_SRC="$SCRIPT_DIR/delivery-docs"
if [ -d "$DOC_SRC" ]; then
  DOC_DEST="$DSH_HOME/auditdesk-docs"
  mkdir -p "$DOC_DEST"
  cp -R "$DOC_SRC"/. "$DOC_DEST"/
  echo "交付文档已复制到：$DOC_DEST"
fi

TARGET_DIR="$DSH_HOME/plugins/auditdesk"
mkdir -p "$TARGET_DIR"
for plugin in audit-workbench-dsh audit-kb-dsh audit-p0-dsh; do
  rm -rf "$TARGET_DIR/$plugin"
  cp -R "$PLUGIN_SRC/$plugin" "$TARGET_DIR/$plugin"
done

PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
mkdir -p "$PROFILE_DIR"
if [ ! -f "$PROFILE_DIR/package.json" ]; then
  echo "初始化 profile ${PROFILE} ..."
  DSH_HOME="$DSH_HOME" "$DSH_BIN_PATH" plugin --profile "$PROFILE" add "file:$TARGET_DIR/audit-kb-dsh"
fi
if [ ! -f "$PROFILE_DIR/package.json" ]; then
  echo "无法初始化 profile：${PROFILE_DIR}/package.json 不存在"
  exit 1
fi

for plugin in audit-workbench-dsh audit-p0-dsh; do
  DSH_HOME="$DSH_HOME" "$DSH_BIN_PATH" plugin --profile "$PROFILE" add "file:$TARGET_DIR/$plugin"
done
echo "安装完成。请重启 AuditDesk 桌面端，左侧应出现「客户与项目 / 知识库 / 操作留痕 / 用户管理 / 系统状态」。"
