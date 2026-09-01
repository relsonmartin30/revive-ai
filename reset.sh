#!/usr/bin/env bash
# ReviveAI — reset SQLite database to empty state
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="$ROOT/backend/reviveai.db"

RED='\033[0;31m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${YELLOW}${BOLD}This deletes all transaction data in backend/reviveai.db${NC}"
echo -n "Continue? [y/N] "
read -r REPLY
echo ""

if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
  echo "Cancelled — no changes made."
  exit 0
fi

if [[ -f "$DB" ]]; then
  rm -f "$DB"
  echo -e "${BOLD}Deleted:${NC} $DB"
  echo "Database cleared. Restart the app or generate a new batch."
else
  echo "No database found at backend/reviveai.db — already clean."
fi
echo ""
