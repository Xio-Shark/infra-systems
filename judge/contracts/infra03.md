# INFRA 03 · submission contracts

Interfaces are not frozen. AOS1–AOS5 and the capstone are accepted manually against `content/agent-os.md`.

`judge/courses/infra03.json` marks the course as `manual`: `--list` shows it, but `--all` skips it unless you name it explicitly:

```bash
./judge/run.sh infra03 aos1
```

Each placeholder test prints `SKIP`; it never reports a pass. See `content/grading.md`.
