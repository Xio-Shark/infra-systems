#!/usr/bin/env python3
"""本地评分器：运行 judge/tests 下的验收脚本，汇总分数。

用法：
  ./judge/run.sh --list
  ./judge/run.sh infra01 lab1
  ./judge/run.sh --all --quick
  ./judge/run.sh infra01 lab1 --json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

JUDGE = Path(__file__).resolve().parent
REPO = JUDGE.parent
COURSES = JUDGE / "courses"
TESTS = JUDGE / "tests"

CHECK_RE = re.compile(r'^CHECK (PASS|FAIL|SKIP) "(.*?)"(?: "(.*?)")?\s*$')
SCORE_RE = re.compile(r"^SCORE (\d+)/(\d+)\s*$")

COLORS = {
    "PASS": "\033[32m",
    "FAIL": "\033[31m",
    "PARTIAL": "\033[33m",
    "SKIP": "\033[33m",
    "ERROR": "\033[31m",
}


def paint(text: str, status: str, enabled: bool) -> str:
    if not enabled:
        return text
    return f"{COLORS.get(status, '')}{text}\033[0m"


def load_course(name: str) -> dict:
    path = COURSES / f"{name}.json"
    if not path.is_file():
        raise SystemExit(f"unknown course: {name}\ntry: ./judge/run.sh --list")
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    data["_name"] = name
    return data


def iter_courses():
    for path in sorted(COURSES.glob("*.json")):
        with path.open(encoding="utf-8") as fh:
            data = json.load(fh)
        data["_name"] = path.stem
        yield data


def run_lab(course_name: str, lab_id: str, lab: dict, quick: bool, verbose: bool) -> dict:
    script = TESTS / course_name / lab["script"]
    started = time.time()
    result = {
        "course": course_name,
        "lab": lab_id,
        "title": lab.get("title", lab_id),
        "weight": int(lab.get("weight", 0)),
        "score": 0,
        "status": "ERROR",
        "checks": [],
        "duration": 0.0,
        "detail": "",
    }
    if not script.is_file():
        result["detail"] = f"missing test script: {script.relative_to(JUDGE)}"
        return result

    env = os.environ.copy()
    env["QUICK"] = "1" if quick else env.get("QUICK", "0")
    env["JUDGE_COURSE"] = course_name
    env["JUDGE_LAB"] = lab_id
    timeout = int(lab.get("timeout", 900))

    try:
        proc = subprocess.run(
            ["bash", str(script)],
            cwd=str(REPO),
            env=env,
            text=True,
            capture_output=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        result["duration"] = time.time() - started
        result["detail"] = f"timeout after {timeout}s"
        return result

    result["duration"] = time.time() - started
    earned = total = None
    for line in proc.stdout.splitlines():
        m = CHECK_RE.match(line.strip())
        if m:
            result["checks"].append(
                {"status": m.group(1), "name": m.group(2), "detail": m.group(3) or ""}
            )
            continue
        m = SCORE_RE.match(line.strip())
        if m:
            earned, total = int(m.group(1)), int(m.group(2))

    if total:
        result["score"] = round(result["weight"] * earned / total)
    elif result["checks"]:
        passed = sum(1 for c in result["checks"] if c["status"] == "PASS")
        result["score"] = round(result["weight"] * passed / len(result["checks"]))

    if not result["checks"] and total is None:
        result["detail"] = "test script produced no CHECK/SCORE lines"
    elif all(c["status"] == "SKIP" for c in result["checks"]):
        result["status"] = "SKIP"
    elif result["score"] >= result["weight"]:
        result["status"] = "PASS"
    elif result["score"] > 0:
        result["status"] = "PARTIAL"
    else:
        result["status"] = "FAIL"

    if proc.returncode != 0 and result["status"] == "PASS":
        result["status"] = "PARTIAL"
        result["detail"] = f"test script exited {proc.returncode}"
    if verbose or result["status"] in {"FAIL", "PARTIAL", "ERROR"}:
        result["output"] = "\n".join(
            line
            for line in (proc.stdout + proc.stderr).splitlines()
            if not line.startswith(("CHECK ", "SCORE "))
        ).strip()
    return result


def print_result(result: dict, use_color: bool) -> None:
    status = result["status"]
    label = paint(f"{status:<8}", status, use_color)
    print(
        f"  {result['lab']:<7} {result['title']:<28} {label} "
        f"{result['score']:>3}/{result['weight']:<3} {result['duration']:>6.1f}s"
    )
    for check in result["checks"]:
        cstatus = check["status"]
        clabel = paint(f"{cstatus:<4}", cstatus, use_color)
        detail = f"  {check['detail']}" if check["detail"] else ""
        print(f"    {clabel} {check['name']}{detail}")
    if result["detail"]:
        print(f"    {paint('note', 'FAIL', use_color)} {result['detail']}")
    if result.get("output"):
        print("    --- test output ---")
        for line in result["output"].splitlines()[-40:]:
            print(f"    {line}")
        print("    ------------------")


def list_courses(as_json: bool) -> None:
    courses = list(iter_courses())
    if as_json:
        print(json.dumps(courses, ensure_ascii=False, indent=2))
        return
    for course in courses:
        print(course.get("title", course["_name"]))
        for lab_id, lab in course.get("labs", {}).items():
            script = TESTS / course["_name"] / lab.get("script", "")
            state = "" if script.is_file() else "  [no test script]"
            print(
                f"  {lab_id:<7} {lab.get('title', lab_id):<28} "
                f"weight={lab.get('weight', 0):<3}{state}"
            )
        print()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Infra Systems local judge",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "examples:\n"
            "  ./judge/run.sh --list\n"
            "  ./judge/run.sh infra01 lab1\n"
            "  ./judge/run.sh --all --quick\n"
            "  LAB_ROOT=~/labs/6.5840 ./judge/run.sh infra01 lab3\n"
        ),
    )
    parser.add_argument("course", nargs="?")
    parser.add_argument("lab", nargs="?")
    parser.add_argument("--list", action="store_true", help="list courses and labs")
    parser.add_argument("--all", action="store_true", help="run every lab in scope")
    parser.add_argument("--quick", action="store_true", help="run a small test subset")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument("--verbose", action="store_true", help="show test output")
    args = parser.parse_args()

    if args.list:
        list_courses(args.json)
        return 0

    use_color = sys.stdout.isatty() and not args.json
    selected: list[tuple[str, str, dict]] = []

    if args.all:
        courses = [load_course(args.course)] if args.course else list(iter_courses())
        for course in courses:
            for lab_id, lab in course.get("labs", {}).items():
                selected.append((course["_name"], lab_id, lab))
    else:
        if not args.course or not args.lab:
            parser.print_help()
            return 2
        course = load_course(args.course)
        labs = course.get("labs", {})
        if args.lab not in labs:
            raise SystemExit(f"unknown lab {args.lab!r}; try: ./judge/run.sh --list")
        selected.append((course["_name"], args.lab, labs[args.lab]))

    results = []
    current_course = None
    for course_name, lab_id, lab in selected:
        if course_name != current_course and not args.json:
            course = load_course(course_name)
            print(course.get("title", course_name))
            current_course = course_name
        result = run_lab(course_name, lab_id, lab, args.quick, args.verbose)
        results.append(result)
        if not args.json:
            print_result(result, use_color)

    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        total = sum(r["weight"] for r in results)
        score = sum(r["score"] for r in results)
        print(f"\n总分：{score}/{total}")
        if any(r["status"] != "PASS" for r in results):
            print("未全部通过；看上面的 CHECK 行，或加 --verbose 看测试输出。")
            return 1
        print("全部通过。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
