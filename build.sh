#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

rm -rf dist/assets/fonts
mkdir -p dist/assets/fonts
cp assets/style.css assets/app.js dist/assets/
cp assets/fonts/*.woff2 assets/fonts/OFL.txt dist/assets/fonts/
touch dist/.nojekyll

for f in content/*.md; do
  base="$(basename "$f" .md)"
  title="$(awk '/^# / { sub(/^# /, ""); print; exit }' "$f")"
  if [ -z "$title" ]; then
    title="$base"
  fi

  pandoc "$f" \
    --from markdown+task_lists \
    --to html5 \
    --template=template.html \
    --metadata title="$title" \
    --standalone \
    --output "dist/${base}.html"

  echo "built dist/${base}.html"
done

echo "done."
