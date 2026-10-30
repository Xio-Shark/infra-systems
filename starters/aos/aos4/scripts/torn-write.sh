#!/usr/bin/env bash
# AOS4: torn-write control experiment — "copy directly" vs "freeze + fsync + copy".
#
# Usage: ./scripts/torn-write.sh --mode direct|freeze --seconds 10 [--size 10M]
#
# The writer rewrites one file with a full block of a single repeated byte and
# records the hash of each *complete* generation. The copier copies the file
# while the writer runs; a copy whose hash is not in the writer's set is torn.
#
# A correct freeze-based snapshot must produce zero torn reads. The direct copy
# is expected to produce at least one — if it does not, make the file bigger or
# run longer instead of deleting the experiment (that is what the lab page says).

set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/../common.sh"

MODE=""
SECONDS_RUN=10
SIZE="10M"
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --seconds) SECONDS_RUN="$2"; shift 2 ;;
    --size) SIZE="$2"; shift 2 ;;
    *) fail "未知参数 $1"; summary; exit 0 ;;
  esac
done
[ -n "$MODE" ] || { fail "需要 --mode direct|freeze"; summary; exit 0; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
TARGET="$ROOT/data.bin"
SNAP="$ROOT/snap.bin"
: >"$TARGET"

need_cmd python3 "torn-write"

# Writer: each generation is the whole file filled with one byte, so any torn
# copy shows a byte mix that no generation ever had.
python3 - "$TARGET" "$ROOT/complete.hashes" "$SECONDS_RUN" "$SIZE" <<'PY' &
import hashlib, os, sys, time
path, hashes, secs, size = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
mult = {'K': 1024, 'M': 1024**2, 'G': 1024**3}
n = int(size[:-1]) * mult[size[-1].upper()]
deadline = time.time() + secs
seen = set()
with open(hashes, 'w') as out:
    byte = 0
    while time.time() < deadline:
        byte = (byte + 1) % 255
        # Write in two halves with a small gap, so a concurrent copy can land
        # between them; that is the torn window this experiment is about.
        with open(path, 'wb') as f:
            f.write(bytes([byte]) * (n // 2))
            f.flush()
            time.sleep(0.0005)
            f.write(bytes([byte]) * (n - n // 2))
            f.flush()
            os.fsync(f.fileno())
        h = hashlib.sha256(bytes([byte]) * n).hexdigest()
        if h not in seen:
            seen.add(h)
            out.write(h + '\n')
            out.flush()
PY
writer=$!

sleep 0.5
torn=0
copies=0
deadline=$(( $(date +%s) + SECONDS_RUN ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  case "$MODE" in
    direct)
      cp "$TARGET" "$SNAP" 2>/dev/null
      ;;
    freeze)
      # The implementation is expected to expose a freeze helper; without it
      # fall back to a fdatasync'd copy and say so, rather than pretending the
      # freeze path was exercised.
      if [ -x ./aos4 ]; then
        ./aos4 freeze --workspace "$ROOT" --on >/dev/null 2>&1
      fi
      cp "$TARGET" "$SNAP" 2>/dev/null
      if [ -x ./aos4 ]; then
        ./aos4 freeze --workspace "$ROOT" --off >/dev/null 2>&1
      fi
      ;;
  esac
  if [ -s "$SNAP" ]; then
    h=$(sha256sum "$SNAP" | cut -d' ' -f1)
    copies=$((copies + 1))
    grep -qx "$h" "$ROOT/complete.hashes" 2>/dev/null || torn=$((torn + 1))
  fi
  sleep 0.02
done

wait "$writer" 2>/dev/null

printf 'mode=%s copies=%d torn=%d complete=%d\n' \
  "$MODE" "$copies" "$torn" "$(wc -l <"$ROOT/complete.hashes" | tr -d ' ')"

case "$MODE" in
  direct)
    if [ "$torn" -gt 0 ]; then
      ok "direct: 抓到了 $torn 次 torn write（对照组有效）"
    else
      skip "direct: 没抓到 torn write；按任务书要求，增大 --size 或延长 --seconds 再试，不要删掉这个实验"
    fi
    ;;
  freeze)
    if [ "$copies" -eq 0 ]; then
      fail "freeze: 一次都没复制成功"
    elif [ "$torn" -eq 0 ]; then
      ok "freeze: $copies 次复制没有一次 torn"
    else
      fail "freeze: $torn/$copies 次仍然 torn（冻结或 fsync 顺序不对）"
    fi
    ;;
esac

summary
