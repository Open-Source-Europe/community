#!/usr/bin/env bash
# SessionStart hook: record what the tree looked like when this session began.
#
# The wrap-up gate needs to know what THIS SESSION changed. Without a baseline the
# only thing it can measure is the whole branch against main, which on a long-lived
# branch is the same large file list at every stop, in read-only sessions included.
# That made the gate fire constantly while having nothing to report.
#
# Writes one line — <head-sha> <hash of the working-tree state> — keyed by session
# and by directory, so worktrees of the same repo never share a baseline.

set -u

input=$(cat 2>/dev/null || true)
session=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)
[ -z "$session" ] && exit 0

project=$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)
[ -z "$project" ] && exit 0
git -C "$project" rev-parse --git-dir >/dev/null 2>&1 || exit 0

dir="${TMPDIR:-/tmp}/claude-wrapup-gate"
mkdir -p "$dir" 2>/dev/null || exit 0

# Prune baselines from sessions that ended long ago, so the temp dir does not grow.
find "$dir" -name 'baseline-*' -mtime +7 -delete 2>/dev/null || true

key=$(printf '%s' "$project" | shasum | cut -c1-12)
head=$(git -C "$project" rev-parse HEAD 2>/dev/null || echo none)
tree=$(git -C "$project" status --porcelain 2>/dev/null | shasum | cut -c1-40)

printf '%s %s\n' "$head" "$tree" > "$dir/baseline-$key-$session" 2>/dev/null || true
exit 0
