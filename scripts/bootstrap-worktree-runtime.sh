#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
primary_root="$(git worktree list --porcelain | awk '/^worktree / {print substr($0, 10); exit}')"

if [[ -z "$primary_root" || "$repo_root" == "$primary_root" ]]; then
  exit 0
fi

link_shared_path() {
  local name="$1"
  local source_path="$primary_root/$name"
  local target_path="$repo_root/$name"

  if [[ ! -e "$source_path" ]]; then
    return 0
  fi

  if [[ -L "$target_path" ]]; then
    local current_target
    current_target="$(readlink "$target_path")"
    if [[ "$current_target" == "$source_path" ]]; then
      return 0
    fi
  fi

  if [[ -e "$target_path" ]]; then
    echo "bootstrap-worktree-runtime: skipping existing $target_path" >&2
    return 0
  fi

  ln -s "$source_path" "$target_path"
}

link_shared_path ".env"
link_shared_path "node_modules"
