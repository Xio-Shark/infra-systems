# 字体

`infra-mono-400.woff2` 和 `infra-mono-600.woff2` 是 Maple Mono NF CN 的子集，字形来自 Maple Mono；按 SIL Open Font License 的保留字体名要求，子集改名为 `Infra Mono`。许可证见 `OFL.txt`。

## 覆盖范围

子集按 `content/*.md`、`template.html`、`assets/*.js`、`README.md`、`STYLE.md` 的字符并集生成（当前 1372 个不同字符，其中汉字 1232 个）。唯一没有的字形是 `★`（U+2605）：Maple Mono 系列不含它，它只出现在难度星级里，回退到系统字体不影响等宽正文的排版。

覆盖率由 `python3 tools/verify_build.py` 实测，不写死数字：它读 `dist/*.html` 的正文，逐个汉字查子集 cmap，有缺字就报 FAIL 并列出最常见的几个。当前应为 `0` 缺字，因为子集和内容同步生成。

新增内容引入新字符时重新生成，否则那个字会回退到系统字体，在等宽排版里比例失配。从站点根目录跑：

```bash
python3 - <<'PY'
import glob
chars=set()
for p in glob.glob('content/*.md')+['template.html','assets/app.js','assets/anim.js','README.md','STYLE.md']:
    chars |= set(open(p,encoding='utf-8').read())
chars |= set(chr(c) for c in range(0x20,0x7f))
open('/tmp/chars.txt','w',encoding='utf-8').write(''.join(sorted(chars)))
PY

SRC=/path/to/fonts
for pair in Regular:400 SemiBold:600; do
  pyftsubset "$SRC/MapleMono-NF-CN-${pair%%:*}.ttf" \
    --text-file=/tmp/chars.txt --flavor=woff2 --layout-features='*' \
    --name-IDs='*' --name-legacy --name-languages='*' \
    --output-file="/tmp/infra-mono-${pair##*:}.woff2"
done
```

生成后必须把 name ID 1/3/4/6/16/17 里的 `Maple Mono` 系列名替换成 `Infra Mono`，否则违反 OFL 的保留字体名条款。最后确认缺字为空：

```bash
python3 - <<'PY'
from fontTools.ttLib import TTFont
cm=set(TTFont('assets/fonts/infra-mono-400.woff2').getBestCmap())
chars=set(open('/tmp/chars.txt',encoding='utf-8').read())
print([c for c in chars if ord(c) not in cm and not c.isspace()])
PY
```
