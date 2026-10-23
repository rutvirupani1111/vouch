#!/usr/bin/env sh
# Build the site and force-push dist/ to the gh-pages branch (no GitHub Actions needed).
set -e
SITE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${VOUCH_PAGES_DIR:-$SITE/../../.tools/vouch-pages}"

cd "$SITE"
npm run build
rm -rf "$OUT"
mkdir -p "$OUT"
cp -r dist/. "$OUT/"
touch "$OUT/.nojekyll"
cp "$OUT/index.html" "$OUT/404.html"

cd "$OUT"
git init -q -b gh-pages
git config --local credential.https://github.com.helper ''
git config --local --add credential.https://github.com.helper '!gh auth git-credential'
git add -A
git commit -q -m "Deploy Vouch Trust Index $(date -u +%Y-%m-%dT%H:%MZ)"
git push -q -f https://github.com/rutvirupani1111/vouch.git gh-pages
gh api -X POST repos/rutvirupani1111/vouch/pages -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null 2>&1 || echo "pages: already enabled (or 409)"
echo "deployed to https://rutvirupani1111.github.io/vouch/"
