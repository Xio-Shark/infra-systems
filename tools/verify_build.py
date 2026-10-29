#!/usr/bin/env python3
"""构建产物检查。

`build.sh` 之后跑，确认 dist 里的页面真的可用，而不是“pandoc 没报错”：

  * 每个 content/*.md 都有对应 html
  * 页面里的相对链接和锚点在 dist 里能解析
  * 资源版本号一致（CSS/JS/字体都用同一个 hash）
  * 字体覆盖 dist 正文的汉字

任何一条失败都返回非零，CI 会拒绝部署。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
CONTENT = ROOT / "content"

errors: list[str] = []


def fail(msg: str) -> None:
    errors.append(msg)


def check_pages_built() -> list[Path]:
    pages = []
    for src in sorted(CONTENT.glob("*.md")):
        out = DIST / f"{src.stem}.html"
        if not out.is_file():
            fail(f"dist/{src.stem}.html 没有生成")
        else:
            pages.append(out)
    index = DIST / "index.html"
    if not index.is_file():
        fail("dist/index.html 不存在")
    nojekyll = DIST / ".nojekyll"
    if not nojekyll.is_file():
        fail("dist/.nojekyll 不存在，GitHub Pages 会跳过 assets 目录")
    return pages


def check_links(pages: list[Path]) -> None:
    for page in pages:
        html = page.read_text(encoding="utf-8")
        for href in re.findall(r'href="([^"]+)"', html):
            if href.startswith(("http://", "https://", "mailto:", "data:")):
                continue
            path, _, anchor = href.partition("#")
            path = path.split("?", 1)[0]  # 资源带 ?v=<hash>，查文件时要剥掉
            if not path:
                if anchor and f'id="{anchor}"' not in html:
                    fail(f"{page.name}: 同页锚点 #{anchor} 在产物里不存在")
                continue
            target = DIST / path
            if not target.is_file():
                fail(f"{page.name}: 链接 {href} 指向的文件不存在")
                continue
            if anchor:
                other = target.read_text(encoding="utf-8")
                if f'id="{anchor}"' not in other:
                    fail(f"{page.name}: 链接 {href} 的锚点在目标页不存在")


def check_asset_version() -> None:
    version_file = DIST / "version.json"
    if not version_file.is_file():
        fail("dist/version.json 不存在")
        return
    version = re.search(r'"v"\s*:\s*"([^"]+)"', version_file.read_text()).group(1)
    for page in DIST.glob("*.html"):
        html = page.read_text(encoding="utf-8")
        for ref in re.findall(r'assets/[a-z0-9.-]+\?v=([^"\']+)', html):
            if ref != version:
                fail(f"{page.name}: 资源版本 {ref} 与 version.json 的 {version} 不一致")


def check_font_coverage() -> None:
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        print("SKIP  没装 fonttools，跳过字体覆盖检查")
        return
    font = DIST / "assets" / "fonts" / "infra-mono-400.woff2"
    if not font.is_file():
        fail("dist/assets/fonts/infra-mono-400.woff2 不存在")
        return
    cmap = set(TTFont(font).getBestCmap())
    total = 0
    missing: dict[str, int] = {}
    for page in DIST.glob("*.html"):
        text = re.sub(r"<[^>]+>", "", page.read_text(encoding="utf-8"))
        for ch in text:
            if "一" <= ch <= "鿿":
                total += 1
                if ord(ch) not in cmap:
                    missing[ch] = missing.get(ch, 0) + 1
    if missing:
        worst = sorted(missing.items(), key=lambda kv: -kv[1])[:8]
        fail(
            f"字体子集缺 {len(missing)} 个汉字（正文共 {total} 字），最常见："
            + "、".join(f"{c}×{n}" for c, n in worst)
            + "。按 assets/fonts/README.md 重新生成子集"
        )


def main() -> int:
    pages = check_pages_built()
    check_links(pages)
    check_asset_version()
    check_font_coverage()
    for e in errors:
        print(f"FAIL  {e}")
    if not errors:
        print(f"OK    {len(pages)} 页构建产物检查通过")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
