#!/bin/bash
# =============================================================================
# stop-notify hook
# 세션 종료 시 macOS 알림 센터에 작업 완료 알림 전송 (Stop)
#
# 조건: ralph-loop 활성 상태이거나 미완료 태스크가 있으면 알림을 보내지 않음
# (실제 종료 시에만 알림)
# =============================================================================

# 알림 실패해도 다른 hook에 영향 주지 않도록 항상 exit 0
trap 'exit 0' EXIT

# --- stdin에서 JSON input 읽기 ---
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // .sessionId // "default"')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

if [[ -z "$CWD" ]]; then
  exit 0
fi

# --- project root 계산 (cwd에서 .git 또는 CLAUDE.md 찾기) ---
find_project_root() {
  local dir="$1"
  while [[ "$dir" != "/" && -n "$dir" ]]; do
    if [[ -d "$dir/.git" || -f "$dir/CLAUDE.md" ]]; then
      echo "$dir"
      return 0
    fi
    dir=$(dirname "$dir")
  done
  echo "$1"
}

PROJECT_ROOT=$(find_project_root "$CWD")

# --- 조건 검사: ralph-state 활성 여부 ---
RALPH_STATE_FILE="$PROJECT_ROOT/.omt/ralph-state-${SESSION_ID}.json"
if [[ -f "$RALPH_STATE_FILE" ]]; then
  RALPH_ACTIVE=$(jq -r '.active // false' "$RALPH_STATE_FILE" 2>/dev/null)
  if [[ "$RALPH_ACTIVE" == "true" ]]; then
    exit 0
  fi
fi

# --- 조건 검사: incomplete tasks 여부 ---
TASKS_DIR="$HOME/.claude/tasks/${SESSION_ID}"
if [[ -d "$TASKS_DIR" ]]; then
  INCOMPLETE_COUNT=0
  for task_file in "$TASKS_DIR"/*.json; do
    [[ -f "$task_file" ]] || continue
    STATUS=$(jq -r '.status // empty' "$task_file" 2>/dev/null)
    if [[ "$STATUS" == "pending" || "$STATUS" == "in_progress" ]]; then
      INCOMPLETE_COUNT=$((INCOMPLETE_COUNT + 1))
    fi
  done
  if [[ "$INCOMPLETE_COUNT" -gt 0 ]]; then
    exit 0
  fi
fi

# --- 알림 전송 ---
TITLE="Claude Code"
SUBTITLE="작업 완료"
MESSAGE="Claude Code 작업이 완료되었습니다"

# osascript로 macOS 알림 시도
if osascript -e "display notification \"$MESSAGE\" with title \"$TITLE\" subtitle \"$SUBTITLE\" sound name \"Hero\"" 2>/dev/null; then
  exit 0
fi

# osascript 실패 시 terminal-notifier fallback
if command -v terminal-notifier &>/dev/null; then
  terminal-notifier -title "$TITLE" -subtitle "$SUBTITLE" -message "$MESSAGE" -sound "Hero" 2>/dev/null || true
fi
