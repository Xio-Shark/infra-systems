# 字体

`infra-mono-400.woff2` 和 `infra-mono-600.woff2` 是 Maple Mono CN 的子集，覆盖站点当前用到的全部字符（约 1080 个）。字形来自 Maple Mono；按 SIL Open Font License 的保留字体名要求，子集改名为 `Infra Mono`。许可证见 `OFL.txt`。

没有覆盖的字符会回退到系统字体。新增内容后如需补字，用 fontTools 从 Maple Mono CN 重新生成：

```bash
pyftsubset MapleMono-CN-Regular.ttf \
  --text-file=chars.txt --flavor=woff2 --layout-features='*' \
  --name-IDs='*' --name-legacy --name-languages='*' \
  --output-file=infra-mono-400.woff2
```

`chars.txt` 取 `content/*.md`、`template.html`、`assets/app.js` 的字符并集，另加 ASCII 和常用标点。生成后把 name ID 1/3/4/6/16/17 改成 `Infra Mono`。
