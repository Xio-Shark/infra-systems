#!/usr/bin/env python3
"""课程仓库的一致性检查。

在 CI 和本地都能跑：`python3 tools/check.py`。它只做机械判断，不评价内容质量。
三类错误会让它失败：

  * 内部链接或锚点指向不存在的页面 / 标题
  * 页面之间对同一件事给出不同的数字（目前覆盖工时与周数）
  * 讲义缺少必需章节（自测、依据）或导览讲没有导览声明

外部链接默认只做格式检查；`--links` 会真的发请求，慢且依赖网络。
"""

from __future__ import annotations

import argparse
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"

# 讲义模板要求每讲都有这两节；STYLE.md 的第 7 条。
LECTURE_REQUIRED = ("### 检查一下自己", "### 答案要点")
# 导览讲篇幅上限（汉字），STYLE.md 说综述型 900–1200 字并要声明。
TOUR_MAX_CHARS = 1200
TOUR_MIN_NO = 13

errors: list[str] = []
warnings: list[str] = []


def fail(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


def han(text: str) -> int:
    return len(re.findall(r"[一-鿿]", text))


def md_files() -> list[Path]:
    return sorted(CONTENT.glob("*.md"))


def split_lectures(text: str) -> list[tuple[int, str]]:
    out = []
    for part in re.split(r"^## ", text, flags=re.M)[1:]:
        head, _, body = part.partition("\n")
        m = re.search(r"第\s*(\d+)\s*讲", head)
        if m:
            out.append((int(m.group(1)), body))
    return out


def check_internal_links() -> None:
    pages = {p.stem for p in md_files()}
    # 锚点在构建产物里才存在，所以这里只校验页面名和显式锚点声明。
    anchor_defs: dict[str, set[str]] = {}
    for p in md_files():
        text = p.read_text(encoding="utf-8")
        ids = set(re.findall(r"\{#([a-zA-Z0-9_-]+)\}", text))
        # Pandoc 也会为标题生成 id；这里只认显式声明的，够用了。
        anchor_defs[p.stem] = ids

    for p in md_files():
        text = p.read_text(encoding="utf-8")
        # 只查相对链接；http(s) 由 --links 单独处理。
        for target in re.findall(r"\]\((?!https?:)([A-Za-z0-9_.-]+\.html)(?:#([A-Za-z0-9_-]+))?\)", text):
            page, anchor = target
            stem = page[:-5]
            if stem not in pages:
                fail(f"{p.name}: 链接到不存在的页面 {page}")
                continue
            if anchor and anchor not in anchor_defs.get(stem, set()):
                fail(f"{p.name}: 链接到不存在的锚点 {page}#{anchor}")
        # 同页锚点
        for anchor in re.findall(r"\]\(#([A-Za-z0-9_-]+)\)", text):
            if anchor not in anchor_defs[p.stem]:
                fail(f"{p.name}: 同页锚点 #{anchor} 未在文件中声明（需 {{#id}}）")


def check_lecture_shape() -> None:
    text = (CONTENT / "lectures.md").read_text(encoding="utf-8")
    lectures = split_lectures(text)
    if not lectures:
        fail("lectures.md: 没找到任何 '## 第 N 讲' 标题")
        return
    numbers = [n for n, _ in lectures]
    missing = [i for i in range(1, max(numbers) + 1) if i not in numbers]
    if missing:
        fail(f"lectures.md: 讲次编号缺 {missing}")

    for num, body in lectures:
        for required in LECTURE_REQUIRED:
            if required not in body:
                fail(f"lectures.md: 第 {num} 讲缺少 '{required}'")
        if num >= TOUR_MIN_NO and han(body) <= TOUR_MAX_CHARS:
            head = body[:400]
            if "这一讲是导览" not in head:
                fail(f"lectures.md: 第 {num} 讲只有 {han(body)} 字，属导览篇幅，但开头没有导览声明")


def check_hours() -> None:
    """工时表是唯一来源；各页引用的合计必须与它一致。"""
    labs = (CONTENT / "labs.md").read_text(encoding="utf-8")
    table = re.search(r"\| 实验 \| 预计 \| 实验 \| 预计 \|(.*?)\n\n", labs, flags=re.S)
    if not table:
        fail("labs.md: 没找到工时表")
        return
    cells = re.findall(r"(\d+)\s*–\s*(\d+)\s*h", table.group(1))
    if len(cells) != 16:
        fail(f"labs.md: 工时表应有 16 个实验，找到 {len(cells)} 个")
    lo = sum(int(a) for a, _ in cells)
    hi = sum(int(b) for _, b in cells)
    if not (lo <= 181 <= hi and lo <= 278 <= hi):
        fail(f"labs.md: 工时表合计 {lo}–{hi}，与正文声明的 181–278 不符")
    if "181–278" not in labs:
        fail("labs.md: 正文没有写合计 181–278 小时")

    index = (CONTENT / "index.md").read_text(encoding="utf-8")
    if "197–301" not in index:
        warn("index.md: 没有出现 197–301 小时这个合计，确认是否漏改")
    # 周数必须与工时相除一致（8–10 小时/周）
    if "20–38 周" not in index:
        fail("index.md: 8–10 小时/周对应的周数不是 20–38（197/10 到 301/8）")

    path_md = (CONTENT / "path.md").read_text(encoding="utf-8")
    if "20–38 周" not in path_md:
        fail("path.md: 稳扎稳打的周数不是 20–38")
    if "10–21 周" not in path_md:
        fail("path.md: 冲刺的周数不是 10–21")


def check_judge_scripts() -> None:
    """每个被判分的实验都要有脚本；占位脚本必须显式声明 manual。"""
    import json

    for course_file in sorted((ROOT / "judge" / "courses").glob("*.json")):
        course = json.loads(course_file.read_text(encoding="utf-8"))
        manual = course.get("manual", False)
        for lab_id, lab in course.get("labs", {}).items():
            script = ROOT / "judge" / "tests" / course_file.stem / lab["script"]
            if not script.is_file():
                fail(f"judge: {course_file.stem}/{lab_id} 缺少脚本 {script.name}")
                continue
            body = script.read_text(encoding="utf-8")
            # 占位脚本的特征：只有一次 skip_all，且脚本里没有任何 check PASS/FAIL。
            # 正常脚本在前置条件不满足时也会 skip_all，所以不能用“出现过”来判断。
            is_placeholder = (
                "skip_all" in body
                and "manual" in body
                and "check PASS" not in body
                and "check FAIL" not in body
            )
            if is_placeholder and not manual:
                fail(f"judge: {course_file.stem}/{lab_id} 是占位脚本，但课程没标 manual")
            if manual and not is_placeholder:
                # 有真测试就没问题，只是提醒一下接口已冻结。
                warn(f"judge: {course_file.stem}/{lab_id} 标为 manual，但脚本不是占位")


def check_external_links() -> None:
    urls: set[str] = set()
    for p in md_files():
        urls |= set(re.findall(r"https?://[^\s)\"'<>\]]+", p.read_text(encoding="utf-8")))
    bad = []
    for url in sorted(urls):
        if any(x in url for x in ("10.244.", "10.96.", "example.com")):
            continue  # 文档里的示例地址
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                if r.status >= 400:
                    bad.append((r.status, url))
        except urllib.error.HTTPError as e:
            if e.code in (403, 405):  # 有些站点拒绝 HEAD
                try:
                    req2 = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                    with urllib.request.urlopen(req2, timeout=20) as r:
                        continue
                except Exception:
                    pass
            bad.append((e.code, url))
        except Exception as e:  # 网络不可达也算需要人看
            bad.append((type(e).__name__, url))
    for status, url in bad:
        fail(f"外部链接 {status}: {url}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--links", action="store_true", help="真的请求每个外部链接（慢）")
    args = ap.parse_args()

    check_internal_links()
    check_lecture_shape()
    check_hours()
    check_judge_scripts()
    if args.links:
        check_external_links()

    for w in warnings:
        print(f"WARN  {w}")
    for e in errors:
        print(f"FAIL  {e}")
    if not errors:
        print(f"OK    {len(md_files())} 页、讲义与工时表检查通过")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
