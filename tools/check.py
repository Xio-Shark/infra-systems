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
    """工时表是唯一来源；各页引用的合计和周数必须由它算出来。

    以前的版本只检查几个硬编码字符串（"20–38 周"）还在不在——改坏工时表后
    照样通过。现在改成：从表里读出合计，再独立算出周数区间，两边必须相等。
    """
    labs = (CONTENT / "labs.md").read_text(encoding="utf-8")
    table = re.search(r"\| 实验 \| 预计 \| 实验 \| 预计 \|(.*?)\n\n", labs, flags=re.S)
    if not table:
        fail("labs.md: 没找到工时表")
        return
    cells = re.findall(r"(\d+)\s*–\s*(\d+)\s*h", table.group(1))
    if len(cells) != 16:
        fail(f"labs.md: 工时表应有 16 个实验，找到 {len(cells)} 个")
        return
    lab_lo = sum(int(a) for a, _ in cells)
    lab_hi = sum(int(b) for _, b in cells)

    # index.md 的三行：实验小时、含阅读的小时，以及两种节奏下各自的周数区间。
    # "加阅读"列是累计值（实验 + 阅读），不是额外加项。
    index = (CONTENT / "index.md").read_text(encoding="utf-8")
    row_re = re.compile(
        r"\| (INFRA 0[123]) \| (\d+)–(\d+) 小时 \| (\d+)–(\d+) 小时 "
        r"\| 第 (\d+)–(\d+) 周 \| 第 (\d+)–(\d+) 周 \|"
    )
    import math

    def span(lo: int, hi: int, rate_lo: int, rate_hi: int) -> tuple[int, int]:
        """工时 lo–hi 在 rate_lo–rate_hi 小时/周下的周数区间（最快, 最慢）。"""
        return math.ceil(lo / rate_hi), math.ceil(hi / rate_lo)

    rows = row_re.findall(index)
    if len(rows) != 3:
        fail(f"index.md: 期望 3 行课程工时表，找到 {len(rows)} 行")
        return

    exp_lo = sum(int(r[1]) for r in rows)
    exp_hi = sum(int(r[2]) for r in rows)
    if (exp_lo, exp_hi) != (lab_lo, lab_hi):
        fail(
            f"index.md: 实验列合计 {exp_lo}–{exp_hi} 与 labs.md 工时表的 "
            f"{lab_lo}–{lab_hi} 不符"
        )

    total_lo = sum(int(r[3]) for r in rows)
    total_hi = sum(int(r[4]) for r in rows)

    # 列里给的是"按顺序排到第几周"，所以每门课占的宽度是它自己在最慢节奏下的
    # 周数 ceil(hi / rate_lo)；三行必须首尾相接，末行终点即全套上限。
    cursor_slow = cursor_fast = 1
    for name, _e_lo, _e_hi, t_lo, t_hi, s1, s2, f1, f2 in rows:
        t_lo, t_hi = int(t_lo), int(t_hi)
        width_slow = math.ceil(t_hi / 8)
        width_fast = math.ceil(t_hi / 15)
        want_slow = (cursor_slow, cursor_slow + width_slow - 1)
        want_fast = (cursor_fast, cursor_fast + width_fast - 1)
        if (int(s1), int(s2)) != want_slow:
            fail(
                f"index.md: {name} 的 8–10 小时/周应写 第 {want_slow[0]}–{want_slow[1]} 周"
                f"（{t_hi} 小时 ÷ 8 向上取整 = {width_slow} 周，从上一个课程结束处开始），"
                f"实际写 {s1}–{s2}"
            )
        if (int(f1), int(f2)) != want_fast:
            fail(
                f"index.md: {name} 的 15–20 小时/周应写 第 {want_fast[0]}–{want_fast[1]} 周"
                f"（{t_hi} 小时 ÷ 15 向上取整 = {width_fast} 周），实际写 {f1}–{f2}"
            )
        cursor_slow = want_slow[1] + 1
        cursor_fast = want_fast[1] + 1

    slow_s = "–".join(str(x) for x in span(total_lo, total_hi, 8, 10))
    fast_s = "–".join(str(x) for x in span(total_lo, total_hi, 15, 20))
    total_s = f"{total_lo}–{total_hi}"

    # 全套区间必须与逐课累加的上界吻合，否则"20–38 周"就是拍脑袋的数字。
    end_slow, end_fast = cursor_slow - 1, cursor_fast - 1
    if end_slow != int(slow_s.split("–")[1]):
        fail(
            f"index.md: 逐课累加到第 {end_slow} 周，但整套声明的上限是 "
            f"{slow_s.split('–')[1]} 周"
        )
    if end_fast != int(fast_s.split("–")[1]):
        fail(
            f"index.md: 逐课累加（冲刺）到第 {end_fast} 周，但整套声明的上限是 "
            f"{fast_s.split('–')[1]} 周"
        )

    for name, text in (
        ("index.md", index),
        ("path.md", (CONTENT / "path.md").read_text(encoding="utf-8")),
        ("labs.md", labs),
    ):
        if total_s not in text:
            fail(f"{name}: 没有出现合计 {total_s} 小时（由工时表算出）")
        if f"{slow_s} 周" not in text:
            fail(f"{name}: 8–10 小时/周应写 {slow_s} 周（{total_lo}/10 到 {total_hi}/8）")
        if f"{fast_s} 周" not in text:
            fail(f"{name}: 15–20 小时/周应写 {fast_s} 周（{total_lo}/20 到 {total_hi}/15）")


def check_acceptance_scripts() -> None:
    """实验页引用的验收脚本必须真的在仓库里。

    INFRA 02/03 没有 judge，读者的验收完全依赖任务书里写的那几条命令。一旦
    页面引用一个仓库里不存在的 tests/*.sh，那门课就没有可判定的完成标准了。
    脚本按实验落在 starters/aos/<lab>/ 下，页面里写成 ./tests/xxx.sh。
    """
    # <page>: [<lab dir>, …] — a page may ship scripts under more than one dir.
    labs = {
        "aos1": "aos1",
        "aos2": "aos2",
        "aos3": "aos3",
        "aos4": "aos4",
        "aos5": "aos5",
    }
    script_re = re.compile(r"\./(tests|scripts)/([A-Za-z0-9_.-]+)")

    for page, lab in labs.items():
        path = CONTENT / f"{page}.md"
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        for subdir, name in set(script_re.findall(text)):
            shipped = ROOT / "starters" / "aos" / lab / subdir / name
            if not shipped.is_file():
                fail(
                    f"{page}.md: 引用了 ./{subdir}/{name}，"
                    f"但 starters/aos/{lab}/{subdir}/{name} 不存在"
                )


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
    check_acceptance_scripts()
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
