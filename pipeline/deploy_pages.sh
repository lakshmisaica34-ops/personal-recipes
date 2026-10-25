#!/usr/bin/env bash
# Publish docs/ to GitHub Pages.
# Usage: GITHUB_TOKEN=github_pat_... bash pipeline/deploy_pages.sh
set -euo pipefail

REPO="lakshmisaica34-ops/personal-recipes"
: "${GITHUB_TOKEN:?set GITHUB_TOKEN (fine-grained PAT, Contents: read/write + Pages: read/write)}"
cd "$(dirname "$0")/.."

git add -A docs pipeline .gitignore package.json README.md ARCHITECTURE.md 2>/dev/null || true
if git diff --cached --quiet; then
  echo "no changes to commit"
else
  git -c user.name="recipe-collection" -c user.email="recipe-collection@users.noreply.github.com" \
      commit -q -m "Publish recipe collection ($(date -u +%Y-%m-%d))"
fi

git push -q "https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO}.git" HEAD:main
echo "pushed to main"

api() { # method path data
  curl -s -o /tmp/pages_api.json -w "%{http_code}" -X "$1" \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/repos/${REPO}$2" ${3:+-d "$3"}
}

body='{"source":{"branch":"main","path":"/docs"},"build_type":"legacy"}'
code=$(api POST /pages "$body")
if [ "$code" = "409" ]; then
  code=$(api PUT /pages "$body")
fi
echo "pages api -> HTTP ${code}"
cat /tmp/pages_api.json | head -c 400; echo
