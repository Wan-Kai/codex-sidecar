#!/bin/zsh
# 仅停止自己的后台加载器；不会终止 Codex 或模型请求。
cd -- "${0:A:h}" || exit 1
task_node="$(command -v node)"
# Finder 的 PATH 可能不含 Homebrew；依次检查常见安装位置。
for candidate in "$HOME/.local/bin/node" /opt/homebrew/bin/node /usr/local/bin/node; do
  if [[ -z "$task_node" && -x "$candidate" ]]; then task_node="$candidate"; fi
done
[[ -n "$task_node" ]] || { print '找不到 Node.js'; exit 1; }
"$task_node" "$PWD/background.mjs" stop
