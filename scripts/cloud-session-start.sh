#!/bin/bash
# Runs when a Claude Code session starts (.claude/settings.json SessionStart hook).
# Only does work in cloud sessions: installs npm packages when package-lock.json changed.
# Locally it exits at once, so it never touches node_modules on the owner's PC.

if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" || exit 1
hashes=node_modules/.cloud-session-start.sha256

if ! sha256sum --check --status "$hashes" 2>/dev/null; then
  # Drop the old hashes first, so a failed install runs again next session
  rm -f "$hashes"
  if npm ci --no-audit --no-fund; then
    sha256sum scripts/cloud-session-start.sh package.json package-lock.json > "$hashes" || rm -f "$hashes"
  fi
fi

# Vite reads VITE_* from the environment, so the cloud environment's variables are enough.
if [ -z "$VITE_SUPABASE_URL" ] && [ ! -f .env.local ]; then
  echo "Note: VITE_SUPABASE_URL is not set in this cloud environment; npm run build will fail." >&2
fi
exit 0
