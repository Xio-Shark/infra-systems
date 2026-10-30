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
import signal
import subprocess
import sys
import threading
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


def run_lab(
    course_name: str,
    lab_id: str,
    lab: dict,
    quick: bool,
    verbose: bool,
    show_progress: bool = True,
) -> dict:
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
        "quick": quick,
        "min_pass_ok": False,
    }
    if not script.is_file():
        result["detail"] = f"missing test script: {script.relative_to(JUDGE)}"
        return result

    env = os.environ.copy()
    # Only --quick enables quick mode; an ambient QUICK=1 must not silently
    # turn a full run into a smoke test.
    env["QUICK"] = "1" if quick else "0"
    env["JUDGE_COURSE"] = course_name
    env["JUDGE_LAB"] = lab_id
    timeout = int(lab.get("timeout", 900))
    if quick:
        # A smoke test should fail fast instead of waiting for the full lab.
        timeout = min(timeout, 300)

    proc = subprocess.Popen(
        ["bash", str(script)],
        cwd=str(REPO),
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    stop_heartbeat = threading.Event()

    def heartbeat() -> None:
        while not stop_heartbeat.wait(15):
            if show_progress:
                elapsed = int(time.time() - started)
                print(
                    f"    ... {lab_id} still running ({elapsed}s)",
                    file=sys.stderr,
                    flush=True,
                )

    hb = threading.Thread(target=heartbeat, daemon=True)
    hb.start()

    timed_out = False
    try:
        stdout, stderr = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except ProcessLookupError:
            pass
        stdout, stderr = proc.communicate()
    except KeyboardInterrupt:
        # Ctrl-C must not leave `go test -race` and the coordinator running: the
        # lab script starts a new session, so the terminal's SIGINT never
        # reaches it. Kill the whole group before letting the interrupt through.
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait()
        stop_heartbeat.set()
        hb.join(timeout=1)
        print(
            f"\ninterrupted: killed the process group for {course_name}/{lab_id}",
            file=sys.stderr,
        )
        raise
    finally:
        stop_heartbeat.set()
        hb.join(timeout=1)

    result["duration"] = time.time() - started
    stdout = stdout or ""
    stderr = stderr or ""
    earned = total = None
    for line in stdout.splitlines():
        m = CHECK_RE.match(line.strip())
        if m:
            result["checks"].append(
                {"status": m.group(1), "name": m.group(2), "detail": m.group(3) or ""}
            )
            continue
        m = SCORE_RE.match(line.strip())
        if m:
            earned, total = int(m.group(1)), int(m.group(2))

    if timed_out:
        # The script never reached finish(), so its CHECK set is incomplete.
        # Keep the checks for diagnosis but do not award a passing score.
        result["status"] = "ERROR"
        result["score"] = 0
        seen = (
            f"; {len(result['checks'])} check(s) seen before timeout"
            if result["checks"]
            else ""
        )
        result["detail"] = f"timeout after {timeout}s{seen}"
    else:
        if total:
            result["score"] = min(
                result["weight"], max(0, round(result["weight"] * earned / total))
            )
        elif result["checks"]:
            passed = sum(1 for c in result["checks"] if c["status"] == "PASS")
            result["score"] = round(result["weight"] * passed / len(result["checks"]))

        # A lab may declare a subset of checks as "minimum pass" (see
        # courses/*.json: min_pass). Those checks must all pass; the rest only
        # affects the score. Without this, a reader who finishes exactly what
        # the lab page calls "最小通过" would see FAIL 0/20.
        min_pass = lab.get("min_pass") or []
        required = [c for c in result["checks"] if c["name"] in min_pass]
        min_pass_ok = all(c["status"] == "PASS" for c in required) if required else False
        result["min_pass_ok"] = min_pass_ok
        missing_required = sorted(
            set(min_pass) - {c["name"] for c in result["checks"]}
        )
        # A lab whose required tests never ran is not "20/20 with a warning":
        # the score must be visibly below full marks.
        if missing_required and result["score"] >= result["weight"]:
            result["score"] = max(0, result["weight"] - 1)

        if not result["checks"] and total is None:
            result["detail"] = "test script produced no CHECK/SCORE lines"
        elif result["checks"] and all(
            c["status"] == "SKIP" for c in result["checks"]
        ):
            result["status"] = "SKIP"
        elif result["score"] >= result["weight"] and min_pass_ok and not missing_required:
            result["status"] = "PASS"
            result["detail"] = ""
        elif min_pass_ok and not missing_required:
            # The lab's stated minimum is met, but not every test is green.
            result["status"] = "PASS"
            result["detail"] = (
                "最小通过：必做项全部 PASS，其余未通过；完整通过需要全部测试"
            )
        elif result["score"] > 0:
            result["status"] = "PARTIAL"
            if missing_required:
                result["detail"] = "缺少必做项结果：" + ", ".join(missing_required)
        else:
            result["status"] = "FAIL"

        if proc.returncode != 0 and result["status"] == "PASS":
            if result.get("min_pass_ok"):
                pass  # exit code is non-zero because optional tests failed
            else:
                result["status"] = "PARTIAL"
                result["detail"] = f"test script exited {proc.returncode}"

        # --quick is a smoke test. It can show progress, but it is not a pass.
        if quick and result["status"] == "PASS":
            result["status"] = "PARTIAL"
            result["detail"] = "quick mode is a smoke test, not a full pass"

    if verbose or result["status"] in {"FAIL", "PARTIAL", "ERROR"}:
        result["output"] = "\n".join(
            line
            for line in (stdout + stderr).splitlines()
            if not line.startswith(("CHECK ", "SCORE "))
        ).strip()
    return result


def print_result(result: dict, use_color: bool) -> None:
    status = result["status"]
    label = paint(f"{status:<8}", status, use_color)
    quick = "  [quick]" if result.get("quick") else ""
    print(
        f"  {result['lab']:<7} {result['title']:<28} {label} "
        f"{result['score']:>3}/{result['weight']:<3} {result['duration']:>6.1f}s{quick}"
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
        manual = "  [manual]" if course.get("manual") else ""
        print(course.get("title", course["_name"]) + manual)
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
    parser.add_argument(
        "--quick",
        action="store_true",
        help="run a small test subset (smoke test; never reported as a full pass)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="machine-readable output; the exit code still reflects pass/fail",
    )
    parser.add_argument("--verbose", action="store_true", help="show test output")
    args = parser.parse_args()

    if args.list:
        list_courses(args.json)
        return 0

    use_color = sys.stdout.isatty() and not args.json
    selected: list[tuple[str, str, dict]] = []

    if args.all:
        courses = (
            [load_course(args.course)]
            if args.course
            else [c for c in iter_courses() if not c.get("manual")]
        )
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
        result = run_lab(
            course_name,
            lab_id,
            lab,
            args.quick,
            args.verbose,
            show_progress=not args.json,
        )
        results.append(result)
        if not args.json:
            print_result(result, use_color)

    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        total = sum(r["weight"] for r in results)
        score = sum(r["score"] for r in results)
        print(f"\n总分：{score}/{total}")
        if all(r["status"] == "PASS" for r in results):
            print("自动检查全部通过。别忘了写复盘。")
        else:
            print("未全部通过；看上面的 CHECK 行，或加 --verbose 看测试输出。")
    return 0 if all(r["status"] == "PASS" for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
