#!/bin/zsh
# 备用终端入口与桌面应用共用 background.mjs，按本目录包版本自动升级外置加载器。
# 解析真实路径后启动，让桌面软链接也加载同一份卡片；不退出正在运行的 Codex。
cd -- "${0:A:h}" || exit 1
task_node="$(command -v node)"
# Finder 的 PATH 可能不含 Homebrew；依次检查常见安装位置。
for candidate in "$HOME/.local/bin/node" /opt/homebrew/bin/node /usr/local/bin/node; do
  if [[ -z "$task_node" && -x "$candidate" ]]; then task_node="$candidate"; fi
done
if [[ -z "$task_node" ]]; then
  print -u2 '需要 Node.js 22 或更高版本。'
  exit 1
fi
exec "$task_node" "$PWD/background.mjs" start
