#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# GitHub Pages 对 HTML/CSS/JS/字体统一发 cache-control: max-age=600，且不支持自定义响应头。
# 所以把内容哈希挂到资源 URL 上：CSS/JS/字体一改，URL 就变，浏览器和 Fastly 边缓存都拿不到旧副本。
ver="$(cat template.html assets/style.css assets/app.js \
  assets/fonts/infra-mono-400.woff2 assets/fonts/infra-mono-600.woff2 \
  | openssl dgst -sha256 -r | cut -c1-10)"

rm -rf dist/assets/fonts
mkdir -p dist/assets/fonts
sed "s|\(fonts/infra-mono-[46]00\.woff2\)|\1?v=${ver}|g" assets/style.css > dist/assets/style.css
sed "s|__ASSET_VER__|${ver}|g" assets/app.js > dist/assets/app.js
cp assets/fonts/*.woff2 assets/fonts/OFL.txt dist/assets/fonts/
printf '{"v":"%s"}\n' "$ver" > dist/version.json
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
    --variable asset_ver="$ver" \
    --standalone \
    --output "dist/${base}.html"

  echo "built dist/${base}.html"
done

echo "done. asset version ${ver}"
