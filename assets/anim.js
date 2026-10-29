(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var SPECS = {};
  var COLOR = {
    accent: "var(--accent)",
    ok: "var(--anim-ok)",
    warn: "var(--anim-warn)",
    info: "var(--anim-info)",
    bad: "var(--anim-bad)",
    muted: "var(--muted)",
    ink: "var(--ink)"
  };
  var reduceMotionQuery = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
  var reduceMotion = !!(reduceMotionQuery && reduceMotionQuery.matches);

  function svg(tag, attrs, parent) {
    var node = document.createElementNS(NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === "text") {
          node.textContent = attrs[key];
        } else {
          node.setAttribute(key, attrs[key]);
        }
      });
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function textEl(parent, x, y, str, cls, anchor) {
    var node = svg(
      "text",
      { x: x, y: y, class: cls || "", "text-anchor": anchor || "start" },
      parent
    );
    node.textContent = str || "";
    return node;
  }

  function setText(node, value) {
    var next = value == null ? "" : String(value);
    if (node.textContent !== next) node.textContent = next;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function colorOf(name) {
    return COLOR[name] || name || COLOR.accent;
  }

  function card(parent, x, y, w, h) {
    var g = svg(
      "g",
      { class: "anim-node", transform: "translate(" + x + "," + y + ")" },
      parent
    );
    var rect = svg("rect", { width: w, height: h, rx: 4 }, g);
    var name = textEl(g, 12, 23, "", "t-name");
    var badge = textEl(g, w - 12, 23, "", "t-badge", "end");
    var sub = textEl(g, 12, 44, "", "t-sub");
    var sub2 = textEl(g, 12, 54, "", "t-sub");
    return {
      g: g,
      rect: rect,
      name: name,
      badge: badge,
      sub: sub,
      sub2: sub2
    };
  }

  function chip(parent, x, y, w, h, label, cls) {
    var g = svg(
      "g",
      {
        class: "anim-chip " + (cls || ""),
        transform: "translate(" + x + "," + y + ")"
      },
      parent
    );
    var rect = svg("rect", { width: w, height: h, rx: 3 }, g);
    var text = textEl(g, w / 2, h / 2 + 3.2, label, "", "middle");
    return { g: g, rect: rect, text: text };
  }

  function taskChip(parent, x, y, w, h, label) {
    var g = svg(
      "g",
      { class: "anim-task", transform: "translate(" + x + "," + y + ")" },
      parent
    );
    var rect = svg("rect", { width: w, height: h, rx: 2 }, g);
    var text = textEl(g, w / 2, h / 2 + 3, label, "", "middle");
    return { g: g, rect: rect, text: text };
  }

  function createWidget(root) {
    var name = root.getAttribute("data-anim");
    var spec = SPECS[name];
    if (!spec) return;

    var steps = spec.steps || [];
    if (!steps.length) return;

    var width = spec.width || 760;
    var height = spec.height || 340;
    var title = root.getAttribute("data-title") || spec.title || "";
    var step = 0;
    var playing = false;
    var timer = null;
    var rafs = [];
    var timers = [];
    var pulsed = [];
    var destroyed = false;

    clear(root);
    root.classList.add("anim");

    var head = document.createElement("div");
    head.className = "anim-head";
    var kicker = document.createElement("p");
    kicker.className = "anim-kicker";
    kicker.textContent = "动态演示";
    var titleNode = document.createElement("h3");
    titleNode.className = "anim-title";
    titleNode.textContent = title;
    var hint = document.createElement("p");
    hint.className = "anim-hint";
    hint.textContent =
      "点“播放”自动推进，也可以单步查看。共 " + steps.length + " 步。";
    head.appendChild(kicker);
    head.appendChild(titleNode);
    head.appendChild(hint);
    root.appendChild(head);

    var stage = document.createElement("div");
    stage.className = "anim-stage";
    var svgRoot = svg(
      "svg",
      {
        class: "anim-svg",
        viewBox: "0 0 " + width + " " + height,
        role: "img",
        "aria-label": title
      },
      stage
    );
    var sceneLayer = svg("g", {}, svgRoot);
    var fxLayer = svg("g", {}, svgRoot);
    root.appendChild(stage);

    var caption = document.createElement("div");
    caption.className = "anim-caption";
    var stepBadge = document.createElement("span");
    stepBadge.className = "anim-step";
    var captionBody = document.createElement("div");
    var captionText = document.createElement("p");
    captionText.className = "anim-text";
    captionText.setAttribute("aria-live", "polite");
    var captionNote = document.createElement("p");
    captionNote.className = "anim-note";
    captionBody.appendChild(captionText);
    captionBody.appendChild(captionNote);
    caption.appendChild(stepBadge);
    caption.appendChild(captionBody);
    root.appendChild(caption);

    var controls = document.createElement("div");
    controls.className = "anim-controls";
    var prevBtn = makeButton("上一步");
    var playBtn = makeButton("播放");
    playBtn.classList.add("is-primary");
    var nextBtn = makeButton("下一步");
    var resetBtn = makeButton("重置");
    var dots = document.createElement("div");
    dots.className = "anim-dots";
    controls.appendChild(prevBtn);
    controls.appendChild(playBtn);
    controls.appendChild(nextBtn);
    controls.appendChild(resetBtn);
    controls.appendChild(dots);
    root.appendChild(controls);

    steps.forEach(function (s, i) {
      var dot = makeButton("");
      dot.className = "anim-dot";
      dot.setAttribute("aria-label", "第 " + (i + 1) + " 步");
      dot.addEventListener("click", function () {
        stop();
        go(i, true);
      });
      dots.appendChild(dot);
    });

    function makeButton(label) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "anim-btn";
      b.textContent = label;
      return b;
    }

    function later(fn, ms) {
      var id = window.setTimeout(fn, ms);
      timers.push(id);
      return id;
    }

    function raf(fn) {
      var id = window.requestAnimationFrame(fn);
      rafs.push(id);
      return id;
    }

    var api = {
      svg: svgRoot,
      layer: sceneLayer,
      fx: fxLayer,
      width: width,
      height: height,
      step: 0,
      animate: false,
      msg: function (opts) {
        var delay = api.animate ? opts.delay || 0 : 0;
        later(function () {
          var x1 = opts.from[0];
          var y1 = opts.from[1];
          var x2 = opts.to[0];
          var y2 = opts.to[1];
          var mx = (x1 + x2) / 2;
          var my = (y1 + y2) / 2;
          var dx = x2 - x1;
          var dy = y2 - y1;
          var len = Math.sqrt(dx * dx + dy * dy) || 1;
          var curve = opts.curve == null ? -18 : opts.curve;
          var cx = mx + (-dy / len) * curve;
          var cy = my + (dx / len) * curve;
          var d = "M" + x1 + " " + y1 + " Q" + cx + " " + cy + " " + x2 + " " + y2;
          var g = svg("g", {}, fxLayer);
          var path = svg("path", { d: d, class: "anim-msg-line" }, g);
          path.style.stroke = colorOf(opts.color);
          if (opts.dashed) path.setAttribute("stroke-dasharray", "4 3");

          var tx = x2 - cx;
          var ty = y2 - cy;
          var tl = Math.sqrt(tx * tx + ty * ty) || 1;
          tx /= tl;
          ty /= tl;
          var bx = x2 - tx * 7;
          var by = y2 - ty * 7;
          var px = -ty * 3.2;
          var py = tx * 3.2;
          var head = svg(
            "polygon",
            {
              points:
                x2 +
                "," +
                y2 +
                " " +
                (bx + px) +
                "," +
                (by + py) +
                " " +
                (bx - px) +
                "," +
                (by - py)
            },
            g
          );
          head.style.fill = colorOf(opts.color);

          if (opts.label) {
            var lx = (x1 + 2 * cx + x2) / 4;
            var ly = (y1 + 2 * cy + y2) / 4;
            var label = textEl(
              g,
              lx,
              ly + (opts.labelDy == null ? -6 : opts.labelDy),
              opts.label,
              "anim-msg-label",
              "middle"
            );
            label.style.fill = colorOf(opts.color);
          }

          var total = path.getTotalLength();
          if (api.animate) {
            path.style.strokeDasharray = total + " " + total;
            path.style.strokeDashoffset = total;
            path.style.transition = "stroke-dashoffset .38s ease";
            raf(function () {
              path.style.strokeDashoffset = 0;
            });
          }

          if (opts.packet !== false && api.animate) {
            var dot = svg("circle", { r: 3, class: "anim-msg-dot" }, g);
            dot.style.fill = colorOf(opts.color);
            var start = null;
            var duration = opts.duration || 620;
            raf(function frame(ts) {
              if (start === null) start = ts;
              var t = Math.min(1, (ts - start) / duration);
              var e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
              var point = path.getPointAtLength(total * e);
              dot.setAttribute("cx", point.x);
              dot.setAttribute("cy", point.y);
              if (t < 1) {
                raf(frame);
              } else {
                later(function () {
                  dot.style.opacity = 0;
                }, 140);
              }
            });
          }
        }, delay);
      },
      token: function (opts) {
        later(function () {
          var g = svg("g", {}, fxLayer);
          var c = svg("circle", { r: 9 }, g);
          c.style.fill =
            "color-mix(in srgb, " +
            colorOf(opts.color) +
            " 18%, var(--surface))";
          c.style.stroke = colorOf(opts.color);
          var t = textEl(g, 0, 3.3, opts.label || "", "t-badge", "middle");
          t.style.fill = colorOf(opts.color);
          var x1 = opts.from[0];
          var y1 = opts.from[1];
          var x2 = opts.to[0];
          var y2 = opts.to[1];
          var start = null;
          var duration = opts.duration || 700;
          g.setAttribute("transform", "translate(" + x1 + "," + y1 + ")");
          raf(function frame(ts) {
            if (start === null) start = ts;
            var p = Math.min(1, (ts - start) / duration);
            var e = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
            g.setAttribute(
              "transform",
              "translate(" + (x1 + (x2 - x1) * e) + "," + (y1 + (y2 - y1) * e) + ")"
            );
            if (p < 1) {
              raf(frame);
            } else {
              later(function () {
                g.style.transition = "opacity .25s";
                g.style.opacity = 0;
              }, 320);
            }
          });
        }, opts.delay || 0);
      },
      pulse: function (node) {
        if (!node || !node.classList) return;
        node.classList.add("anim-pulse");
        pulsed.push(node);
        later(function () {
          node.classList.remove("anim-pulse");
        }, 950);
      },
      clearFx: function () {
        rafs.forEach(function (id) {
          window.cancelAnimationFrame(id);
        });
        rafs = [];
        timers.forEach(function (id) {
          window.clearTimeout(id);
        });
        timers = [];
        pulsed.forEach(function (node) {
          node.classList.remove("anim-pulse");
        });
        pulsed = [];
        clear(fxLayer);
      }
    };

    var refs = spec.build(sceneLayer, api, svgRoot) || {};

    function duration(i) {
      return steps[i].duration || 2400;
    }

    function update() {
      stepBadge.textContent = step + 1 + " / " + steps.length;
      var s = steps[step];
      captionText.textContent = s.caption || "";
      captionNote.textContent = s.note || "";
      captionNote.style.display = s.note ? "" : "none";
      svgRoot.setAttribute(
        "aria-label",
        title + "。" + (s.caption || "") + (s.note ? " " + s.note : "")
      );
      prevBtn.disabled = step === 0;
      nextBtn.disabled = step === steps.length - 1;
      playBtn.textContent = playing ? "暂停" : step === steps.length - 1 ? "重播" : "播放";
      Array.prototype.forEach.call(dots.children, function (dot, i) {
        if (i === step) dot.setAttribute("aria-current", "true");
        else dot.removeAttribute("aria-current");
      });
    }

    function go(index, animate) {
      step = Math.max(0, Math.min(steps.length - 1, index));
      api.clearFx();
      api.step = step;
      api.animate = !!animate && !reduceMotion;
      spec.render(refs, step, api);
      update();
    }

    function stop() {
      playing = false;
      if (timer) window.clearTimeout(timer);
      timer = null;
      update();
    }

    function tick() {
      if (!playing || destroyed) return;
      if (step >= steps.length - 1) {
        playing = false;
        update();
        return;
      }
      go(step + 1, true);
      timer = window.setTimeout(tick, duration(step));
    }

    function play() {
      if (playing) {
        stop();
        return;
      }
      if (step >= steps.length - 1) go(0, false);
      playing = true;
      update();
      timer = window.setTimeout(tick, duration(step));
    }

    prevBtn.addEventListener("click", function () {
      stop();
      go(step - 1, true);
    });
    nextBtn.addEventListener("click", function () {
      stop();
      go(step + 1, true);
    });
    playBtn.addEventListener("click", play);
    resetBtn.addEventListener("click", function () {
      stop();
      go(0, false);
    });

    document.addEventListener("visibilitychange", function () {
      if (document.hidden && playing) stop();
    });

    if ("IntersectionObserver" in window) {
      var observer = new IntersectionObserver(
        function (entries) {
          if (!entries[0].isIntersecting && playing) stop();
        },
        { threshold: 0.05 }
      );
      observer.observe(root);
    }

    go(0, false);
    root.setAttribute("data-anim-ready", "1");
  }

  function boot() {
    var nodes = document.querySelectorAll("[data-anim]");
    Array.prototype.forEach.call(nodes, function (root) {
      var name = root.getAttribute("data-anim");
      if (!SPECS[name]) {
        console.warn("Unknown animation: " + name);
        return;
      }
      try {
        createWidget(root);
      } catch (err) {
        console.error("Animation failed: " + name, err);
        root.setAttribute("data-anim-error", "1");
      }
    });
  }

  window.InfraAnim = {
    SPECS: SPECS,
    boot: boot,
    svg: svg,
    textEl: textEl,
    setText: setText,
    clear: clear,
    card: card,
    chip: chip,
    taskChip: taskChip,
    colorOf: colorOf,
    reduceMotion: reduceMotion
  };
})();

(function () {
  var A = window.InfraAnim;
  var svg = A.svg;
  var textEl = A.textEl;
  var card = A.card;
  var chip = A.chip;
  var taskChip = A.taskChip;

  var TASKS = ["M0", "M1", "M2", "R0", "R1"];
  var WORK_STATE = { run: "运行中", done: "完成", slow: "超时", wait: "等待" };

  var STEPS = [
    {
      caption:
        "coordinator 生成 3 个 map 任务（M0–M2）和 2 个 reduce 任务（R0–R1）；worker 循环来领任务。",
      note: "任务表里只有状态：idle、运行中、完成。coordinator 不读文件，也不做计算。",
      coord: "map 0/3 · reduce 0/2",
      tasks: ["idle", "idle", "idle", "idle", "idle"],
      workers: [null, null, null],
      parts: [[0, 0], [0, 0], [0, 0]],
      outputs: [0, 0]
    },
    {
      caption:
        "三个 worker 各领一个 map，读自己那份 split，对每个单词输出 (word, \"1\")。",
      note: "文件到 worker 的箭头只是任务分配；数据本身在共享文件系统里。",
      coord: "map 0/3 · reduce 0/2",
      tasks: ["run", "run", "run", "idle", "idle"],
      workers: [["M0", "run"], ["M1", "run"], ["M2", "run"]],
      parts: [[0, 0], [0, 0], [0, 0]],
      outputs: [0, 0]
    },
    {
      caption:
        "W1、W3 做完，W2 还在跑。只要有一个 map 没完成，coordinator 就不发 reduce。",
      note: "map 的输出按 hash(key) % 2 分成两列；M0 和 M2 的两列已经落地。",
      coord: "map 2/3 · 等 M1",
      tasks: ["done", "run", "done", "idle", "idle"],
      workers: [["M0", "done"], ["M1", "run"], ["M2", "done"]],
      parts: [[1, 1], [0, 0], [1, 1]],
      outputs: [0, 0]
    },
    {
      caption:
        "M1 超过 10 秒没完成：coordinator 把它重新标成 idle，发给 W3；W2 晚到的报告会被忽略。",
      note: "重发的是同一个任务，不是新任务；允许重复计算，但只接受一次完成报告。",
      coord: "M1 超时 · 重发",
      tasks: ["done", "run", "done", "idle", "idle"],
      workers: [["M0", "done"], ["M1", "slow"], ["M1", "run"]],
      parts: [[1, 1], [0, 0], [1, 1]],
      outputs: [0, 0]
    },
    {
      caption:
        "W3 重跑完 M1，三个 map 都完成；reduce 这才开始，R0 读第 0 列，R1 读第 1 列。",
      note: "reduce 要等所有 map 写完自己那一列；先按 key 分区，避免每个 reduce 读全量数据。",
      coord: "map 3/3 · reduce 0/2",
      tasks: ["done", "done", "done", "run", "run"],
      workers: [["R0", "run"], ["R1", "run"], null],
      parts: [[1, 1], [1, 1], [1, 1]],
      outputs: [0, 0]
    },
    {
      caption:
        "reduce 按键排序、累加，先写临时文件，再 rename 成 mr-out-0 / mr-out-1。",
      note: "rename 是原子的：读者要么看到旧文件，要么看到完整的新文件，不会读到半个。",
      coord: "map 3/3 · reduce 2/2",
      tasks: ["done", "done", "done", "done", "done"],
      workers: [["R0", "done"], ["R1", "done"], null],
      parts: [[1, 1], [1, 1], [1, 1]],
      outputs: [1, 1]
    },
    {
      caption:
        "两个 reduce 都完成，Done() 返回 true；coordinator 退出，worker 联系不上也退出。",
      note: "最终结果是所有 mr-out-* 的并集，测试会排序后和顺序版比较。",
      coord: "Done() = true",
      tasks: ["done", "done", "done", "done", "done"],
      workers: [null, null, null],
      parts: [[1, 1], [1, 1], [1, 1]],
      outputs: [1, 1]
    }
  ];

  A.SPECS["mapreduce"] = {
    title: "MapReduce 一次作业：map、分区、reduce 与超时重发",
    width: 760,
    height: 320,
    steps: STEPS,
    build: function (layer) {
      var refs = {};

      var coord = card(layer, 280, 4, 200, 72);
      coord.name.textContent = "coordinator";
      coord.sub.textContent = "任务表";
      coord.sub.setAttribute("y", "38");
      refs.coord = coord;
      refs.tasks = TASKS.map(function (label, i) {
        return taskChip(coord.g, 10 + i * 37, 48, 31, 16, label);
      });

      var headers = [
        ["输入 split", 24],
        ["map worker", 180],
        ["中间文件（按 key 分区）", 370],
        ["reduce", 560],
        ["输出", 678]
      ];
      headers.forEach(function (h) {
        textEl(layer, h[1], 90, h[0], "t-small");
      });

      refs.files = [0, 1, 2].map(function (i) {
        var c = card(layer, 24, 100 + i * 68, 100, 46);
        c.name.textContent = "f" + i;
        c.sub.textContent = "split " + i;
        c.badge.textContent = "";
        return c;
      });

      refs.workers = [0, 1, 2].map(function (i) {
        var c = card(layer, 180, 100 + i * 68, 130, 46);
        c.name.textContent = "W" + (i + 1);
        c.sub.textContent = "idle";
        c.badge.textContent = "";
        return c;
      });

      refs.parts = [0, 1, 2].map(function (r) {
        return [0, 1].map(function (c) {
          var p = chip(
            layer,
            370 + c * 74,
            100 + r * 56,
            66,
            38,
            "mr-" + r + "-" + c,
            "is-off"
          );
          return p;
        });
      });

      refs.reduces = [0, 1].map(function (i) {
        var c = card(layer, 560, 118 + i * 86, 100, 46);
        c.name.textContent = "R" + i;
        c.sub.textContent = "等 map";
        c.badge.textContent = "";
        return c;
      });

      refs.outputs = [0, 1].map(function (i) {
        var p = chip(layer, 678, 126 + i * 86, 72, 30, "mr-out-" + i, "is-off");
        return p;
      });

      return refs;
    },
    render: function (refs, i, api) {
      var st = STEPS[i];
      A.setText(refs.coord.sub, st.coord);

      st.tasks.forEach(function (state, j) {
        refs.tasks[j].g.setAttribute("class", "anim-task is-" + state);
      });

      st.workers.forEach(function (w, j) {
        var c = refs.workers[j];
        if (!w) {
          c.name.textContent = "W" + (j + 1);
          c.badge.textContent = "";
          c.sub.textContent = i === 6 ? "退出" : "idle";
          c.g.setAttribute("class", "anim-node");
          return;
        }
        c.badge.textContent = w[0];
        c.sub.textContent = WORK_STATE[w[1]] || w[1];
        var cls = "anim-node";
        if (w[1] === "done") cls += " is-good";
        if (w[1] === "run") cls += " is-focus";
        if (w[1] === "slow") cls += " is-slow";
        c.g.setAttribute("class", cls);
      });

      st.parts.forEach(function (row, r) {
        row.forEach(function (on, c) {
          var p = refs.parts[r][c];
          var cls = "anim-chip " + (on ? "is-on" : "is-off");
          if (i === 4 || i === 5) cls += " is-focus";
          p.g.setAttribute("class", cls);
        });
      });

      st.outputs.forEach(function (on, j) {
        refs.outputs[j].g.setAttribute(
          "class",
          "anim-chip " + (on ? "is-on" : "is-off")
        );
      });

      refs.reduces.forEach(function (c, j) {
        var running = i === 4;
        var done = i >= 5;
        c.sub.textContent = i < 4 ? "等 map" : done ? "完成" : "运行中";
        c.g.setAttribute(
          "class",
          "anim-node" + (done ? " is-good" : running ? " is-focus" : "")
        );
      });

      if (i === 1) {
        for (var j = 0; j < 3; j++) {
          api.msg({
            from: [124, 123 + 68 * j],
            to: [180, 123 + 68 * j],
            label: "M" + j,
            color: "accent",
            curve: -10,
            delay: j * 90,
            labelDy: -5
          });
        }
      }

      if (i === 3) {
        api.pulse(refs.workers[2].g);
        api.pulse(refs.tasks[1].g);
      }

      if (i === 4) {
        api.msg({
          from: [436, 156],
          to: [560, 141],
          label: "读 P0",
          color: "accent",
          curve: -12,
          labelDy: -5
        });
        api.msg({
          from: [510, 212],
          to: [560, 227],
          label: "读 P1",
          color: "accent",
          curve: 12,
          delay: 120,
          labelDy: 10
        });
      }

    }
  };
})();

(function () {
  var A = window.InfraAnim;
  var svg = A.svg;
  var textEl = A.textEl;
  var card = A.card;

  var NODE_X = [60, 290, 520];
  var NODE_W = 180;

  var STEPS = [
    {
      caption:
        "三个 server 都是 follower，各自有一个随机 election timeout；S2 的 timer 最短。",
      note: "随机化不是性能优化，它保证系统不会长期卡在 split vote。",
      nodes: [
        { state: "F", term: 0, voted: "—", timer: 0.55 },
        { state: "F", term: 0, voted: "—", timer: 0.22 },
        { state: "F", term: 0, voted: "—", timer: 0.8 }
      ],
      banner: ["三个 follower · term 0", "election timeout 随机：S2 最短，S3 最长"],
      tone: ""
    },
    {
      caption:
        "三个几乎同时超时：term 加一、投自己，向另外两个发 RequestVote。",
      note: "真实实现并行发给所有 peer，收到多数票就上任。",
      nodes: [
        { state: "C", term: 1, voted: "自己", timer: 0.6 },
        { state: "C", term: 1, voted: "自己", timer: 0.6 },
        { state: "C", term: 1, voted: "自己", timer: 0.6 }
      ],
      banner: ["term 1 · 三个人都超时", "各自投自己，并向另外两个发 RequestVote"],
      tone: "warn"
    },
    {
      caption:
        "三票分散，每人 1 票，谁都不到 2 票。这一轮 split vote 作废，等下一轮随机 timer。",
      note: "如果所有节点用同一个 timeout，可能反复同时拉票。",
      nodes: [
        { state: "C", term: 1, voted: "自己", timer: 0.3 },
        { state: "C", term: 1, voted: "自己", timer: 0.28 },
        { state: "C", term: 1, voted: "自己", timer: 0.32 }
      ],
      banner: ["1 / 1 / 1 · 无人过半", "3 个 server 需要 2 票；这一轮作废"],
      tone: "bad"
    },
    {
      caption:
        "下一轮 S2 先超时：term 2，投自己，向 S1、S3 拉票。",
      note: "一票只能投一次；同一个 term 最多一个 leader。",
      nodes: [
        { state: "C", term: 1, voted: "自己", timer: 0.55 },
        { state: "C", term: 2, voted: "自己", timer: 0.5 },
        { state: "C", term: 1, voted: "自己", timer: 0.58 }
      ],
      banner: ["term 2 · S2 先超时", "S2 投自己，向 S1、S3 拉票"],
      tone: "warn"
    },
    {
      caption:
        "S1、S3 检查 term、投票记录和日志新旧，都投 yes；S2 拿到 3 票，成为 term 2 的 leader。",
      note: "多数派是 2/3；S2 自己一票 + S1/S3 两票。",
      nodes: [
        { state: "F", term: 2, voted: "S2", timer: 1 },
        { state: "L", term: 2, voted: "自己", timer: 0 },
        { state: "F", term: 2, voted: "S2", timer: 1 }
      ],
      banner: ["S2 拿到 3 / 3 票", "term 2 的 leader；不等最慢的回复也能上任"],
      tone: "good"
    },
    {
      caption:
        "S2 立刻发心跳；S1、S3 收到后重置 election timeout。",
      note: "心跳就是不带日志的 AppendEntries。",
      nodes: [
        { state: "F", term: 2, voted: "S2", timer: 1 },
        { state: "L", term: 2, voted: "自己", timer: 0 },
        { state: "F", term: 2, voted: "S2", timer: 1 }
      ],
      banner: ["心跳重置 election timeout", "S1、S3 继续当 follower，不会发起选举"],
      tone: "good"
    },
    {
      caption:
        "S2 崩溃，S1 超时后 term 3 拉票；S3 投 yes，S1 拿到 2/3 票当选。",
      note: "旧 leader 失联后 5 秒内要选出新 leader，这是 3A 的测试要求。",
      nodes: [
        { state: "L", term: 3, voted: "自己", timer: 0 },
        { state: "X", term: 2, voted: "自己", timer: 0 },
        { state: "F", term: 3, voted: "S1", timer: 1 }
      ],
      banner: ["S1 当选 term 3", "S2 还挂着；S1 靠自己和 S3 的两票过半"],
      tone: "good"
    },
    {
      caption:
        "S2 恢复后仍以为自己是 term 2 的 leader；S1 回复 term 3，S2 更新 term 并退回 follower。",
      note: "收到更高 term 的请求，任何状态都先更新 currentTerm、清空 votedFor，再转 follower。",
      nodes: [
        { state: "L", term: 3, voted: "自己", timer: 0 },
        { state: "F", term: 3, voted: "—", timer: 1 },
        { state: "F", term: 3, voted: "S1", timer: 1 }
      ],
      banner: ["旧 leader 退位", "S2 收到 term 3，更新 term 后转 follower"],
      tone: "warn"
    }
  ];

  function edge(from, to) {
    var x1 = NODE_X[from];
    var x2 = NODE_X[to];
    if (to === from + 1) return [[x1 + NODE_W - 24, 64], [x2 + 24, 64]];
    if (to === from - 1) return [[x1 + 24, 64], [x2 + NODE_W - 24, 64]];
    return [[x1 + NODE_W / 2, 64], [x2 + NODE_W / 2, 64]];
  }

  function curveFor(from, to) {
    if (Math.abs(from - to) === 1) return to > from ? -24 : 24;
    return to > from ? -36 : 36;
  }

  function send(api, from, to, label, color, delay, curve) {
    var p = edge(from, to);
    api.msg({
      from: p[0],
      to: p[1],
      label: label,
      color: color,
      curve: curve == null ? curveFor(from, to) : curve,
      delay: delay || 0,
      labelDy: -4
    });
  }

  A.SPECS["raft-election"] = {
    title: "Raft 选举：超时、split vote、多数票和旧 leader 退位",
    width: 760,
    height: 340,
    steps: STEPS,
    build: function (layer) {
      var refs = {};
      refs.nodes = [0, 1, 2].map(function (i) {
        var g = svg(
          "g",
          {
            class: "anim-node",
            transform: "translate(" + NODE_X[i] + ",64)"
          },
          layer
        );
        svg("rect", { width: NODE_W, height: 132, rx: 5 }, g);
        var name = textEl(g, 14, 24, "S" + (i + 1), "t-name");
        var badge = textEl(g, NODE_W - 14, 24, "", "t-badge", "end");
        var term = textEl(g, 14, 50, "", "t-sub");
        var voted = textEl(g, 14, 70, "", "t-sub");
        var log = textEl(g, 14, 90, "", "t-sub");
        svg(
          "rect",
          { x: 14, y: 106, width: 152, height: 7, rx: 3.5, class: "anim-bar-bg" },
          g
        );
        var bar = svg(
          "rect",
          { x: 14, y: 106, width: 0, height: 7, rx: 3.5, class: "anim-bar" },
          g
        );
        var timer = textEl(g, 14, 127, "", "t-small");
        return {
          g: g,
          name: name,
          badge: badge,
          term: term,
          voted: voted,
          log: log,
          bar: bar,
          timer: timer
        };
      });

      var banner = svg("g", { class: "anim-banner" }, layer);
      svg("rect", { x: 60, y: 238, width: 640, height: 66, rx: 5 }, banner);
      refs.banner = banner;
      refs.line1 = textEl(banner, 380, 264, "", "t-name", "middle");
      refs.line2 = textEl(banner, 380, 286, "", "t-sub", "middle");

      return refs;
    },
    render: function (refs, i, api) {
      var st = STEPS[i];

      st.nodes.forEach(function (n, j) {
        var c = refs.nodes[j];
        c.name.textContent = "S" + (j + 1);
        c.badge.textContent = n.state + n.term;
        c.term.textContent = "term " + n.term;
        c.voted.textContent = "votedFor: " + (n.voted || "—");
        c.log.textContent = "log: 3 条";
        c.bar.setAttribute("width", String(Math.round(152 * n.timer)));
        c.bar.setAttribute(
          "class",
          "anim-bar" + (n.timer > 0 && n.timer < 0.3 ? " is-hot" : "")
        );
        c.timer.textContent =
          n.state === "L" ? "leader：定期发心跳" : "election timeout";
        var cls = "anim-node";
        if (n.state === "L") cls += " is-leader";
        if (n.state === "C") cls += " is-candidate";
        if (n.state === "X") cls += " is-down";
        c.g.setAttribute("class", cls);
        c.badge.setAttribute(
          "class",
          "t-badge" +
            (n.state === "L"
              ? " is-leader"
              : n.state === "C"
              ? " is-candidate"
              : n.state === "X"
              ? " is-down"
              : "")
        );
      });

      refs.banner.setAttribute(
        "class",
        "anim-banner" + (st.tone ? " is-" + st.tone : "")
      );
      refs.line1.textContent = st.banner[0];
      refs.line2.textContent = st.banner[1];

      if (i === 1) {
        var k = 0;
        for (var a = 0; a < 3; a++) {
          for (var b = 0; b < 3; b++) {
            if (a !== b) {
              send(api, a, b, "RV", "warn", k * 55);
              k++;
            }
          }
        }
      }
      if (i === 3) {
        send(api, 1, 0, "RV term=2", "warn", 0);
        send(api, 1, 2, "RV term=2", "warn", 90);
      }
      if (i === 4) {
        send(api, 0, 1, "yes", "ok", 0);
        send(api, 2, 1, "yes", "ok", 90);
      }
      if (i === 5) {
        send(api, 1, 0, "心跳", "accent", 0);
        send(api, 1, 2, "心跳", "accent", 90);
      }
      if (i === 6) {
        send(api, 0, 2, "RV term=3", "warn", 0, -50);
        send(api, 2, 0, "yes", "ok", 180, 18);
      }
      if (i === 7) {
        send(api, 0, 1, "term=3", "bad", 0, -20);
      }
    }
  };
})();

(function () {
  var A = window.InfraAnim;
  var svg = A.svg;
  var textEl = A.textEl;

  var ROW_H = 50;
  var ROW_Y = 104;
  var COL_X = [240, 320, 400];
  var CELL_W = 64;
  var CELL_H = 38;

  var STEPS = [
    {
      tag: "(a) term 2",
      caption:
        "S1 是 term 2 的 leader，index 2 的 term 2 条目只复制到 S1、S2。",
      note: "2/5 不是多数派，index 2 未提交；index 1 的 term 1 条目已提交。",
      logs: [[1, 2], [1, 2], [1], [1], [1]],
      roles: ["L2", "F2", "F1", "F1", "F1"],
      committed: 1,
      hi: null
    },
    {
      tag: "(b) term 3",
      caption:
        "S1 崩溃；S5 靠 S3、S4、S5 的票当选 term 3，在 index 2 写入另一条。",
      note: "S5 的最后一条是 term 3；S1、S2 的最后一条是 term 2，S5 的日志比它们新。",
      logs: [[1, 2], [1, 2], [1, 3], [1, 3], [1, 3]],
      roles: ["X2", "F3", "F3", "F3", "L3"],
      committed: 1,
      hi: null
    },
    {
      tag: "(c) term 4",
      caption:
        "S1 重启当选 term 4，把 index 2 的 term 2 复制到 S1、S2、S3，并追加 term 4 的新条目。",
      note: "3/5 已经有多数派，但 index 2 不是当前 term 的条目，仍然不能提交。",
      logs: [[1, 2, 4], [1, 2], [1, 2], [1], [1, 3]],
      roles: ["L4", "F4", "F4", "F4", "X3"],
      committed: 1,
      hi: { col: 1, tone: "warn", label: "3/5 有 term 2，但未提交" }
    },
    {
      tag: "(d) term 5",
      caption:
        "S1 崩溃；S5 靠 S2、S3、S4 当选，用 term 3 覆盖 index 2。",
      note: "term 2 从未提交，所以覆盖是合法的；多数派复制不等于提交。",
      logs: [[1, 3], [1, 3], [1, 3], [1, 3], [1, 3]],
      roles: ["X4", "F5", "F5", "F5", "L5"],
      committed: 1,
      hi: { col: 1, tone: "bad", label: "term 2 被覆盖" }
    },
    {
      tag: "(e) 反事实",
      caption:
        "如果 S1 崩溃前先把 term 4 条目复制到 S1、S2、S3，term 4 提交。",
      note: "term 4 一提交，前面 index 2 的 term 2 也间接提交；S5 的日志比多数派旧，拿不到票。S4、S5 缺的条目会在后续 AppendEntries 中补齐。",
      logs: [[1, 2, 4], [1, 2, 4], [1, 2, 4], [1], [1, 3]],
      roles: ["L4", "F4", "F4", "F4", "F4"],
      committed: 3,
      hi: { col: 2, tone: "good", label: "term 4 上多数派 → 提交" }
    },
    {
      tag: "规则",
      caption:
        "leader 只提交当前 term 的条目；旧条目等当前 term 的条目提交后间接提交。",
      note: "实践中新 leader 常先提交一条当前 term 的 no-op，尽快完成这件事。",
      logs: [[1, 2, 4], [1, 2, 4], [1, 2, 4], [1], [1, 3]],
      roles: ["L4", "F4", "F4", "F4", "F4"],
      committed: 3,
      hi: null
    }
  ];

  A.SPECS["raft-commit"] = {
    title: "Raft Figure 8：多数派复制不等于提交",
    width: 760,
    height: 380,
    steps: STEPS,
    build: function (layer) {
      var refs = {};

      refs.note = textEl(layer, 30, 30, "", "t-name");
      textEl(layer, 30, 52, "格子里的数字 = 条目的 term", "t-small");

      refs.commit = textEl(layer, 560, 44, "", "t-badge");
      refs.majority = textEl(layer, 560, 246, "多数派 = 3 / 5", "t-small");

      var hi = svg(
        "rect",
        {
          x: 236,
          y: 96,
          width: 72,
          height: 250,
          rx: 4,
          class: "anim-col-hi"
        },
        layer
      );
      hi.style.opacity = 0;
      refs.hi = hi;
      refs.hiLabel = textEl(layer, 276, 72, "", "t-small", "middle");

      [1, 2, 3].forEach(function (n, c) {
        textEl(layer, COL_X[c] + CELL_W / 2, 86, String(n), "t-small", "middle");
      });

      refs.rows = [0, 1, 2, 3, 4].map(function (r) {
        var y = ROW_Y + r * ROW_H;
        var g = svg("g", { class: "anim-row" }, layer);
        var name = textEl(g, 30, y + 25, "S" + (r + 1), "t-name");
        var badge = textEl(g, 86, y + 25, "", "t-badge");
        var cells = [0, 1, 2].map(function (c) {
          var cell = svg(
            "g",
            {
              class: "anim-cell",
              transform: "translate(" + COL_X[c] + "," + y + ")"
            },
            g
          );
          svg("rect", { width: CELL_W, height: CELL_H, rx: 3 }, cell);
          var term = textEl(cell, CELL_W / 2, 25, "", "", "middle");
          var check = textEl(cell, CELL_W - 6, 33, "✓", "t-check", "end");
          return { g: cell, term: term, check: check };
        });
        return { g: g, name: name, badge: badge, cells: cells };
      });

      textEl(layer, 560, 82, "term", "t-badge");
      [1, 2, 3, 4].forEach(function (n, i) {
        var y = 96 + i * 24;
        var lg = svg(
          "g",
          { class: "anim-cell t" + n, transform: "translate(560," + y + ")" },
          layer
        );
        svg("rect", { width: 14, height: 14, rx: 2 }, lg);
        textEl(layer, 582, y + 11, "term " + n, "t-small");
      });
      textEl(layer, 560, 208, "✓ = 已提交", "t-small");

      return refs;
    },
    render: function (refs, i, api) {
      var st = STEPS[i];
      refs.note.textContent = st.tag;
      refs.commit.textContent = "commitIndex = " + st.committed;

      st.logs.forEach(function (log, r) {
        var row = refs.rows[r];
        var role = st.roles[r];
        row.g.setAttribute(
          "class",
          "anim-row" + (role.charAt(0) === "X" ? " is-down" : "")
        );
        row.badge.textContent = role;
        row.badge.setAttribute(
          "class",
          "t-badge" +
            (role.charAt(0) === "L"
              ? " is-leader"
              : role.charAt(0) === "X"
              ? " is-down"
              : "")
        );
        row.cells.forEach(function (cell, c) {
          var has = c < log.length;
          var cls = "anim-cell";
          if (!has) {
            cls += " is-ghost";
          } else {
            cls += " t" + log[c];
            if (c < st.committed) cls += " is-committed";
          }
          cell.g.setAttribute("class", cls);
          cell.term.textContent = has ? log[c] : "";
          cell.check.textContent = has && c < st.committed ? "✓" : "";
        });
      });

      if (st.hi) {
        var x = COL_X[st.hi.col] - 4;
        refs.hi.setAttribute("x", x);
        refs.hi.setAttribute("class", "anim-col-hi is-" + st.hi.tone);
        refs.hi.style.opacity = 1;
        refs.hiLabel.setAttribute("x", x + 36);
        refs.hiLabel.textContent = st.hi.label;
        refs.hiLabel.style.fill = A.colorOf(
          st.hi.tone === "bad" ? "bad" : st.hi.tone === "good" ? "ok" : "warn"
        );
        api.pulse(refs.hi);
      } else {
        refs.hi.style.opacity = 0;
        refs.hiLabel.textContent = "";
      }
    }
  };
})();

(function () {
  var A = window.InfraAnim;
  var svg = A.svg;
  var textEl = A.textEl;

  var X0 = 120;
  var SCALE = 36;
  var AXIS_Y = 270;
  var ROW_Y = [88, 148, 208];

  function tx(t) {
    return X0 + t * SCALE;
  }

  var STEPS = [
    {
      caption:
        "C1 在 0–10ms 执行 Put(x,1)，C2 在 2–6ms 读，C3 在 12–16ms 读。",
      note: "C2 与 C1 重叠，可以排在 Put 前读到 0；C3 在 Put 返回后才开始，必须读到 1。",
      ops: [
        { start: 0, end: 10, label: "Put(x,1)", ret: "" },
        { start: 2, end: 6, label: "Get(x)", ret: "0" },
        { start: 12, end: 16, label: "Get(x)", ret: "1" }
      ],
      valid: true,
      points: null,
      seq: null,
      order: ""
    },
    {
      caption:
        "给每个操作在调用和返回之间选一个线性化点，再按点排序。",
      note: "C2 的点在 3ms，C1 在 5ms，C3 在 13ms；顺序 C2 → C1 → C3 符合实时序和返回值。",
      ops: [
        { start: 0, end: 10, label: "Put(x,1)", ret: "" },
        { start: 2, end: 6, label: "Get(x)", ret: "0" },
        { start: 12, end: 16, label: "Get(x)", ret: "1" }
      ],
      valid: true,
      points: [5, 3, 13],
      seq: [2, 1, 3],
      order: "C2 → C1 → C3"
    },
    {
      caption:
        "把 C2 的开始挪到 C1 返回之后，仍然读 0，这个历史就不线性一致。",
      note: "C1 已经完成，实时序要求 C2 排在 C1 后，必须看到 1；没有任何点能同时满足。",
      ops: [
        { start: 0, end: 10, label: "Put(x,1)", ret: "" },
        { start: 12, end: 16, label: "Get(x)", ret: "0" },
        null
      ],
      valid: false,
      bad: [1],
      points: null,
      seq: null,
      order: "找不到合法顺序"
    },
    {
      caption:
        "另一种坏历史：先读到 1，之后没有写 0，却又读到 0。",
      note: "值回退了；无论怎么选线性化点，都排不出符合返回值的顺序。",
      ops: [
        { start: 0, end: 10, label: "Put(x,1)", ret: "" },
        { start: 2, end: 6, label: "Get(x)", ret: "1" },
        { start: 12, end: 16, label: "Get(x)", ret: "0" }
      ],
      valid: false,
      bad: [2],
      points: null,
      seq: null,
      order: "找不到合法顺序"
    },
    {
      caption:
        "C2 与 C1 重叠，读 1 也合法：把 Put 的线性化点放在 C2 前面即可。",
      note: "并发操作的顺序可以任选；检查器只要求存在一种合法顺序，不要求唯一。",
      ops: [
        { start: 0, end: 10, label: "Put(x,1)", ret: "" },
        { start: 2, end: 6, label: "Get(x)", ret: "1" },
        { start: 12, end: 16, label: "Get(x)", ret: "1" }
      ],
      valid: true,
      points: [4, 5, 13],
      seq: [1, 2, 3],
      order: "C1 → C2 → C3"
    },
    {
      caption:
        "线性一致 = 每个操作有一个点；按点排序既符合实时序，也符合每个操作的返回值。",
      note: "点是“操作生效”的瞬间，不是调用开始时间；调用和返回之间都可以。",
      ops: [
        { start: 0, end: 10, label: "Put(x,1)", ret: "" },
        { start: 2, end: 6, label: "Get(x)", ret: "0" },
        { start: 12, end: 16, label: "Get(x)", ret: "1" }
      ],
      valid: true,
      points: [5, 3, 13],
      seq: [2, 1, 3],
      order: "C2 → C1 → C3"
    }
  ];

  A.SPECS["linearizability"] = {
    title: "线性一致：实时序、线性化点和坏历史",
    width: 760,
    height: 330,
    steps: STEPS,
    build: function (layer) {
      var refs = {};

      svg(
        "line",
        { x1: X0, y1: AXIS_Y, x2: 710, y2: AXIS_Y, class: "anim-static-arrow" },
        layer
      );
      textEl(layer, 40, AXIS_Y + 4, "时间（ms）", "t-small");

      [0, 4, 8, 12, 16].forEach(function (t) {
        var x = tx(t);
        svg("line", { x1: x, y1: AXIS_Y - 5, x2: x, y2: AXIS_Y + 5, class: "anim-static-arrow" }, layer);
        textEl(layer, x, AXIS_Y + 20, String(t), "t-small", "middle");
      });

      refs.ops = [0, 1, 2].map(function (i) {
        textEl(layer, 40, ROW_Y[i] + 21, "C" + (i + 1), "t-name");
        var g = svg("g", { class: "anim-op" }, layer);
        var rect = svg("rect", { x: 0, y: 0, width: 100, height: 32, rx: 3 }, g);
        var label = textEl(g, 8, -7, "", "", "start");
        var ret = textEl(g, 108, 21, "", "t-ret", "start");
        return { g: g, rect: rect, label: label, ret: ret };
      });

      refs.points = [0, 1, 2].map(function () {
        var g = svg("g", { class: "anim-point" }, layer);
        svg("polygon", { points: "0,-5 5,0 0,5 -5,0" }, g);
        var t = textEl(g, 0, -9, "", "", "middle");
        g.style.opacity = 0;
        return { g: g, text: t };
      });

      var badge = svg("g", { class: "anim-badge" }, layer);
      svg("rect", { x: 540, y: 18, width: 190, height: 36, rx: 4 }, badge);
      refs.badge = badge;
      refs.badgeText = textEl(badge, 635, 41, "", "", "middle");

      refs.order = textEl(layer, X0, 318, "", "t-small");

      return refs;
    },
    render: function (refs, i) {
      var st = STEPS[i];

      st.ops.forEach(function (op, j) {
        var r = refs.ops[j];
        if (!op) {
          r.g.style.opacity = 0;
          return;
        }
        var x = tx(op.start);
        var w = Math.max(10, (op.end - op.start) * SCALE);
        r.g.style.opacity = 1;
        r.g.style.transform = "translate(" + x + "px," + ROW_Y[j] + "px)";
        r.rect.setAttribute("width", String(w));
        r.label.textContent = op.label;
        r.ret.textContent = op.ret ? "→ " + op.ret : "";
        r.ret.setAttribute("x", String(w + 8));
        r.g.setAttribute(
          "class",
          "anim-op" + (st.bad && st.bad.indexOf(j) >= 0 ? " is-bad" : "")
        );
      });

      refs.points.forEach(function (p, j) {
        var t = st.points ? st.points[j] : null;
        if (t == null) {
          p.g.style.opacity = 0;
          return;
        }
        p.g.style.opacity = 1;
        p.g.style.transform = "translate(" + tx(t) + "px," + (ROW_Y[j] + 16) + "px)";
        p.text.textContent = String(st.seq[j]);
      });

      refs.badge.setAttribute(
        "class",
        "anim-badge " + (st.valid ? "is-good" : "is-bad")
      );
      refs.badgeText.textContent = st.valid ? "线性一致 ✓" : "不合法 ✗";
      refs.badgeText.style.fill = st.valid
        ? "var(--anim-ok)"
        : "var(--anim-bad)";

      refs.order.textContent = st.order ? "线性化顺序：" + st.order : "";
    }
  };
})();

(function () {
  var A = window.InfraAnim;
  var svg = A.svg;
  var textEl = A.textEl;
  var card = A.card;

  var STEPS = [
    {
      caption:
        "收到跨分片事务：A 扣 100、B 加 100；coordinator 先把 prepare 写进日志。",
      note: "coordinator 通常是被客户端选中的那个分片，也可以是独立进程。",
      coord: {
        badge: "prepare",
        l1: "journal: prepare",
        l2: "决定：未写",
        l3: "等待 vote",
        state: ""
      },
      a: { badge: "idle", l1: "锁：—", l2: "日志：—", l3: "未开始", state: "" },
      b: { badge: "idle", l1: "锁：—", l2: "日志：—", l3: "未开始", state: "" },
      banner: ["收到跨分片事务：A 扣 100、B 加 100", "coordinator 先把 prepare 写进日志"],
      tone: ""
    },
    {
      caption:
        "prepare 阶段：A、B 检查约束、锁住行、写 prepare 日志，然后回复 yes。",
      note: "它们已经承诺“收到 commit 就执行”，但还不知道最终决定。",
      coord: {
        badge: "wait",
        l1: "journal: prepare",
        l2: "决定：未写",
        l3: "等待 vote",
        state: ""
      },
      a: {
        badge: "prep",
        l1: "锁：行 A",
        l2: "日志：prepare",
        l3: "已投 yes",
        state: "is-prepared"
      },
      b: {
        badge: "prep",
        l1: "锁：行 B",
        l2: "日志：prepare",
        l3: "已投 yes",
        state: "is-prepared"
      },
      banner: ["prepare 阶段：锁住要改的行", "A、B 都回复 yes，但还不知道最终决定"],
      tone: "warn"
    },
    {
      caption:
        "所有 participant 都 yes；coordinator 把 commit 写进日志，再发 commit。",
      note: "决定一旦落盘，恢复后就能重发；这是 2PC 的恢复核心。",
      coord: {
        badge: "commit",
        l1: "journal: commit",
        l2: "决定：commit",
        l3: "已落盘",
        state: "is-good"
      },
      a: {
        badge: "prep",
        l1: "锁：行 A",
        l2: "日志：prepare",
        l3: "等 commit",
        state: "is-prepared"
      },
      b: {
        badge: "prep",
        l1: "锁：行 B",
        l2: "日志：prepare",
        l3: "等 commit",
        state: "is-prepared"
      },
      banner: ["所有 participant 都 yes", "coordinator 写 commit 日志，再发 commit"],
      tone: "good"
    },
    {
      caption:
        "A 收到 commit 并提交；发到 B 时 coordinator 崩溃，B 还停在 prepared。",
      note: "A 已提交，B 未提交；事务只完成一半，B 还握着锁。",
      coord: {
        badge: "×",
        l1: "崩溃",
        l2: "日志：commit",
        l3: "无法重发",
        state: "is-down"
      },
      a: {
        badge: "done",
        l1: "锁：已释放",
        l2: "修改：已生效",
        l3: "状态：已提交",
        state: "is-good"
      },
      b: {
        badge: "prep",
        l1: "锁：行 B",
        l2: "日志：prepare",
        l3: "等了很久",
        state: "is-prepared"
      },
      banner: ["A 已提交；发到 B 时 coordinator 崩溃", "A = committed，B = prepared，事务只完成一半"],
      tone: "bad"
    },
    {
      caption:
        "B 投过 yes、锁在手里，不能自己 abort；它只能等 coordinator 恢复。",
      note: "如果 B 擅自 abort，而 coordinator 实际已决定 commit，原子性就破了。",
      coord: {
        badge: "×",
        l1: "崩溃",
        l2: "日志：commit",
        l3: "无法重发",
        state: "is-down"
      },
      a: {
        badge: "done",
        l1: "锁：已释放",
        l2: "修改：已生效",
        l3: "状态：已提交",
        state: "is-good"
      },
      b: {
        badge: "block",
        l1: "锁：行 B",
        l2: "日志：prepare",
        l3: "不能 abort",
        state: "is-slow"
      },
      banner: ["B 投过 yes、锁在手里，不能自己 abort", "只能等 coordinator 恢复，或向其他 participant 打听"],
      tone: "warn"
    },
    {
      caption:
        "coordinator 恢复，日志里已经有 commit；它重发 commit，B 提交并释放锁。",
      note: "恢复后不能改主意：决定已经落盘，只能向前。",
      coord: {
        badge: "commit",
        l1: "journal: commit",
        l2: "决定：commit",
        l3: "重发 commit",
        state: "is-good"
      },
      a: {
        badge: "done",
        l1: "锁：已释放",
        l2: "修改：已生效",
        l3: "状态：已提交",
        state: "is-good"
      },
      b: {
        badge: "done",
        l1: "锁：已释放",
        l2: "修改：已生效",
        l3: "状态：已提交",
        state: "is-good"
      },
      banner: ["coordinator 恢复，日志里有 commit", "重发 commit；B 提交并释放锁"],
      tone: "good"
    },
    {
      caption:
        "两种崩溃点：写 commit 日志前可以 abort；写完之后只能向前。",
      note: "如果 coordinator 永久丢失，基本 2PC 没有解，participant 会一直阻塞并占锁。",
      coord: {
        badge: "commit",
        l1: "journal: commit",
        l2: "决定：commit",
        l3: "恢复后重发",
        state: "is-good"
      },
      a: {
        badge: "done",
        l1: "锁：已释放",
        l2: "修改：已生效",
        l3: "状态：已提交",
        state: "is-good"
      },
      b: {
        badge: "done",
        l1: "锁：已释放",
        l2: "修改：已生效",
        l3: "状态：已提交",
        state: "is-good"
      },
      banner: ["写 commit 日志前崩溃 → 可以安全 abort", "写 commit 日志后崩溃 → 只能向前，重发 commit"],
      tone: "warn"
    }
  ];

  function pcCard(layer, x, y, w, h, name) {
    var c = card(layer, x, y, w, h);
    c.name.textContent = name;
    c.sub.setAttribute("y", "44");
    c.sub2.setAttribute("y", "64");
    c.line3 = textEl(c.g, 12, 84, "", "t-sub");
    return c;
  }

  function paint(c, d) {
    c.badge.textContent = d.badge;
    c.sub.textContent = d.l1;
    c.sub2.textContent = d.l2;
    c.line3.textContent = d.l3;
    c.g.setAttribute("class", "anim-node " + (d.state || ""));
  }

  A.SPECS["two-phase-commit"] = {
    title: "两阶段提交：prepare、commit 和 coordinator 崩溃",
    width: 760,
    height: 380,
    steps: STEPS,
    build: function (layer) {
      var refs = {};
      refs.coord = pcCard(layer, 40, 150, 160, 92, "coordinator");
      refs.a = pcCard(layer, 410, 92, 180, 92, "participant A");
      refs.b = pcCard(layer, 410, 210, 180, 92, "participant B");

      var banner = svg("g", { class: "anim-banner" }, layer);
      svg("rect", { x: 40, y: 16, width: 680, height: 60, rx: 5 }, banner);
      refs.banner = banner;
      refs.line1 = textEl(banner, 380, 43, "", "t-name", "middle");
      refs.line2 = textEl(banner, 380, 64, "", "t-sub", "middle");

      refs.branch = svg("g", {}, layer);
      refs.branch.style.opacity = 0;
      [
        [40, "写 commit 日志前崩溃", "participant 可以安全 abort"],
        [400, "写 commit 日志后崩溃", "只能重发 commit，不能回滚"]
      ].forEach(function (item) {
        var g = svg("g", { class: "anim-branch", transform: "translate(" + item[0] + ",330)" }, refs.branch);
        svg("rect", { width: 320, height: 38, rx: 3 }, g);
        textEl(g, 12, 17, item[1], "t-small");
        textEl(g, 12, 32, item[2], "t-small");
      });

      return refs;
    },
    render: function (refs, i, api) {
      var st = STEPS[i];
      paint(refs.coord, st.coord);
      paint(refs.a, st.a);
      paint(refs.b, st.b);

      refs.banner.setAttribute(
        "class",
        "anim-banner" + (st.tone ? " is-" + st.tone : "")
      );
      refs.line1.textContent = st.banner[0];
      refs.line2.textContent = st.banner[1];
      refs.branch.style.opacity = i === 6 ? 1 : 0;

      if (i === 1) {
        api.msg({ from: [200, 196], to: [410, 138], label: "prepare", color: "warn", curve: -26, labelDy: -14 });
        api.msg({ from: [200, 196], to: [410, 256], label: "prepare", color: "warn", curve: 26, delay: 90, labelDy: -14 });
        api.msg({ from: [410, 128], to: [200, 186], label: "yes", color: "ok", curve: 22, delay: 220, labelDy: 20 });
        api.msg({ from: [410, 266], to: [200, 206], label: "yes", color: "ok", curve: -22, delay: 280, labelDy: 20 });
      }
      if (i === 2) {
        api.msg({ from: [200, 196], to: [410, 138], label: "commit", color: "ok", curve: -26 });
        api.msg({ from: [200, 196], to: [410, 256], label: "commit", color: "ok", curve: 26, delay: 100 });
      }
      if (i === 3) {
        api.msg({ from: [200, 196], to: [410, 138], label: "commit 已送达", color: "ok", curve: -26 });
        api.pulse(refs.coord.g);
        api.pulse(refs.b.g);
      }
      if (i === 4) {
        api.pulse(refs.b.g);
      }
      if (i === 5) {
        api.msg({ from: [200, 196], to: [410, 256], label: "重发 commit", color: "ok", curve: 26 });
      }
    }
  };
})();

(function () {
  var A = window.InfraAnim;
  var svg = A.svg;
  var textEl = A.textEl;
  var card = A.card;
  var chip = A.chip;

  var INIT_X = [60, 150, 240];
  var FINAL_X = [60, 150, 240];
  var FINAL_X2 = [440, 530, 620];

  function initPos(i) {
    return [INIT_X[i % 3], 166 + Math.floor(i / 3) * 46];
  }

  function finalPos(i) {
    if (i < 6) return [FINAL_X[i % 3], 190 + Math.floor(i / 3) * 48];
    var k = i - 6;
    return [FINAL_X2[k % 3], 190 + Math.floor(k / 3) * 48];
  }

  var STEPS = [
    {
      caption:
        "初始配置 Num=1：12 个 shard 全部由 G1 服务。",
      note: "controller 把配置存在复制 KV 里；Num 是配置编号，也是后面挡住旧请求的版本号。",
      num: 1,
      phase: 0,
      config: "config Num=1 · shard 0–11 → G1",
      ctrl: ["Num=1", "serve all"],
      g1: "serving 0–11",
      g2: "empty"
    },
    {
      caption:
        "controller 算出下一版 Num=2：shard 0–5 留在 G1，6–11 迁到 G2。",
      note: "这时配置还没发布，客户端仍然按 Num=1 访问 G1。",
      num: 1,
      phase: 1,
      config: "config Num=1 · shard 0–11 → G1",
      ctrl: ["Num=1", "next=2"],
      g1: "serving 0–11",
      g2: "target: 6–11"
    },
    {
      caption:
        "G1 对 6–11 执行 FreezeShard：返回状态后停止服务这些 shard。",
      note: "freeze 是让源组先停写；Num=2 随请求带上，重复请求会被版本号挡住。",
      num: 1,
      phase: 2,
      config: "config Num=1 · shard 0–11 → G1",
      ctrl: ["next=2", "freeze 完成"],
      g1: "frozen 6–11",
      g2: "waiting install"
    },
    {
      caption:
        "G2 对 6–11 执行 InstallShard，把状态装进自己的复制状态机。",
      note: "Install 可能重复；同一个 Num 重复安装要幂等，不能把状态装两次。",
      num: 1,
      phase: 3,
      config: "config Num=1 · shard 0–11 → G1",
      ctrl: ["next=2", "install 完成"],
      g1: "not serving 6–11",
      g2: "installed 6–11"
    },
    {
      caption:
        "controller 发布 Num=2；客户端开始把 6–11 路由到 G2。",
      note: "G1 上还留着旧副本，标记成 ghost；要等 DeleteShard 才真正删掉。",
      num: 2,
      phase: 4,
      config: "config Num=2 · shard 0–5 → G1，6–11 → G2",
      ctrl: ["Num=2", "published"],
      g1: "serving 0–5",
      g2: "serving 6–11"
    },
    {
      caption:
        "controller 崩溃后重启：Query() 读到 Num=2，从当前配置继续，不重放旧决定。",
      note: "迟到的 Num=1 请求会被拒绝；新 controller 不需要知道旧 controller 做到哪一步。",
      num: 2,
      phase: 5,
      config: "config Num=2 · shard 0–5 → G1，6–11 → G2",
      ctrl: ["Num=2", "Query → Num=2"],
      g1: "serving 0–5",
      g2: "serving 6–11"
    },
    {
      caption:
        "G1 对 6–11 执行 DeleteShard，旧副本清理完毕，迁移结束。",
      note: "Delete 也必须带 Num=2；重复 Delete 幂等，旧 Num 的 Delete 要被拒绝。",
      num: 2,
      phase: 6,
      config: "config Num=2 · shard 0–5 → G1，6–11 → G2",
      ctrl: ["Num=2", "cleanup 完成"],
      g1: "serving 0–5",
      g2: "serving 6–11"
    }
  ];

  A.SPECS["shard-migration"] = {
    title: "分片迁移：freeze、install、发布配置和 Num 防重",
    width: 760,
    height: 400,
    steps: STEPS,
    build: function (layer) {
      var refs = {};

      refs.ctrl = card(layer, 300, 10, 160, 46);
      refs.ctrl.name.textContent = "controller";
      refs.ctrl.sub.setAttribute("y", "39");

      var cfg = svg("g", { class: "anim-config" }, layer);
      svg("rect", { x: 40, y: 356, width: 680, height: 28, rx: 3 }, cfg);
      refs.config = textEl(cfg, 380, 374, "", "t-small", "middle");

      svg("rect", { x: 40, y: 100, width: 300, height: 250, rx: 5, class: "anim-group-box" }, layer);
      svg("rect", { x: 420, y: 100, width: 300, height: 250, rx: 5, class: "anim-group-box" }, layer);
      textEl(layer, 54, 124, "G1 · S1 S2 S3", "t-name");
      textEl(layer, 434, 124, "G2 · S1 S2 S3", "t-name");
      refs.g1 = textEl(layer, 54, 142, "", "t-small");
      refs.g2 = textEl(layer, 434, 142, "", "t-small");

      refs.chips = [];
      refs.ghosts = [];
      for (var i = 0; i < 12; i++) {
        var p = initPos(i);
        var g = svg(
          "g",
          { class: "anim-shard is-served", transform: "translate(" + p[0] + "," + p[1] + ")" },
          layer
        );
        svg("rect", { width: 56, height: 32, rx: 3 }, g);
        var t = textEl(g, 28, 21, String(i), "", "middle");
        refs.chips.push({ g: g, text: t });

        if (i >= 6) {
          var gh = svg(
            "g",
            { class: "anim-shard is-ghost", transform: "translate(" + p[0] + "," + p[1] + ")" },
            layer
          );
          svg("rect", { width: 56, height: 32, rx: 3 }, gh);
          textEl(gh, 28, 21, String(i), "", "middle");
          gh.style.display = "none";
          refs.ghosts.push(gh);
        }
      }

      refs.reject = textEl(layer, 520, 34, "旧 Num=1 请求被拒绝 ✗", "t-small");
      refs.reject.style.fill = "var(--anim-bad)";
      refs.reject.style.opacity = 0;

      return refs;
    },
    render: function (refs, i, api) {
      var st = STEPS[i];
      refs.ctrl.name.textContent = i >= 5 ? "controller′" : "controller";
      refs.ctrl.badge.textContent = st.ctrl[0];
      refs.ctrl.sub.textContent = st.ctrl[1];
      refs.ctrl.g.setAttribute("class", "anim-node" + (i === 5 ? " is-focus" : ""));
      refs.config.textContent = st.config;
      refs.g1.textContent = st.g1;
      refs.g2.textContent = st.g2;
      refs.reject.style.opacity = i === 5 ? 1 : 0;

      refs.chips.forEach(function (c, idx) {
        var pos = i >= 3 ? finalPos(idx) : initPos(idx);
        c.g.style.transform = "translate(" + pos[0] + "px," + pos[1] + "px)";
        var cls = "anim-shard";
        if (idx < 6) {
          cls += " is-served";
        } else if (i <= 1) {
          cls += " is-served" + (i === 1 ? " is-target" : "");
        } else if (i === 2) {
          cls += " is-frozen";
        } else if (i === 3) {
          cls += " is-installing";
        } else {
          cls += " is-served";
        }
        c.g.setAttribute("class", cls);
      });

      refs.ghosts.forEach(function (gh) {
        gh.style.display = i >= 3 && i <= 5 ? "" : "none";
      });

      if (i === 2) {
        api.msg({
          from: [380, 56],
          to: [190, 100],
          label: "Freeze(6–11, Num=2)",
          color: "warn",
          curve: -26,
          labelDy: -8
        });
      }
      if (i === 3) {
        api.msg({
          from: [380, 56],
          to: [570, 100],
          label: "Install(state, Num=2)",
          color: "info",
          curve: 26,
          labelDy: -8
        });
      }
      if (i === 4) {
        refs.config.style.fill = "var(--accent)";
      } else {
        refs.config.style.fill = "";
      }
      if (i === 6) {
        api.msg({
          from: [380, 56],
          to: [190, 100],
          label: "Delete(6–11, Num=2)",
          color: "muted",
          curve: -26,
          labelDy: -8
        });
      }
    }
  };
})();

(function () {
  var A = window.InfraAnim;
  var svg = A.svg;
  var textEl = A.textEl;

  function proc(layer, x, y, w, text, cls) {
    var g = svg(
      "g",
      { class: "anim-proc " + (cls || ""), transform: "translate(" + x + "," + y + ")" },
      layer
    );
    svg("rect", { width: w, height: 26, rx: 3 }, g);
    var t = textEl(g, 10, 17, text, "t-mono");
    return { g: g, text: t };
  }

  function info(layer, x, y, w, text) {
    var g = svg("g", { class: "anim-proc", transform: "translate(" + x + "," + y + ")" }, layer);
    svg("rect", { width: w, height: 24, rx: 3 }, g);
    var t = textEl(g, 10, 16, text, "t-small");
    return { g: g, text: t };
  }

  var STEPS = [
    {
      caption:
        "宿主机上能看到所有进程；cn1 只是普通进程 PID 1000。",
      note: "容器不是轻量虚拟机；它首先是 namespace + cgroup + 文件系统。",
      childIn: false,
      ns: false,
      rootfs: false,
      cg: false,
      used: 0,
      oom: false,
      exit: false
    },
    {
      caption:
        "cn1 用 clone 创建 PID、mount、UTS、IPC、NET 五个 namespace；子进程在里面是 1 号。",
      note: "宿主机看到的是 PID 1001；容器内看到的是 PID 1，两个视角同时存在。",
      childIn: true,
      ns: true,
      rootfs: false,
      cg: false,
      used: 0,
      oom: false,
      exit: false
    },
    {
      caption:
        "pivot_root 把根换成 rootfs；/proc 只列出命名空间内的进程，hostname 变成 cn1。",
      note: "mount namespace 让挂载点互不影响；pivot_root 比 chroot 更彻底，旧根可以卸载。",
      childIn: true,
      ns: true,
      rootfs: true,
      cg: false,
      used: 0,
      oom: false,
      exit: false
    },
    {
      caption:
        "父进程把子进程的宿主 PID 写进 cgroup.procs，再设 memory.max=64M。",
      note: "先写 cgroup.procs 再设上限，避免中间出现一段没有限制的窗口。",
      childIn: true,
      ns: true,
      rootfs: true,
      cg: true,
      used: 20,
      oom: false,
      exit: false
    },
    {
      caption:
        "子进程分配超过 64M，cgroup OOM killer 杀掉它；退出码 137。",
      note: "137 = 128 + 9，表示进程被 SIGKILL；这不是 cn1 自己返回的错误。",
      childIn: true,
      ns: true,
      rootfs: true,
      cg: true,
      used: 80,
      oom: true,
      exit: true
    },
    {
      caption:
        "父进程 waitpid 后删除 cgroup，把子进程的退出码原样返回。",
      note: "清理要等子进程退出后再做；cgroup 目录还挂着进程时删不掉。",
      childIn: true,
      ns: true,
      rootfs: true,
      cg: false,
      used: 0,
      oom: false,
      exit: true
    }
  ];

  A.SPECS["namespace-isolation"] = {
    title: "容器隔离：namespace、pivot_root 和 cgroup OOM",
    width: 760,
    height: 420,
    steps: STEPS,
    build: function (layer) {
      var refs = {};

      var hostPanel = svg("rect", { x: 30, y: 70, width: 310, height: 250, rx: 5, class: "anim-panel" }, layer);
      var contPanel = svg("rect", { x: 420, y: 70, width: 310, height: 250, rx: 5, class: "anim-panel" }, layer);
      refs.hostPanel = hostPanel;
      refs.contPanel = contPanel;
      textEl(layer, 44, 94, "宿主视角", "t-name");
      textEl(layer, 434, 94, "容器内视角", "t-name");

      refs.procs = [
        proc(layer, 50, 110, 270, "PID 900   sshd"),
        proc(layer, 50, 144, 270, "PID 1000  cn1"),
        proc(layer, 50, 178, 270, "PID 1001  sleep", "is-child"),
        proc(layer, 50, 212, 270, "PID 1002  sh")
      ];
      refs.child = refs.procs[2];

      refs.rootHost = info(layer, 50, 252, 270, "root: /");
      refs.hostHost = info(layer, 50, 284, 270, "hostname: host");

      refs.ns = svg("g", {}, layer);
      refs.ns.style.opacity = 0;
      ["pid", "mnt", "uts", "ipc", "net"].forEach(function (n, i) {
        var g = svg(
          "g",
          { class: "anim-ns-pill", transform: "translate(" + (434 + i * 50) + ",108)" },
          refs.ns
        );
        svg("rect", { width: 44, height: 18, rx: 3 }, g);
        textEl(g, 22, 12.5, n, "", "middle");
      });

      refs.childBox = svg("g", {}, layer);
      refs.childBox.style.opacity = 0;
      svg("rect", { x: 440, y: 140, width: 270, height: 26, rx: 3, class: "anim-proc-box" }, refs.childBox);
      refs.childText = textEl(refs.childBox, 450, 157, "PID 1  sleep", "t-mono");

      refs.rootCont = info(layer, 440, 176, 270, "root: /（rootfs 已经是 /）");
      refs.hostCont = info(layer, 440, 208, 270, "hostname: cn1");
      refs.procCont = info(layer, 440, 240, 270, "ps: 只看到 PID 1");
      [refs.rootCont.g, refs.hostCont.g, refs.procCont.g].forEach(function (g) {
        g.style.opacity = 0;
      });

      refs.cg = svg("g", {}, layer);
      refs.cg.style.opacity = 0;
      svg("rect", { x: 30, y: 345, width: 700, height: 55, rx: 4, class: "anim-panel" }, refs.cg);
      textEl(refs.cg, 44, 369, "cgroup v2", "t-name");
      textEl(refs.cg, 44, 388, "memory.max = 64M", "t-small");
      svg("rect", { x: 300, y: 362, width: 300, height: 12, rx: 6, class: "anim-bar-bg" }, refs.cg);
      refs.cgBar = svg("rect", { x: 300, y: 362, width: 0, height: 12, rx: 6, class: "anim-bar" }, refs.cg);
      refs.cgUsed = textEl(refs.cg, 620, 372, "", "t-badge");
      refs.exit = textEl(layer, 620, 392, "", "t-badge");
      refs.exit.style.fill = "var(--anim-bad)";

      return refs;
    },
    render: function (refs, i, api) {
      var st = STEPS[i];
      var childPos = st.childIn ? [440, 176] : [50, 178];

      refs.child.g.style.transform =
        "translate(" + childPos[0] + "px," + childPos[1] + "px)";
      refs.child.text.textContent = st.childIn ? "PID 1  sleep" : "PID 1001  sleep";
      refs.child.g.setAttribute(
        "class",
        "anim-proc is-child" + (st.oom ? " is-down" : "")
      );
      refs.child.g.style.display = st.childIn ? "none" : "";
      refs.childBox.style.opacity = st.childIn ? (i === 5 ? 0.45 : 1) : 0;
      refs.childText.textContent =
        i === 5 ? "PID 1  sleep（已退出）" : st.oom ? "PID 1  sleep ✕" : "PID 1  sleep";
      refs.childText.style.fill = st.oom
        ? "var(--anim-bad)"
        : i === 5
        ? "var(--muted)"
        : "";

      refs.ns.style.opacity = st.ns ? 1 : 0;
      refs.rootCont.g.style.opacity = st.rootfs ? 1 : 0;
      refs.hostCont.g.style.opacity = st.rootfs ? 1 : 0;
      refs.procCont.g.style.opacity = st.rootfs ? 1 : 0;

      refs.contPanel.setAttribute(
        "class",
        "anim-panel" + (st.oom ? " is-bad" : "")
      );

      refs.cg.style.opacity = st.cg || i === 5 ? 1 : 0;
      var width = st.cg ? Math.min(300, (st.used / 64) * 300) : 0;
      refs.cgBar.setAttribute("width", String(width));
      refs.cgBar.style.opacity = st.cg ? 1 : 0;
      refs.cgBar.setAttribute("class", "anim-bar" + (st.oom ? " is-over" : ""));
      refs.cgUsed.textContent = st.cg
        ? st.used + "M / 64M" + (st.oom ? " · OOM" : "")
        : i === 5
        ? "已清理"
        : "";
      refs.exit.textContent = st.exit ? "退出码 137" : "";

      if (i === 1) {
        api.msg({
          from: [320, 157],
          to: [440, 153],
          label: "clone(5 namespaces)",
          color: "accent",
          curve: -28,
          labelDy: -7
        });
      }
      if (i === 3) {
        api.msg({
          from: [330, 320],
          to: [300, 362],
          label: "写 cgroup.procs",
          color: "info",
          curve: -22,
          labelDy: -6
        });
      }
      if (i === 4) {
        api.pulse(refs.cg);
      }
      if (i === 5) {
        api.msg({
          from: [300, 362],
          to: [190, 320],
          label: "删除 cgroup",
          color: "muted",
          curve: 20,
          labelDy: 12
        });
      }
    }
  };
})();

(function () {
  var A = window.InfraAnim;
  var svg = A.svg;
  var textEl = A.textEl;

  function arrow(layer, x1, y1, x2, y2, label, lx, ly) {
    var g = svg("g", {}, layer);
    var line = svg(
      "line",
      { x1: x1, y1: y1, x2: x2, y2: y2, class: "anim-static-arrow" },
      g
    );
    var dx = x2 - x1;
    var dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / len;
    var uy = dy / len;
    var bx = x2 - ux * 6;
    var by = y2 - uy * 6;
    var px = -uy * 3;
    var py = ux * 3;
    svg(
      "polygon",
      {
        points:
          x2 + "," + y2 + " " + (bx + px) + "," + (by + py) + " " + (bx - px) + "," + (by - py),
        class: "anim-static-arrow"
      },
      g
    ).style.fill = "var(--line)";
    if (label) textEl(g, lx, ly, label, "t-small");
    return g;
  }

  function jnode(layer, x, y, name, sub) {
    var g = svg("g", { class: "anim-journal", transform: "translate(" + x + "," + y + ")" }, layer);
    svg("rect", { width: 120, height: 48, rx: 4 }, g);
    var n = textEl(g, 12, 21, name, "t-name");
    var s = textEl(g, 12, 38, sub, "t-small");
    return { g: g, name: n, sub: s };
  }

  function fsbox(layer, x, y, w, label, sub) {
    var g = svg("g", { class: "anim-fs", transform: "translate(" + x + "," + y + ")" }, layer);
    svg("rect", { width: w, height: 44, rx: 4 }, g);
    var n = textEl(g, 10, 19, label, "t-mono");
    var s = textEl(g, 10, 35, sub, "t-small");
    return { g: g, name: n, sub: s };
  }

  var STEPS = [
    {
      caption: "初始：current → gen/1；base=1，准备提交新代。",
      note: "gen/0 是只读基线；每次提交产生一个完整的新代，不原地改旧代。",
      journal: "none",
      gen2: false,
      current: 1,
      crash: null,
      staging: false,
      commit: false
    },
    {
      caption:
        "写 intent 记录并 fsync journal；记下基线版本、变更列表和副作用列表。",
      note: "先写日志再动文件；崩溃后靠这条记录判断“这次提交想做什么”。",
      journal: "intent",
      gen2: false,
      current: 1,
      crash: null,
      staging: true,
      commit: false
    },
    {
      caption:
        "把未变的文件硬链接或复制进 gen/2，写入新文件、.manifest，再 fsync。",
      note: "新代是完整文件树；manifest 记录文件列表、hash 和父代。",
      journal: "prepared",
      gen2: true,
      current: 1,
      crash: null,
      staging: true,
      commit: false
    },
    {
      caption:
        "追加 prepared 并 fsync；此时还没有提交，current 仍指 gen/1。",
      note: "prepared 只表示“新代已经写好”，不表示“已经生效”。",
      journal: "prepared",
      gen2: true,
      current: 1,
      crash: null,
      staging: true,
      commit: false
    },
    {
      caption:
        "rename 临时符号链接覆盖 current → gen/2；这是唯一的提交点。",
      note: "rename 是原子的：读者要么看到旧代，要么看到新代，不会看到半个目录。",
      journal: "prepared",
      gen2: true,
      current: 2,
      crash: null,
      staging: false,
      commit: true
    },
    {
      caption: "追加 committed 并 fsync，释放锁；事务完成。",
      note: "committed 记录是事后确认，不是提交点；提交点在 current 的 rename。",
      journal: "committed",
      gen2: true,
      current: 2,
      crash: null,
      staging: false,
      commit: true
    },
    {
      caption:
        "崩溃 A：prepared 后、rename 前崩溃。current 仍指 gen/1，恢复可继续或 abort。",
      note: "此时 gen/2 可能是完整的新代，也可能是垃圾；没有 rename，它不会被读者看见。",
      journal: "prepared",
      gen2: true,
      current: 1,
      crash: "A",
      staging: false,
      commit: false
    },
    {
      caption:
        "崩溃 B：rename 后、committed 前崩溃。current 已指 gen/2；恢复补写 committed。",
      note: "一旦 current 指向新代，就不能回滚；恢复只能向前补记录。",
      journal: "prepared",
      gen2: true,
      current: 2,
      crash: "B",
      staging: false,
      commit: true
    },
    {
      caption:
        "结论：提交点是 current 的 rename，不是 committed 记录；journal 决定恢复方向。",
      note: "恢复时先看 current 指向哪一代，再看最后一条 journal 记录；两者一起决定往前走还是回滚。",
      journal: "committed",
      gen2: true,
      current: 2,
      crash: null,
      staging: false,
      commit: true
    }
  ];

  A.SPECS["workspace-tx"] = {
    title: "工作区事务：intent、prepared、rename 和崩溃恢复",
    width: 760,
    height: 320,
    steps: STEPS,
    build: function (layer) {
      var refs = {};

      refs.j = {
        intent: jnode(layer, 50, 44, "intent", "base=1，变更列表"),
        prepared: jnode(layer, 240, 44, "prepared", "manifest 已落盘"),
        committed: jnode(layer, 430, 44, "committed", "对读者可见"),
        aborted: jnode(layer, 240, 140, "aborted", "回滚并清理")
      };

      arrow(layer, 170, 68, 240, 68, "stage", 190, 60);
      arrow(layer, 360, 68, 430, 68, "rename", 382, 60);
      arrow(layer, 110, 92, 240, 140, "abort", 125, 122);
      arrow(layer, 300, 92, 300, 140, "abort / crash", 310, 122);

      refs.gen0 = fsbox(layer, 50, 250, 110, "gen/0", "只读基线");
      refs.gen1 = fsbox(layer, 190, 250, 110, "gen/1", "当前代");
      refs.gen2 = fsbox(layer, 330, 250, 110, "gen/2", "新代");
      refs.current = fsbox(layer, 510, 250, 110, "current", "→ gen/1");
      refs.staging = fsbox(layer, 510, 160, 110, ".staging", "本次变更");

      refs.cur1 = svg("g", {}, layer);
      var l1 = svg(
        "line",
        { x1: 510, y1: 272, x2: 300, y2: 272, class: "anim-static-arrow" },
        refs.cur1
      );
      l1.style.stroke = "var(--accent)";
      svg("polygon", { points: "300,272 306,269 306,275", class: "anim-static-arrow" }, refs.cur1).style.fill = "var(--accent)";

      refs.cur2 = svg("g", {}, layer);
      var l2 = svg(
        "line",
        { x1: 510, y1: 272, x2: 440, y2: 272, class: "anim-static-arrow" },
        refs.cur2
      );
      l2.style.stroke = "var(--accent)";
      svg("polygon", { points: "440,272 446,269 446,275", class: "anim-static-arrow" }, refs.cur2).style.fill = "var(--accent)";

      refs.commit = textEl(layer, 330, 230, "提交点：rename current", "t-badge");
      refs.commit.style.fill = "var(--accent)";
      refs.commit.style.opacity = 0;

      refs.crashA = textEl(layer, 280, 225, "✕ rename 前崩溃", "t-badge");
      refs.crashB = textEl(layer, 455, 122, "✕ committed 前崩溃", "t-badge");
      [refs.crashA, refs.crashB].forEach(function (t) {
        t.style.fill = "var(--anim-bad)";
        t.style.opacity = 0;
      });

      return refs;
    },
    render: function (refs, i, api) {
      var st = STEPS[i];
      var rank = { none: -1, intent: 0, prepared: 1, committed: 2, aborted: 1 };

      Object.keys(refs.j).forEach(function (name) {
        var node = refs.j[name];
        var cls = "anim-journal";
        if (name === st.journal) cls += name === "committed" ? " is-done" : " is-active";
        else if (st.journal !== "none" && rank[name] < rank[st.journal] && name !== "aborted") {
          cls += " is-done";
        } else {
          cls += " is-pending";
        }
        if (st.crash && name === "prepared") cls = "anim-journal is-active";
        node.g.setAttribute("class", cls);
      });

      refs.gen2.g.style.opacity = st.gen2 ? 1 : 0;
      refs.gen2.g.setAttribute(
        "class",
        "anim-fs " +
          (st.crash === "A" ? "is-ghost" : st.gen2 ? "is-good" : "is-ghost")
      );
      refs.gen1.g.setAttribute(
        "class",
        "anim-fs " + (st.current === 1 ? "is-active" : "")
      );
      refs.gen0.g.setAttribute("class", "anim-fs");
      refs.current.sub.textContent = "→ gen/" + st.current;
      refs.staging.g.style.opacity = st.staging ? 1 : 0;

      refs.cur1.style.opacity = st.current === 1 ? 1 : 0;
      refs.cur2.style.opacity = st.current === 2 ? 1 : 0;
      refs.commit.style.opacity = st.commit ? 1 : 0;

      refs.crashA.style.opacity = st.crash === "A" ? 1 : 0;
      refs.crashB.style.opacity = st.crash === "B" ? 1 : 0;

      if (i === 4) api.pulse(refs.current.g);
      if (i === 5) api.pulse(refs.j.committed.g);
    }
  };
})();


(function () {
  var A = window.InfraAnim;
  var svg = A.svg;
  var textEl = A.textEl;
  var card = A.card;

  function rpcCard(layer, x, y, w, name) {
    var c = card(layer, x, y, w, 110);
    c.name.textContent = name;
    c.sub.setAttribute("y", "44");
    c.sub2.setAttribute("y", "62");
    c.line3 = textEl(c.g, 12, 82, "", "t-sub");
    c.line4 = textEl(c.g, 12, 100, "", "t-sub");
    return c;
  }

  function paint(c, d) {
    c.badge.textContent = d.badge;
    c.sub.textContent = d.l1;
    c.sub2.textContent = d.l2;
    c.line3.textContent = d.l3;
    c.line4.textContent = d.l4;
    c.g.setAttribute("class", "anim-node " + (d.state || ""));
  }

  var STEPS = [
    {
      caption:
        "客户端发 Put(x, 10, 0)；服务端当前版本是 0，这次调用还没有执行。",
      note: "第三个参数是期望版本；条件写只在版本匹配时更新。",
      client: {
        badge: "call 1",
        l1: "状态：发送",
        l2: "Put(x, 10, 0)",
        l3: "期望版本：0",
        l4: "结果：—",
        state: "is-focus"
      },
      server: {
        badge: "v0",
        l1: "value：—",
        l2: "version：0",
        l3: "reply：—",
        l4: "重复写：否",
        state: ""
      },
      banner: ["第一次调用：版本 0 匹配", "服务端写入 10，版本变 1，准备回复"],
      tone: ""
    },
    {
      caption:
        "服务端检查版本 0 匹配，写入 10，版本变成 1，回复 ok。",
      note: "真正的副作用发生在服务端；客户端只看到“回复还没到”。",
      client: {
        badge: "call 1",
        l1: "状态：等待回复",
        l2: "Put(x, 10, 0)",
        l3: "期望版本：0",
        l4: "结果：—",
        state: ""
      },
      server: {
        badge: "v1",
        l1: "value：10",
        l2: "version：1",
        l3: "reply：ok",
        l4: "重复写：否",
        state: "is-good"
      },
      banner: ["服务端已执行", "value=10，version=1；回复正在路上"],
      tone: "good"
    },
    {
      caption:
        "回复在网络上丢失；客户端超时，只知道“没有收到回复”。",
      note: "没有回复不等于没有执行；这正是 ErrMaybe 存在的原因。",
      client: {
        badge: "timeout",
        l1: "状态：超时",
        l2: "Put(x, 10, 0)",
        l3: "期望版本：0",
        l4: "结果：—",
        state: "is-slow"
      },
      server: {
        badge: "v1",
        l1: "value：10",
        l2: "version：1",
        l3: "reply：ok（已丢）",
        l4: "重复写：否",
        state: ""
      },
      banner: ["回复丢失，客户端超时", "客户端不知道服务端有没有执行这次调用"],
      tone: "bad"
    },
    {
      caption:
        "客户端用同一组参数重发 Put(x, 10, 0)，仍然带期望版本 0。",
      note: "客户端不能换一个新版本重试，否则会覆盖别人已经写入的值。",
      client: {
        badge: "retry",
        l1: "状态：重发",
        l2: "Put(x, 10, 0)",
        l3: "期望版本：0",
        l4: "结果：—",
        state: "is-focus"
      },
      server: {
        badge: "v1",
        l1: "value：10",
        l2: "version：1",
        l3: "reply：—",
        l4: "重复写：否",
        state: ""
      },
      banner: ["超时重发同一组参数", "仍然带期望版本 0，而不是新的版本 1"],
      tone: "warn"
    },
    {
      caption:
        "服务端发现期望版本 0 不等于当前版本 1，返回 ErrVersion，第二次写入不会发生。",
      note: "首次调用就收到 ErrVersion 时可以确定没执行；这里是重发后的 ErrVersion，不能确定。",
      client: {
        badge: "retry",
        l1: "状态：收到错误",
        l2: "Put(x, 10, 0)",
        l3: "期望版本：0",
        l4: "结果：ErrVersion",
        state: "is-slow"
      },
      server: {
        badge: "v1",
        l1: "value：10",
        l2: "version：1",
        l3: "reply：ErrVersion",
        l4: "重复写：否",
        state: "is-good"
      },
      banner: ["版本不匹配，返回 ErrVersion", "服务端当前版本 1；第二次写入不会发生"],
      tone: "warn"
    },
    {
      caption:
        "客户端无法判断第一次是否执行，返回 ErrMaybe；调用者必须 Get(x) 确认。",
      note: "读到 10，说明第一次已经执行；读到 —，说明第一次没执行，可以安全重试。",
      client: {
        badge: "ErrMaybe",
        l1: "状态：结果不确定",
        l2: "ErrMaybe",
        l3: "后续：Get(x)",
        l4: "读到：10",
        state: "is-slow"
      },
      server: {
        badge: "v1",
        l1: "value：10",
        l2: "version：1",
        l3: "reply：10",
        l4: "重复写：否",
        state: "is-good"
      },
      banner: ["客户端返回 ErrMaybe", "调用者必须 Get 确认；读到 10 说明第一次已执行"],
      tone: "warn"
    },
    {
      caption:
        "规则：条件写让重复请求自然失效；有外部副作用时，仍需请求 ID 加持久化去重表。",
      note: "Lab 2 的 Put/Get 用版本号；`ErrMaybe` 是给调用者的信号，不是服务端保存的状态。",
      client: {
        badge: "done",
        l1: "状态：已确认",
        l2: "Get(x) = 10",
        l3: "结论：第一次已执行",
        l4: "不再重试",
        state: ""
      },
      server: {
        badge: "v1",
        l1: "value：10",
        l2: "version：1",
        l3: "reply：—",
        l4: "重复写：否",
        state: ""
      },
      banner: ["条件写让重复请求失效", "外部副作用仍要请求 ID + 持久化去重表"],
      tone: "good"
    }
  ];

  A.SPECS["rpc-retry"] = {
    title: "RPC 重试与版本号：ErrVersion 和 ErrMaybe",
    width: 760,
    height: 340,
    steps: STEPS,
    build: function (layer) {
      var refs = {};
      refs.client = rpcCard(layer, 40, 110, 170, "client A");
      refs.server = rpcCard(layer, 500, 110, 220, "server");

      var banner = svg("g", { class: "anim-banner" }, layer);
      svg("rect", { x: 40, y: 16, width: 680, height: 58, rx: 5 }, banner);
      refs.banner = banner;
      refs.line1 = textEl(banner, 380, 43, "", "t-name", "middle");
      refs.line2 = textEl(banner, 380, 64, "", "t-sub", "middle");
      return refs;
    },
    render: function (refs, i, api) {
      var st = STEPS[i];
      paint(refs.client, st.client);
      paint(refs.server, st.server);
      refs.banner.setAttribute(
        "class",
        "anim-banner" + (st.tone ? " is-" + st.tone : "")
      );
      refs.line1.textContent = st.banner[0];
      refs.line2.textContent = st.banner[1];

      if (i === 0) {
        api.msg({ from: [210, 150], to: [500, 150], label: "Put(x,10,0)", color: "accent", curve: -10 });
      }
      if (i === 1) {
        api.msg({ from: [500, 180], to: [210, 180], label: "ok", color: "ok", curve: -10 });
      }
      if (i === 2) {
        api.msg({ from: [500, 180], to: [300, 180], label: "回复丢失", color: "bad", curve: 12, dashed: true });
      }
      if (i === 3) {
        api.msg({ from: [210, 160], to: [500, 160], label: "重发同参数", color: "warn", curve: 14, dashed: true });
      }
      if (i === 4) {
        api.msg({ from: [500, 180], to: [210, 180], label: "ErrVersion", color: "warn", curve: -12 });
      }
      if (i === 5) {
        api.msg({ from: [210, 138], to: [500, 138], label: "Get(x)", color: "accent", curve: -8 });
        api.msg({ from: [500, 162], to: [210, 162], label: "10", color: "ok", curve: -8, delay: 200 });
      }
      if (i === 6) {
        api.pulse(refs.client.g);
      }
    }
  };
})();

(function () {
  var A = window.InfraAnim;
  var svg = A.svg;
  var textEl = A.textEl;
  var card = A.card;

  function gfsCard(layer, x, y, w, h, name) {
    var c = card(layer, x, y, w, h);
    c.name.textContent = name;
    return c;
  }

  function paint(c, d) {
    c.badge.textContent = d.badge;
    c.sub.textContent = d.l1;
    c.sub2.textContent = d.l2;
    c.g.setAttribute("class", "anim-node " + (d.state || ""));
  }

  var STEPS = [
    {
      caption:
        "客户端问 master：这个偏移量属于哪个 chunk，谁持有租约，副本在哪。",
      note: "数据不经过 master；它只返回元数据和副本位置。",
      client: { badge: "ask", l1: "offset 0", l2: "chunk ?", state: "is-focus" },
      master: { badge: "?", l1: "lease：?", l2: "副本：?", state: "" },
      primary: { badge: "P", l1: "data：—", l2: "serial：—", state: "" },
      a: { badge: "A", l1: "data：—", l2: "ack：—", state: "" },
      b: { badge: "B", l1: "data：—", l2: "ack：—", state: "" },
      banner: ["客户端先问 master", "chunk 句柄 + 当前 primary + 副本列表"],
      tone: ""
    },
    {
      caption:
        "master 返回 primary 和 secondary 列表；客户端缓存这份位置信息。",
      note: "租约让 master 在一段时间内只认一个 primary，避免脑裂。",
      client: { badge: "ask", l1: "offset 0", l2: "chunk + 位置", state: "" },
      master: { badge: "lease", l1: "primary：P", l2: "副本：A、B", state: "is-good" },
      primary: { badge: "P", l1: "data：—", l2: "serial：—", state: "is-focus" },
      a: { badge: "A", l1: "data：—", l2: "ack：—", state: "" },
      b: { badge: "B", l1: "data：—", l2: "ack：—", state: "" },
      banner: ["master 选 primary", "租约期内只有 P 能决定写入顺序"],
      tone: "good"
    },
    {
      caption:
        "客户端沿链把数据推给所有副本；副本先放进缓存，不急着写盘。",
      note: "数据流和控制流分开：数据先到，写请求后到。",
      client: { badge: "data", l1: "推数据", l2: "1 MB", state: "is-focus" },
      master: { badge: "lease", l1: "primary：P", l2: "副本：A、B", state: "" },
      primary: { badge: "P", l1: "data：缓存", l2: "serial：—", state: "is-focus" },
      a: { badge: "A", l1: "data：缓存", l2: "ack：—", state: "is-focus" },
      b: { badge: "B", l1: "data：缓存", l2: "ack：—", state: "is-focus" },
      banner: ["数据先沿链推送", "副本先放缓存；此时还没有分配写入顺序"],
      tone: ""
    },
    {
      caption:
        "数据全部到达后，客户端才向 primary 发写请求。",
      note: "写请求不带大块数据；primary 只负责排序和转发控制消息。",
      client: { badge: "write", l1: "写请求", l2: "offset 0", state: "is-focus" },
      master: { badge: "lease", l1: "primary：P", l2: "副本：A、B", state: "" },
      primary: { badge: "P", l1: "data：缓存", l2: "收到写请求", state: "is-focus" },
      a: { badge: "A", l1: "data：缓存", l2: "ack：—", state: "" },
      b: { badge: "B", l1: "data：缓存", l2: "ack：—", state: "" },
      banner: ["客户端发写请求", "控制流：client → primary；数据已经在副本缓存里"],
      tone: ""
    },
    {
      caption:
        "primary 给这次写分配连续序号，先写本地，再按同一序号转发给 secondary。",
      note: "序号决定副本应用写的顺序；所有副本必须按同一个顺序执行。",
      client: { badge: "write", l1: "等待", l2: "offset 0", state: "" },
      master: { badge: "lease", l1: "primary：P", l2: "副本：A、B", state: "" },
      primary: { badge: "P", l1: "data：ab", l2: "serial：1", state: "is-good" },
      a: { badge: "A", l1: "data：缓存", l2: "serial：1", state: "is-focus" },
      b: { badge: "B", l1: "data：缓存", l2: "serial：1", state: "is-focus" },
      banner: ["primary 分配序号 1", "本地先写，再转发给 A、B"],
      tone: "warn"
    },
    {
      caption:
        "secondary 按序号应用写并回复 primary；全部确认后，primary 回复客户端成功。",
      note: "成功是 primary 的判断；某个 secondary 没确认时，区域可能不一致。",
      client: { badge: "ok", l1: "成功", l2: "offset 0", state: "is-good" },
      master: { badge: "lease", l1: "primary：P", l2: "副本：A、B", state: "" },
      primary: { badge: "P", l1: "data：ab", l2: "serial：1", state: "is-good" },
      a: { badge: "A", l1: "data：ab", l2: "ack：ok", state: "is-good" },
      b: { badge: "B", l1: "data：ab", l2: "ack：ok", state: "is-good" },
      banner: ["所有副本确认", "primary 回复客户端；这次写在三个副本上一致"],
      tone: "good"
    },
    {
      caption:
        "如果 B 没确认，primary 回复错误；A 有新数据、B 没有，这块区域就是不一致。",
      note: "GFS 不保证失败写是原子的；客户端重试成功后才可能回到一致状态。",
      client: { badge: "error", l1: "失败", l2: "offset 0", state: "is-slow" },
      master: { badge: "lease", l1: "primary：P", l2: "副本：A、B", state: "" },
      primary: { badge: "P", l1: "data：ab", l2: "B 超时", state: "is-slow" },
      a: { badge: "A", l1: "data：ab", l2: "ack：ok", state: "is-good" },
      b: { badge: "B", l1: "data：—", l2: "ack：超时", state: "is-slow" },
      banner: ["失败写可能只到一部分副本", "A 有 ab，B 没有；不同客户端会读到不同内容"],
      tone: "bad"
    },
    {
      caption:
        "规则：数据先于控制，primary 只排序；租约保证同一时刻只有一个 primary。",
      note: "GFS 的一致性比线性一致弱；失败区域要靠客户端重试和校验和修复。",
      client: { badge: "retry", l1: "重试", l2: "offset 0", state: "" },
      master: { badge: "lease", l1: "primary：P", l2: "副本：A、B", state: "" },
      primary: { badge: "P", l1: "data：ab", l2: "serial：1", state: "" },
      a: { badge: "A", l1: "data：ab", l2: "ack：ok", state: "is-good" },
      b: { badge: "B", l1: "data：—", l2: "ack：超时", state: "is-slow" },
      banner: ["数据流与控制流分开", "租约防脑裂；失败区域靠重试和校验和修复"],
      tone: "warn"
    }
  ];

  A.SPECS["gfs-write"] = {
    title: "GFS 写路径：租约、数据推送和副本确认",
    width: 760,
    height: 380,
    steps: STEPS,
    build: function (layer) {
      var refs = {};
      refs.client = gfsCard(layer, 30, 160, 150, 80, "client");
      refs.master = gfsCard(layer, 300, 80, 160, 64, "master");
      refs.primary = gfsCard(layer, 300, 160, 150, 80, "primary P");
      refs.a = gfsCard(layer, 560, 100, 160, 64, "secondary A");
      refs.b = gfsCard(layer, 560, 240, 160, 64, "secondary B");

      var banner = svg("g", { class: "anim-banner" }, layer);
      svg("rect", { x: 40, y: 12, width: 680, height: 54, rx: 5 }, banner);
      refs.banner = banner;
      refs.line1 = textEl(banner, 380, 37, "", "t-name", "middle");
      refs.line2 = textEl(banner, 380, 57, "", "t-sub", "middle");
      return refs;
    },
    render: function (refs, i, api) {
      var st = STEPS[i];
      paint(refs.client, st.client);
      paint(refs.master, st.master);
      paint(refs.primary, st.primary);
      paint(refs.a, st.a);
      paint(refs.b, st.b);
      refs.banner.setAttribute(
        "class",
        "anim-banner" + (st.tone ? " is-" + st.tone : "")
      );
      refs.line1.textContent = st.banner[0];
      refs.line2.textContent = st.banner[1];

      if (i === 0) {
        api.msg({ from: [180, 180], to: [300, 120], label: "chunk / lease?", color: "accent", curve: -18 });
      }
      if (i === 1) {
        api.msg({ from: [300, 144], to: [180, 190], label: "P + A,B", color: "ok", curve: 18 });
      }
      if (i === 2) {
        api.token({ from: [180, 200], to: [300, 200], label: "data", color: "info" });
        api.token({ from: [450, 200], to: [560, 132], label: "data", color: "info", delay: 120 });
        api.token({ from: [640, 164], to: [640, 240], label: "data", color: "info", delay: 260 });
      }
      if (i === 3) {
        api.msg({ from: [180, 220], to: [300, 220], label: "write", color: "accent", curve: 8 });
      }
      if (i === 4) {
        api.msg({ from: [450, 180], to: [560, 120], label: "serial 1", color: "warn", curve: -16 });
        api.msg({ from: [450, 220], to: [560, 260], label: "serial 1", color: "warn", curve: 16, delay: 100 });
      }
      if (i === 5) {
        api.msg({ from: [560, 132], to: [450, 190], label: "ack", color: "ok", curve: 14 });
        api.msg({ from: [560, 272], to: [450, 210], label: "ack", color: "ok", curve: -14, delay: 100 });
        api.msg({ from: [300, 180], to: [180, 200], label: "ok", color: "ok", curve: 12, delay: 240 });
      }
      if (i === 6) {
        api.msg({ from: [560, 272], to: [450, 220], label: "timeout", color: "bad", curve: -14, dashed: true });
        api.msg({ from: [300, 180], to: [180, 200], label: "error", color: "bad", curve: 12, delay: 180 });
      }
    }
  };
})();

(function () {
  var A = window.InfraAnim;
  var svg = A.svg;
  var textEl = A.textEl;
  var card = A.card;

  function paxCard(layer, x, y, w, h, name) {
    var c = card(layer, x, y, w, h);
    c.name.textContent = name;
    return c;
  }

  function paint(c, d) {
    c.badge.textContent = d.badge;
    c.sub.textContent = d.l1;
    c.sub2.textContent = d.l2;
    c.g.setAttribute("class", "anim-node " + (d.state || ""));
  }

  var STEPS = [
    {
      caption:
        "P1 选提案编号 5，向 A1、A2 发 prepare；A3 当前挂着。",
      note: "提案编号要全局唯一，并且比提议者见过的都大。",
      p1: { badge: "n=5", l1: "phase：prepare", l2: "value：X", state: "is-focus" },
      p2: { badge: "idle", l1: "phase：—", l2: "value：Y", state: "" },
      a1: { badge: "A1", l1: "n_p：0", l2: "n_a/v_a：—", state: "" },
      a2: { badge: "A2", l1: "n_p：0", l2: "n_a/v_a：—", state: "" },
      a3: { badge: "A3", l1: "n_p：0", l2: "n_a/v_a：—", state: "is-down" },
      banner: ["P1 发 prepare(5)", "A3 挂着；只要 A1、A2 回复，就有多数派"],
      tone: ""
    },
    {
      caption:
        "A1、A2 承诺不再接受小于 5 的提案，回复没有旧值。",
      note: "多数派是 2/3；P1 不需要等 A3。",
      p1: { badge: "n=5", l1: "phase：prepare", l2: "收到 2 个 ok", state: "is-focus" },
      p2: { badge: "idle", l1: "phase：—", l2: "value：Y", state: "" },
      a1: { badge: "A1", l1: "n_p：5", l2: "n_a/v_a：—", state: "is-good" },
      a2: { badge: "A2", l1: "n_p：5", l2: "n_a/v_a：—", state: "is-good" },
      a3: { badge: "A3", l1: "n_p：0", l2: "n_a/v_a：—", state: "is-down" },
      banner: ["prepare 拿到多数派", "A1、A2 承诺：不再接受编号小于 5 的提案"],
      tone: "warn"
    },
    {
      caption:
        "P1 发 accept(5, X)；A1、A2 接受，X 在多数派上被选中。",
      note: "选中（chosen）不等于所有节点都知道；学习者稍后才得知。",
      p1: { badge: "n=5", l1: "phase：accept", l2: "value：X", state: "is-good" },
      p2: { badge: "idle", l1: "phase：—", l2: "value：Y", state: "" },
      a1: { badge: "A1", l1: "n_p：5", l2: "n_a/v_a：5, X", state: "is-good" },
      a2: { badge: "A2", l1: "n_p：5", l2: "n_a/v_a：5, X", state: "is-good" },
      a3: { badge: "A3", l1: "n_p：0", l2: "n_a/v_a：—", state: "is-down" },
      banner: ["X 被选中", "A1 + A2 构成 2/3 多数派；X 是唯一可能被选中的值"],
      tone: "good"
    },
    {
      caption:
        "P2 不知道 X 已选中，选编号 6，向 A2、A3 发 prepare；A1 这时挂了。",
      note: "P2 可以不知道上一轮结果，但接受者不能忘记自己接受过什么。",
      p1: { badge: "n=5", l1: "value：X", l2: "状态：已选中", state: "" },
      p2: { badge: "n=6", l1: "phase：prepare", l2: "value：Y", state: "is-focus" },
      a1: { badge: "A1", l1: "n_p：5", l2: "n_a/v_a：5, X", state: "is-down" },
      a2: { badge: "A2", l1: "n_p：5", l2: "n_a/v_a：5, X", state: "" },
      a3: { badge: "A3", l1: "n_p：0", l2: "n_a/v_a：—", state: "" },
      banner: ["P2 用更大的编号 6 发起 prepare", "A1 挂了；A2、A3 构成另一个多数派"],
      tone: "warn"
    },
    {
      caption:
        "A2 回复 (n_a=5, v_a=X)，A3 没有旧值；P2 必须复用 X。",
      note: "如果 P2 忽略 A2 的旧值，就可能选出和 X 不同的 Y。",
      p1: { badge: "n=5", l1: "value：X", l2: "状态：已选中", state: "" },
      p2: { badge: "n=6", l1: "phase：prepare", l2: "看到旧值 X", state: "is-focus" },
      a1: { badge: "A1", l1: "n_p：5", l2: "n_a/v_a：5, X", state: "is-down" },
      a2: { badge: "A2", l1: "n_p：6", l2: "n_a/v_a：5, X", state: "is-good" },
      a3: { badge: "A3", l1: "n_p：6", l2: "n_a/v_a：—", state: "is-good" },
      banner: ["A2 带回旧值 X", "P2 收到 (n_a=5, v_a=X)，不能改提 Y"],
      tone: "good"
    },
    {
      caption:
        "P2 发 accept(6, X)；A2、A3 接受，X 再次被选中。",
      note: "A2 同时属于两轮多数派，是安全性的交集。",
      p1: { badge: "n=5", l1: "value：X", l2: "状态：已选中", state: "" },
      p2: { badge: "n=6", l1: "phase：accept", l2: "value：X", state: "is-good" },
      a1: { badge: "A1", l1: "n_p：5", l2: "n_a/v_a：5, X", state: "is-down" },
      a2: { badge: "A2", l1: "n_p：6", l2: "n_a/v_a：6, X", state: "is-good" },
      a3: { badge: "A3", l1: "n_p：6", l2: "n_a/v_a：6, X", state: "is-good" },
      banner: ["X 再次被选中", "两轮多数派在 A2 相交，旧值 X 被带到了新一轮"],
      tone: "good"
    },
    {
      caption:
        "反事实：如果 P2 发 accept(6, Y)，A2、A3 会接受 Y，X 和 Y 都被选中。",
      note: "这不是实现细节，而是安全性被破坏；接受者必须在回复前持久化。",
      p1: { badge: "n=5", l1: "value：X", l2: "状态：已选中", state: "" },
      p2: { badge: "n=6", l1: "phase：accept", l2: "value：Y", state: "is-bad" },
      a1: { badge: "A1", l1: "n_p：5", l2: "n_a/v_a：5, X", state: "is-down" },
      a2: { badge: "A2", l1: "n_p：6", l2: "n_a/v_a：6, Y", state: "is-bad" },
      a3: { badge: "A3", l1: "n_p：6", l2: "n_a/v_a：6, Y", state: "is-bad" },
      banner: ["反例：两个值都被选中", "X 在 A1+A2 上选中，Y 在 A2+A3 上选中；安全性被破坏"],
      tone: "bad"
    },
    {
      caption:
        "规则：多数派交集 + 接受者持久化 n_p 和 (n_a, v_a)。",
      note: "Paxos 保证安全，不保证活性；活锁要靠稳定 leader 或随机退避打破。",
      p1: { badge: "n=5", l1: "value：X", l2: "状态：已选中", state: "" },
      p2: { badge: "n=6", l1: "value：X", l2: "状态：已选中", state: "" },
      a1: { badge: "A1", l1: "n_p：5", l2: "n_a/v_a：5, X", state: "is-down" },
      a2: { badge: "A2", l1: "n_p：6", l2: "n_a/v_a：6, X", state: "is-good" },
      a3: { badge: "A3", l1: "n_p：6", l2: "n_a/v_a：6, X", state: "is-good" },
      banner: ["安全来自多数派交集", "接受者落盘，提议者可以忘；两者不能都忘"],
      tone: "good"
    }
  ];

  A.SPECS["paxos"] = {
    title: "Paxos：prepare、accept 与多数派交集",
    width: 760,
    height: 360,
    steps: STEPS,
    build: function (layer) {
      var refs = {};
      refs.p1 = paxCard(layer, 40, 96, 130, 70, "P1");
      refs.p2 = paxCard(layer, 40, 220, 130, 70, "P2");
      refs.a1 = paxCard(layer, 380, 80, 150, 70, "A1");
      refs.a2 = paxCard(layer, 380, 170, 150, 70, "A2");
      refs.a3 = paxCard(layer, 380, 260, 150, 70, "A3");

      var banner = svg("g", { class: "anim-banner" }, layer);
      svg("rect", { x: 40, y: 12, width: 680, height: 52, rx: 5 }, banner);
      refs.banner = banner;
      refs.line1 = textEl(banner, 380, 37, "", "t-name", "middle");
      refs.line2 = textEl(banner, 380, 57, "", "t-sub", "middle");
      return refs;
    },
    render: function (refs, i, api) {
      var st = STEPS[i];
      paint(refs.p1, st.p1);
      paint(refs.p2, st.p2);
      paint(refs.a1, st.a1);
      paint(refs.a2, st.a2);
      paint(refs.a3, st.a3);
      refs.banner.setAttribute(
        "class",
        "anim-banner" + (st.tone ? " is-" + st.tone : "")
      );
      refs.line1.textContent = st.banner[0];
      refs.line2.textContent = st.banner[1];

      if (i === 0) {
        api.msg({ from: [170, 128], to: [380, 112], label: "prepare(5)", color: "accent", curve: -14 });
        api.msg({ from: [170, 128], to: [380, 202], label: "prepare(5)", color: "accent", curve: 14, delay: 90 });
      }
      if (i === 1) {
        api.msg({ from: [380, 112], to: [170, 128], label: "ok", color: "ok", curve: -14 });
        api.msg({ from: [380, 202], to: [170, 128], label: "ok", color: "ok", curve: 14, delay: 90 });
      }
      if (i === 2) {
        api.msg({ from: [170, 128], to: [380, 112], label: "accept(5,X)", color: "ok", curve: -14 });
        api.msg({ from: [170, 128], to: [380, 202], label: "accept(5,X)", color: "ok", curve: 14, delay: 90 });
      }
      if (i === 3) {
        api.msg({ from: [170, 252], to: [380, 202], label: "prepare(6)", color: "warn", curve: -14 });
        api.msg({ from: [170, 252], to: [380, 292], label: "prepare(6)", color: "warn", curve: 14, delay: 90 });
      }
      if (i === 4) {
        api.msg({ from: [380, 202], to: [170, 252], label: "5, X", color: "ok", curve: -14 });
        api.msg({ from: [380, 292], to: [170, 252], label: "—", color: "muted", curve: 14, delay: 90 });
      }
      if (i === 5) {
        api.msg({ from: [170, 252], to: [380, 202], label: "accept(6,X)", color: "ok", curve: -14 });
        api.msg({ from: [170, 252], to: [380, 292], label: "accept(6,X)", color: "ok", curve: 14, delay: 90 });
      }
      if (i === 6) {
        api.msg({ from: [170, 252], to: [380, 202], label: "accept(6,Y)", color: "bad", curve: -14, dashed: true });
        api.msg({ from: [170, 252], to: [380, 292], label: "accept(6,Y)", color: "bad", curve: 14, delay: 90, dashed: true });
      }
      if (i === 7) {
        api.pulse(refs.a2.g);
      }
    }
  };
})();

(function () {
  var A = window.InfraAnim;
  var svg = A.svg;
  var textEl = A.textEl;

  var ROW_Y = [96, 156, 216];
  var COL_X = [240, 310, 380, 450, 520];
  var CW = 58;
  var CH = 38;

  var STEPS = [
    {
      caption:
        "S1 是 term 4 的 leader；S2 日志和它一致，S3 在 index 3 上有一个 term 3 的旧条目。",
      note: "committed 前缀是 index 1–2；S3 的冲突条目还没被覆盖。",
      logs: [[1, 1, 2, 2, 0], [1, 1, 2, 2, 0], [1, 1, 3, 3, 0]],
      roles: ["L4", "F4", "F4"],
      next: ["—", "5", "5"],
      match: ["—", "4", "2"],
      committed: 2
    },
    {
      caption:
        "客户端发来 x=1；S1 把它追加到 index 5，term 记为 4。",
      note: "leader 先写本地日志，再并行复制；此时还没有提交。",
      logs: [[1, 1, 2, 2, 4], [1, 1, 2, 2, 0], [1, 1, 3, 3, 0]],
      roles: ["L4", "F4", "F4"],
      next: ["—", "5", "5"],
      match: ["—", "4", "2"],
      committed: 2
    },
    {
      caption:
        "S1 发 AppendEntries(prev=4, term=2)；S2 追加成功，S3 在 index 4 上 term 不匹配。",
      note: "follower 先检查 prevLogIndex/prevLogTerm，再决定追加还是拒绝。",
      logs: [[1, 1, 2, 2, 4], [1, 1, 2, 2, 4], [1, 1, 3, 3, 0]],
      roles: ["L4", "F4", "F4"],
      next: ["—", "6", "5"],
      match: ["—", "5", "2"],
      committed: 2
    },
    {
      caption:
        "S3 拒绝并带回冲突信息：XTerm=3，XIndex=3。",
      note: "如果没有这个信息，leader 只能把 nextIndex 一条一条往回退。",
      logs: [[1, 1, 2, 2, 4], [1, 1, 2, 2, 4], [1, 1, 3, 3, 0]],
      roles: ["L4", "F4", "F4"],
      next: ["—", "6", "5"],
      match: ["—", "5", "2"],
      committed: 2,
      conflict: 2
    },
    {
      caption:
        "S1 把 nextIndex[S3] 一次退到 3，发送 prev=2、entries=3..5。",
      note: "快速回退跳过整个冲突 term；TestBackup3B 检查回退不能太慢。",
      logs: [[1, 1, 2, 2, 4], [1, 1, 2, 2, 4], [1, 1, 3, 3, 0]],
      roles: ["L4", "F4", "F4"],
      next: ["—", "6", "3"],
      match: ["—", "5", "2"],
      committed: 2
    },
    {
      caption:
        "S3 截断冲突后缀，追加 index 3–5；它的日志现在和 leader 一致。",
      note: "日志只从 leader 流向 follower；follower 的未提交后缀可以被覆盖。",
      logs: [[1, 1, 2, 2, 4], [1, 1, 2, 2, 4], [1, 1, 2, 2, 4]],
      roles: ["L4", "F4", "F4"],
      next: ["—", "6", "6"],
      match: ["—", "5", "5"],
      committed: 2
    },
    {
      caption:
        "index 5 已在 S1、S2、S3 三个 server 上，构成多数派；commitIndex 推进到 5。",
      note: "S1 把条目交给状态机执行，然后回复客户端；下一次心跳带上 leaderCommit=5。",
      logs: [[1, 1, 2, 2, 4], [1, 1, 2, 2, 4], [1, 1, 2, 2, 4]],
      roles: ["L4", "F4", "F4"],
      next: ["—", "6", "6"],
      match: ["—", "5", "5"],
      committed: 5
    },
    {
      caption:
        "规则：nextIndex 找前缀，matchIndex 记多数派；提交看 matchIndex 的中位数。",
      note: "leader 只提交当前 term 的条目；旧 term 条目随当前 term 的提交间接完成。",
      logs: [[1, 1, 2, 2, 4], [1, 1, 2, 2, 4], [1, 1, 2, 2, 4]],
      roles: ["L4", "F4", "F4"],
      next: ["—", "6", "6"],
      match: ["—", "5", "5"],
      committed: 5
    }
  ];

  A.SPECS["raft-replication"] = {
    title: "Raft 日志复制：AppendEntries、冲突回退和 commitIndex",
    width: 760,
    height: 340,
    steps: STEPS,
    build: function (layer) {
      var refs = {};

      refs.note = textEl(layer, 40, 40, "", "t-name");
      refs.commit = textEl(layer, 600, 40, "", "t-badge");

      [1, 2, 3, 4, 5].forEach(function (n, c) {
        textEl(layer, COL_X[c] + CW / 2, 82, String(n), "t-small", "middle");
      });

      refs.rows = [0, 1, 2].map(function (r) {
        var y = ROW_Y[r];
        var g = svg("g", { class: "anim-row" }, layer);
        var name = textEl(g, 40, y + 24, "S" + (r + 1), "t-name");
        var badge = textEl(g, 88, y + 24, "", "t-badge");
        var next = textEl(g, 600, y + 18, "", "t-small");
        var match = textEl(g, 600, y + 34, "", "t-small");
        var cells = [0, 1, 2, 3, 4].map(function (c) {
          var cell = svg(
            "g",
            { class: "anim-cell", transform: "translate(" + COL_X[c] + "," + y + ")" },
            g
          );
          svg("rect", { width: CW, height: CH, rx: 3 }, cell);
          var term = textEl(cell, CW / 2, 24, "", "", "middle");
          var check = textEl(cell, CW - 6, 33, "✓", "t-check", "end");
          return { g: cell, term: term, check: check };
        });
        return { g: g, name: name, badge: badge, next: next, match: match, cells: cells };
      });

      var banner = svg("g", { class: "anim-banner" }, layer);
      svg("rect", { x: 40, y: 276, width: 680, height: 52, rx: 5 }, banner);
      refs.banner = banner;
      refs.line1 = textEl(banner, 380, 301, "", "t-name", "middle");
      refs.line2 = textEl(banner, 380, 321, "", "t-sub", "middle");

      return refs;
    },
    render: function (refs, i, api) {
      var st = STEPS[i];
      refs.note.textContent = "term 4 · leader S1";
      refs.commit.textContent = "commitIndex = " + st.committed;

      st.logs.forEach(function (log, r) {
        var row = refs.rows[r];
        var role = st.roles[r];
        row.g.setAttribute("class", "anim-row" + (role.charAt(0) === "X" ? " is-down" : ""));
        row.badge.textContent = role;
        row.badge.setAttribute(
          "class",
          "t-badge" + (role.charAt(0) === "L" ? " is-leader" : "")
        );
        row.next.textContent = "next=" + st.next[r];
        row.match.textContent = "match=" + st.match[r];
        row.cells.forEach(function (cell, c) {
          var term = log[c];
          var cls = "anim-cell";
          if (!term) {
            cls += " is-ghost";
          } else {
            cls += " t" + term;
            if (c < st.committed) cls += " is-committed";
          }
          if (st.conflict === r && c === 2) cls += " is-hot";
          cell.g.setAttribute("class", cls);
          cell.term.textContent = term ? term : "";
          cell.check.textContent = term && c < st.committed ? "✓" : "";
        });
      });

      refs.banner.setAttribute("class", "anim-banner");
      if (i === 0) {
        refs.line1.textContent = "初始日志：S3 在 index 3 上有 term 3";
        refs.line2.textContent = "S2 和 leader 一致；committed 前缀是 1–2";
      } else if (i === 1) {
        refs.line1.textContent = "leader 追加 index 5（term 4）";
        refs.line2.textContent = "先写本地，再复制；还没有提交";
      } else if (i === 2) {
        refs.line1.textContent = "AppendEntries：S2 成功，S3 拒绝";
        refs.line2.textContent = "S2 的 matchIndex 推进到 5；S3 仍停在冲突点";
      } else if (i === 3) {
        refs.line1.textContent = "S3 返回冲突信息";
        refs.line2.textContent = "XTerm=3，XIndex=3；leader 可以跳过整个 term";
      } else if (i === 4) {
        refs.line1.textContent = "nextIndex[S3] 回退到 3";
        refs.line2.textContent = "重发 prev=2，entries=3..5";
      } else if (i === 5) {
        refs.line1.textContent = "S3 截断并追平";
        refs.line2.textContent = "三个 server 的日志在 index 1–5 上一致";
      } else if (i === 6) {
        refs.line1.textContent = "index 5 到多数派，提交";
        refs.line2.textContent = "commitIndex=5；apply 后回复客户端";
      } else {
        refs.line1.textContent = "nextIndex 找前缀，matchIndex 记进度";
        refs.line2.textContent = "提交看多数派的 matchIndex；旧 term 条目不能直接提交";
      }

      if (i === 1) api.pulse(refs.rows[0].cells[4].g);
      if (i === 2) api.pulse(refs.rows[2].cells[3].g);
      if (i === 3) api.pulse(refs.rows[2].cells[3].g);
      if (i === 4) api.pulse(refs.rows[2].next);
      if (i === 5) {
        api.pulse(refs.rows[2].cells[2].g);
        api.pulse(refs.rows[2].cells[4].g);
      }
      if (i === 6) {
        [0, 1, 2].forEach(function (r) {
          api.pulse(refs.rows[r].cells[4].g);
        });
      }
    }
  };
})();

(function () {
  var A = window.InfraAnim;
  var svg = A.svg;
  var textEl = A.textEl;
  var chip = A.chip;

  var STEPS = [
    {
      caption:
        "S1 在 index 100 做快照：lastIncludedIndex=100、term=6，日志前缀被截掉。",
      note: "快照保存状态机在 index 100 的完整状态；Raft 只保留 101 之后的日志。",
      s3Snap: false,
      s3Old: true,
      s3Entries: 0,
      s3State: "log 1–80",
      banner: ["leader 在 index 100 做快照", "lastIncludedIndex=100，lastIncludedTerm=6"],
      tone: ""
    },
    {
      caption:
        "S3 只有到 80 的日志；S1 的 nextIndex[S3]=81，已经小于等于 100。",
      note: "日志前缀已经被截掉，leader 手里没有 index 81 的条目可发。",
      s3Snap: false,
      s3Old: true,
      s3Entries: 0,
      s3State: "log 1–80 · next=81",
      banner: ["S3 落后 20 个下标", "nextIndex=81 ≤ lastIncludedIndex=100"],
      tone: "warn"
    },
    {
      caption:
        "S1 不能再发 index 81 的 AppendEntries，改发 InstallSnapshot。",
      note: "3D 只要求一次发送完整快照，不按 offset 分块。",
      s3Snap: false,
      s3Old: true,
      s3Entries: 0,
      s3State: "等待快照",
      banner: ["发送 InstallSnapshot", "lastIncludedIndex=100，lastIncludedTerm=6"],
      tone: "warn"
    },
    {
      caption:
        "S3 安装快照：状态机重置，commitIndex 和 lastApplied 跳到 100。",
      note: "如果 S3 在 100 处有相同 term 的条目，可以保留后缀；没有就整条日志换成快照。",
      s3Snap: true,
      s3Old: false,
      s3Entries: 0,
      s3State: "installed 100",
      banner: ["S3 安装快照", "commitIndex = lastApplied = 100"],
      tone: "good"
    },
    {
      caption:
        "S1 发 AppendEntries(prevLogIndex=100, prevLogTerm=6, entries=101..105)。",
      note: "下一条复制的起点是 101，不是 100；lastIncludedIndex 是覆盖的最后一个下标。",
      s3Snap: true,
      s3Old: false,
      s3Entries: 0,
      s3State: "prev=100",
      banner: ["从 101 继续复制", "prevLogIndex=100，prevLogTerm=6"],
      tone: ""
    },
    {
      caption:
        "S3 追加 101–105，matchIndex 追到 105，恢复正常复制。",
      note: "快照安装和后续 AppendEntries 都走同一条日志顺序，状态机不会倒退。",
      s3Snap: true,
      s3Old: false,
      s3Entries: 5,
      s3State: "match=105",
      banner: ["S3 追平", "快照 + 101–105，状态和 leader 一致"],
      tone: "good"
    },
    {
      caption:
        "快照必须包含客户端去重表；否则客户端重试会再次执行已经应用过的命令。",
      note: "快照要和 Raft 状态一起 persister.Save()；服务只允许前进，不能回退 applyCh。",
      s3Snap: true,
      s3Old: false,
      s3Entries: 5,
      s3State: "dedup 在快照里",
      banner: ["去重表也要进快照", "客户端 ID + 序列号；否则重试会重复执行"],
      tone: "bad"
    },
    {
      caption:
        "规则：lastIncludedIndex 是快照覆盖的最后一个下标，不是下一个日志下标。",
      note: "混淆这两个值，会让 applyCh 倒退或让 follower 永远追不上。",
      s3Snap: true,
      s3Old: false,
      s3Entries: 5,
      s3State: "caught up",
      banner: ["快照边界要写对", "lastIncludedIndex=100 → 下一条从 101 开始"],
      tone: "good"
    }
  ];

  A.SPECS["raft-snapshot"] = {
    title: "Raft 快照：InstallSnapshot 和 lastIncludedIndex",
    width: 760,
    height: 340,
    steps: STEPS,
    build: function (layer) {
      var refs = {};
      textEl(layer, 40, 92, "S1 · leader term 7", "t-name");
      textEl(layer, 40, 202, "S3 · follower", "t-name");

      refs.s1Snap = svg("g", { class: "anim-fs is-good" }, layer);
      svg("rect", { x: 60, y: 100, width: 300, height: 36, rx: 3 }, refs.s1Snap);
      textEl(refs.s1Snap, 210, 123, "snapshot 1–100", "t-mono", "middle");

      refs.s1Entries = [101, 102, 103, 104, 105].map(function (n, i) {
        return chip(layer, 370 + i * 44, 100, 40, 36, String(n), "is-on");
      });

      refs.s3Old = svg("g", { class: "anim-fs" }, layer);
      svg("rect", { x: 60, y: 210, width: 240, height: 36, rx: 3 }, refs.s3Old);
      textEl(refs.s3Old, 180, 233, "log 1–80", "t-mono", "middle");

      refs.s3Snap = svg("g", { class: "anim-fs is-good" }, layer);
      svg("rect", { x: 60, y: 210, width: 300, height: 36, rx: 3 }, refs.s3Snap);
      textEl(refs.s3Snap, 210, 233, "snapshot 1–100", "t-mono", "middle");
      refs.s3Snap.style.opacity = 0;

      refs.s3Entries = [101, 102, 103, 104, 105].map(function (n, i) {
        var c = chip(layer, 370 + i * 44, 210, 40, 36, String(n), "is-off");
        return c;
      });

      refs.s3State = textEl(layer, 60, 270, "", "t-small");

      var banner = svg("g", { class: "anim-banner" }, layer);
      svg("rect", { x: 40, y: 12, width: 680, height: 52, rx: 5 }, banner);
      refs.banner = banner;
      refs.line1 = textEl(banner, 380, 37, "", "t-name", "middle");
      refs.line2 = textEl(banner, 380, 57, "", "t-sub", "middle");
      return refs;
    },
    render: function (refs, i, api) {
      var st = STEPS[i];
      refs.s3Old.style.opacity = st.s3Old ? 1 : 0;
      refs.s3Snap.style.opacity = st.s3Snap ? 1 : 0;
      refs.s3Entries.forEach(function (c, j) {
        c.g.setAttribute(
          "class",
          "anim-chip " + (j < st.s3Entries ? "is-on" : "is-off")
        );
      });
      refs.s3State.textContent = st.s3State;
      refs.banner.setAttribute(
        "class",
        "anim-banner" + (st.tone ? " is-" + st.tone : "")
      );
      refs.line1.textContent = st.banner[0];
      refs.line2.textContent = st.banner[1];

      if (i === 2) {
        api.msg({
          from: [300, 140],
          to: [300, 204],
          label: "InstallSnapshot(100, term 6)",
          color: "warn",
          curve: -12,
          labelDy: 0
        });
      }
      if (i === 4) {
        api.msg({
          from: [340, 140],
          to: [340, 204],
          label: "AppendEntries(prev=100)",
          color: "accent",
          curve: -12,
          labelDy: 0
        });
      }
      if (i === 3) api.pulse(refs.s3Snap);
      if (i === 5) refs.s3Entries.forEach(function (c) { api.pulse(c.g); });
    }
  };
})();

(function () {
  var A = window.InfraAnim;
  var svg = A.svg;
  var textEl = A.textEl;
  var card = A.card;

  function svcCard(layer, x, y, w, h, name) {
    var c = card(layer, x, y, w, h);
    c.name.textContent = name;
    return c;
  }

  function paint(c, d) {
    c.badge.textContent = d.badge;
    c.sub.textContent = d.l1;
    c.sub2.textContent = d.l2;
    c.g.setAttribute("class", "anim-node " + (d.state || ""));
  }

  var STEPS = [
    {
      caption:
        "pod-a 发起一条新 TCP 连接，目标是 Service VIP 10.96.0.10:80。",
      note: "VIP 不属于任何网卡；它由本机路由和 iptables 规则接住。",
      client: { badge: "SYN", l1: "client · 10.22.0.2", l2: "目标：VIP:80", state: "is-focus" },
      vip: { badge: "svc", l1: "10.96.0.10:80", l2: "dummy svc0", state: "is-focus" },
      ipt: { badge: "PREROUTING", l1: "规则链", l2: "等待匹配", state: "" },
      ct: { badge: "ct", l1: "flow：—", l2: "flow：—", state: "" },
      a: { badge: "A", l1: "10.22.0.2:80", l2: "hits：0", state: "" },
      b: { badge: "B", l1: "10.22.0.3:80", l2: "hits：0", state: "" },
      banner: ["新连接发往 VIP", "client → 10.96.0.10:80"],
      tone: ""
    },
    {
      caption:
        "PREROUTING 匹配目的地址 VIP，跳到 MINICNI-SVC 规则链。",
      note: "DNAT 只处理连接的第一个包；后续包由 conntrack 直接映射。",
      client: { badge: "SYN", l1: "client · 10.22.0.2", l2: "目标：VIP:80", state: "" },
      vip: { badge: "svc", l1: "10.96.0.10:80", l2: "命中", state: "is-good" },
      ipt: { badge: "MATCH", l1: "MINICNI-SVC", l2: "准备 DNAT", state: "is-focus" },
      ct: { badge: "ct", l1: "flow：—", l2: "flow：—", state: "" },
      a: { badge: "A", l1: "10.22.0.2:80", l2: "hits：0", state: "" },
      b: { badge: "B", l1: "10.22.0.3:80", l2: "hits：0", state: "" },
      banner: ["命中 VIP 规则", "PREROUTING -d 10.96.0.10 -j MINICNI-SVC"],
      tone: "warn"
    },
    {
      caption:
        "nth 规则选中后端 A：DNAT 到 10.22.0.2:80。",
      note: "`--ctstate NEW` 让计数器只看新连接，重传不会打乱轮询比例。",
      client: { badge: "SYN", l1: "client · 10.22.0.2", l2: "目标：VIP:80", state: "" },
      vip: { badge: "svc", l1: "10.96.0.10:80", l2: "已 DNAT", state: "" },
      ipt: { badge: "DNAT", l1: "→ A", l2: "10.22.0.2:80", state: "is-good" },
      ct: { badge: "ct", l1: "flow：—", l2: "flow：—", state: "" },
      a: { badge: "A", l1: "10.22.0.2:80", l2: "hits：1", state: "is-good" },
      b: { badge: "B", l1: "10.22.0.3:80", l2: "hits：0", state: "" },
      banner: ["第一条新连接选 A", "DNAT 到 10.22.0.2:80"],
      tone: "good"
    },
    {
      caption:
        "conntrack 记录这条流；后续包不再走 DNAT，直接按记录转发。",
      note: "同一个 TCP 连接内的多个请求只走一个后端；轮询发生在连接级别。",
      client: { badge: "EST", l1: "连接已建立", l2: "目标：VIP:80", state: "" },
      vip: { badge: "svc", l1: "10.96.0.10:80", l2: "转发中", state: "" },
      ipt: { badge: "DNAT", l1: "→ A", l2: "仅首包", state: "" },
      ct: { badge: "ct", l1: "flow1：VIP→A", l2: "flow2：—", state: "is-good" },
      a: { badge: "A", l1: "10.22.0.2:80", l2: "hits：1", state: "is-good" },
      b: { badge: "B", l1: "10.22.0.3:80", l2: "hits：0", state: "" },
      banner: ["conntrack 记住这条流", "后续包直接用映射，不再轮询"],
      tone: "good"
    },
    {
      caption:
        "A 的回复经过 conntrack 还原 DNAT；客户端看到的源地址仍然是 VIP。",
      note: "如果没有 conntrack，回包的源地址会是后端 IP，客户端 socket 会丢弃。",
      client: { badge: "reply", l1: "源：VIP:80", l2: "内容：A", state: "is-good" },
      vip: { badge: "svc", l1: "10.96.0.10:80", l2: "对客户端可见", state: "" },
      ipt: { badge: "DNAT", l1: "→ A", l2: "回包还原", state: "" },
      ct: { badge: "ct", l1: "flow1：VIP→A", l2: "reply：A→VIP", state: "is-good" },
      a: { badge: "A", l1: "10.22.0.2:80", l2: "hits：1", state: "is-good" },
      b: { badge: "B", l1: "10.22.0.3:80", l2: "hits：0", state: "" },
      banner: ["回包还原", "客户端看到源地址 VIP；后端真实地址被隐藏"],
      tone: "good"
    },
    {
      caption:
        "下一条新连接选中后端 B；已有的 flow1 仍然固定在 A。",
      note: "轮询计数器只对新连接生效；长连接不会中途换后端。",
      client: { badge: "conn 2", l1: "client · 10.22.0.2", l2: "新连接 → VIP:80", state: "is-focus" },
      vip: { badge: "svc", l1: "10.96.0.10:80", l2: "第二次 DNAT", state: "" },
      ipt: { badge: "DNAT", l1: "→ B", l2: "10.22.0.3:80", state: "is-focus" },
      ct: { badge: "ct", l1: "flow1：VIP→A", l2: "flow2：VIP→B", state: "is-good" },
      a: { badge: "A", l1: "10.22.0.2:80", l2: "hits：1", state: "" },
      b: { badge: "B", l1: "10.22.0.3:80", l2: "hits：1", state: "is-good" },
      banner: ["第二条新连接选 B", "flow1 仍走 A；每条连接各自粘住一个后端"],
      tone: "good"
    },
    {
      caption:
        "hairpin：pod-a 访问 VIP 时，回复可能绕过宿主；需要 MARK + MASQUERADE。",
      note: "后端和客户端在同一 bridge 上，回复按二层直接发给客户端，源 IP 不是 VIP。",
      client: { badge: "hairpin", l1: "pod-a → VIP", l2: "同节点", state: "is-slow" },
      vip: { badge: "svc", l1: "10.96.0.10:80", l2: "打 mark", state: "is-slow" },
      ipt: { badge: "SNAT", l1: "MARK 0x4000", l2: "MASQUERADE", state: "is-slow" },
      ct: { badge: "ct", l1: "flow1：VIP→A", l2: "hairpin：需要 SNAT", state: "is-slow" },
      a: { badge: "A", l1: "10.22.0.2:80", l2: "既是后端也是客户端", state: "is-slow" },
      b: { badge: "B", l1: "10.22.0.3:80", l2: "hits：1", state: "" },
      banner: ["同节点访问 VIP 需要 hairpin", "MARK + MASQUERADE，让回包先经过宿主"],
      tone: "bad"
    },
    {
      caption:
        "规则：DNAT 只改首包，conntrack 负责整条流；Service 轮询是连接级的。",
      note: "排查时先看 conntrack，再看 PREROUTING 的规则顺序；`-I` 和 `-A` 的顺序会决定 MARK 是否生效。",
      client: { badge: "ok", l1: "连接稳定", l2: "源：VIP:80", state: "" },
      vip: { badge: "svc", l1: "10.96.0.10:80", l2: "服务中", state: "" },
      ipt: { badge: "DNAT", l1: "首包", l2: "conntrack 接管", state: "" },
      ct: { badge: "ct", l1: "flow1：A", l2: "flow2：B", state: "is-good" },
      a: { badge: "A", l1: "10.22.0.2:80", l2: "hits：1", state: "" },
      b: { badge: "B", l1: "10.22.0.3:80", l2: "hits：1", state: "" },
      banner: ["DNAT 只改首包", "同一条连接固定一个后端；conntrack 负责回包"],
      tone: "good"
    }
  ];

  A.SPECS["service-vip"] = {
    title: "Service VIP：DNAT 轮询、conntrack 和 hairpin",
    width: 760,
    height: 380,
    steps: STEPS,
    build: function (layer) {
      var refs = {};
      refs.client = svcCard(layer, 30, 150, 140, 70, "pod-a");
      refs.vip = svcCard(layer, 210, 160, 150, 64, "VIP");
      refs.ipt = svcCard(layer, 390, 80, 170, 80, "PREROUTING");
      refs.ct = svcCard(layer, 390, 250, 190, 80, "conntrack");
      refs.a = svcCard(layer, 600, 80, 130, 64, "pod-a（A）");
      refs.b = svcCard(layer, 600, 250, 130, 64, "pod-b（B）");

      var banner = svg("g", { class: "anim-banner" }, layer);
      svg("rect", { x: 40, y: 12, width: 680, height: 52, rx: 5 }, banner);
      refs.banner = banner;
      refs.line1 = textEl(banner, 380, 37, "", "t-name", "middle");
      refs.line2 = textEl(banner, 380, 57, "", "t-sub", "middle");
      return refs;
    },
    render: function (refs, i, api) {
      var st = STEPS[i];
      paint(refs.client, st.client);
      paint(refs.vip, st.vip);
      paint(refs.ipt, st.ipt);
      paint(refs.ct, st.ct);
      paint(refs.a, st.a);
      paint(refs.b, st.b);
      refs.banner.setAttribute(
        "class",
        "anim-banner" + (st.tone ? " is-" + st.tone : "")
      );
      refs.line1.textContent = st.banner[0];
      refs.line2.textContent = st.banner[1];

      if (i === 0) {
        api.msg({ from: [170, 185], to: [210, 185], label: "SYN", color: "accent", curve: -6 });
      }
      if (i === 1) {
        api.msg({ from: [360, 180], to: [390, 120], label: "PREROUTING", color: "warn", curve: 12 });
      }
      if (i === 2) {
        api.token({ from: [560, 120], to: [600, 120], label: "A", color: "ok" });
      }
      if (i === 3) {
        api.msg({ from: [640, 144], to: [580, 250], label: "flow", color: "info", curve: 14 });
      }
      if (i === 4) {
        api.msg({ from: [390, 270], to: [170, 205], label: "reply：VIP", color: "ok", curve: 22 });
      }
      if (i === 5) {
        api.token({ from: [560, 140], to: [600, 282], label: "B", color: "ok" });
      }
      if (i === 6) {
        api.pulse(refs.vip.g);
        api.pulse(refs.ipt.g);
      }
    }
  };
})();

(function () {
  var A = window.InfraAnim;
  var svg = A.svg;
  var textEl = A.textEl;

  var X0 = 120;
  var SCALE = 80;
  function tx(t) { return X0 + t * SCALE; }

  var STEPS = [
    {
      caption:
        "A 向租约服务申请资源 ws，拿到 epoch=1，TTL 2 秒。",
      note: "epoch 是 fencing token，按 resource 单调递增；过期时间用服务端时钟。",
      b: false,
      lease2: false,
      lease3: false,
      storage1: false,
      storage2: false,
      storage3: false,
      pause: false,
      resume: false,
      write2: false,
      aState: "",
      banner: ["A acquire：epoch=1", "TTL=2s；租约服务开始计时"],
      tone: ""
    },
    {
      caption:
        "A 带 epoch=1 写存储；存储把 max_epoch 从 0 推到 1，接受这次写。",
      note: "存储端必须把 epoch 和写放在同一个原子操作里；先读后写会留窗口。",
      b: false,
      lease2: false,
      lease3: false,
      storage1: true,
      storage2: false,
      storage3: false,
      pause: false,
      resume: false,
      write2: false,
      aState: "",
      banner: ["A 写入成功", "storage.max_epoch：0 → 1"],
      tone: "good"
    },
    {
      caption:
        "A 被 SIGSTOP（模拟 GC 暂停）；2 秒后租约过期，但 A 自己不知道。",
      note: "租约过期只是“可以换 owner”，不是“旧 owner 已经停止写”。",
      b: false,
      lease2: true,
      lease3: false,
      storage1: true,
      storage2: false,
      storage3: false,
      pause: true,
      resume: false,
      write2: false,
      aState: "is-slow",
      banner: ["A 暂停，租约到期", "lease：granted → expired"],
      tone: "warn"
    },
    {
      caption:
        "B 申请同一个资源，租约服务发出 epoch=2。",
      note: "新 epoch 必须先 fsync，再返回给 B；否则服务重启后可能回到 1。",
      b: true,
      lease2: true,
      lease3: true,
      storage1: true,
      storage2: false,
      storage3: false,
      pause: true,
      resume: false,
      write2: false,
      aState: "is-slow",
      banner: ["B acquire：epoch=2", "同一 resource 的 token 只能递增"],
      tone: "warn"
    },
    {
      caption:
        "B 带 epoch=2 写存储；存储把 max_epoch 推到 2，接受。",
      note: "现在 A 的 epoch=1 已经落后；但只有存储端比较 token，才能拦住 A。",
      b: true,
      lease2: true,
      lease3: true,
      storage1: true,
      storage2: true,
      storage3: false,
      pause: true,
      resume: false,
      write2: false,
      aState: "is-slow",
      banner: ["B 写入成功", "storage.max_epoch：1 → 2"],
      tone: "good"
    },
    {
      caption:
        "A 恢复后仍拿 epoch=1 写；存储发现 1 < 2，返回 fenced，拒绝旧 owner。",
      note: "这就是 fencing：不依赖 A 是否知道自己过期，只依赖存储端的原子比较。",
      b: true,
      lease2: true,
      lease3: true,
      storage1: true,
      storage2: true,
      storage3: true,
      pause: true,
      resume: true,
      write2: true,
      aState: "is-bad",
      banner: ["旧 owner 被 fenced", "storage.max_epoch=2；epoch=1 的写被拒绝"],
      tone: "bad"
    },
    {
      caption:
        "规则：租约负责选 owner，fencing 负责让旧 owner 写不进去；两者缺一不可。",
      note: "审计日志再把每次授予和写入串成 hash chain，用来事后证明发生过什么。",
      b: true,
      lease2: true,
      lease3: true,
      storage1: true,
      storage2: true,
      storage3: true,
      pause: true,
      resume: true,
      write2: true,
      aState: "is-bad",
      banner: ["租约 + fencing", "选主靠租约；正确性靠存储端比较 epoch"],
      tone: "good"
    }
  ];

  A.SPECS["aos-lease"] = {
    title: "租约与 fencing：旧 owner 为什么写不进去",
    width: 760,
    height: 380,
    steps: STEPS,
    build: function (layer) {
      var refs = {};
      textEl(layer, 40, 108, "A", "t-name");
      textEl(layer, 40, 168, "B", "t-name");
      textEl(layer, 40, 228, "lease", "t-name");
      textEl(layer, 40, 288, "storage", "t-name");

      refs.aBar = svg("g", { class: "anim-op" }, layer);
      svg("rect", { x: tx(0), y: 90, width: tx(2) - tx(0), height: 28, rx: 3 }, refs.aBar);
      textEl(refs.aBar, tx(1), 109, "A · epoch 1", "t-mono", "middle");
      refs.aState = refs.aBar;

      refs.bBar = svg("g", { class: "anim-op" }, layer);
      svg("rect", { x: tx(2.8), y: 150, width: tx(5) - tx(2.8), height: 28, rx: 3 }, refs.bBar);
      textEl(refs.bBar, tx(3.9), 169, "B · epoch 2", "t-mono", "middle");
      refs.bBar.style.opacity = 0;

      refs.lease1 = svg("g", { class: "anim-op" }, layer);
      svg("rect", { x: tx(0), y: 210, width: tx(2) - tx(0), height: 28, rx: 3 }, refs.lease1);
      textEl(refs.lease1, tx(1), 229, "granted A e1", "t-mono", "middle");

      refs.lease2 = svg("g", { class: "anim-op is-bad" }, layer);
      svg("rect", { x: tx(2), y: 210, width: tx(2.8) - tx(2), height: 28, rx: 3 }, refs.lease2);
      textEl(refs.lease2, tx(2.4), 229, "expired", "t-small", "middle");
      refs.lease2.style.opacity = 0;

      refs.lease3 = svg("g", { class: "anim-op" }, layer);
      svg("rect", { x: tx(2.8), y: 210, width: tx(5) - tx(2.8), height: 28, rx: 3 }, refs.lease3);
      textEl(refs.lease3, tx(3.9), 229, "granted B e2", "t-mono", "middle");
      refs.lease3.style.opacity = 0;

      refs.store1 = svg("g", { class: "anim-badge is-good" }, layer);
      svg("rect", { x: tx(0.4), y: 270, width: 110, height: 32, rx: 3 }, refs.store1);
      textEl(refs.store1, tx(0.4) + 55, 291, "max=1 · ok", "t-small", "middle");
      refs.store1.style.opacity = 0;

      refs.store2 = svg("g", { class: "anim-badge is-good" }, layer);
      svg("rect", { x: tx(2.9), y: 270, width: 110, height: 32, rx: 3 }, refs.store2);
      textEl(refs.store2, tx(2.9) + 55, 291, "max=2 · ok", "t-small", "middle");
      refs.store2.style.opacity = 0;

      refs.store3 = svg("g", { class: "anim-badge is-bad" }, layer);
      svg("rect", { x: tx(4.5), y: 270, width: 120, height: 32, rx: 3 }, refs.store3);
      textEl(refs.store3, tx(4.5) + 60, 291, "e1 · fenced", "t-small", "middle");
      refs.store3.style.opacity = 0;

      refs.pause = svg("g", {}, layer);
      svg("line", { x1: tx(2), y1: 78, x2: tx(2), y2: 128, class: "anim-static-arrow" }, refs.pause).style.stroke = "var(--anim-bad)";
      textEl(refs.pause, tx(2) + 4, 76, "SIGSTOP", "t-small").style.fill = "var(--anim-bad)";
      refs.pause.style.opacity = 0;

      refs.resume = svg("g", {}, layer);
      svg("line", { x1: tx(4.5), y1: 78, x2: tx(4.5), y2: 128, class: "anim-static-arrow" }, refs.resume).style.stroke = "var(--anim-ok)";
      textEl(refs.resume, tx(4.5) + 4, 76, "SIGCONT", "t-small").style.fill = "var(--anim-ok)";
      refs.resume.style.opacity = 0;

      svg("line", { x1: tx(0), y1: 330, x2: tx(6), y2: 330, class: "anim-static-arrow" }, layer);
      [0, 1, 2, 3, 4, 5, 6].forEach(function (t) {
        svg("line", { x1: tx(t), y1: 325, x2: tx(t), y2: 335, class: "anim-static-arrow" }, layer);
        textEl(layer, tx(t), 350, t + "s", "t-small", "middle");
      });

      var banner = svg("g", { class: "anim-banner" }, layer);
      svg("rect", { x: 40, y: 12, width: 680, height: 52, rx: 5 }, banner);
      refs.banner = banner;
      refs.line1 = textEl(banner, 380, 37, "", "t-name", "middle");
      refs.line2 = textEl(banner, 380, 57, "", "t-sub", "middle");
      return refs;
    },
    render: function (refs, i, api) {
      var st = STEPS[i];
      refs.bBar.style.opacity = st.b ? 1 : 0;
      refs.lease2.style.opacity = st.lease2 ? 1 : 0;
      refs.lease3.style.opacity = st.lease3 ? 1 : 0;
      refs.store1.style.opacity = st.storage1 ? 1 : 0;
      refs.store2.style.opacity = st.storage2 ? 1 : 0;
      refs.store3.style.opacity = st.storage3 ? 1 : 0;
      refs.pause.style.opacity = st.pause ? 1 : 0;
      refs.resume.style.opacity = st.resume ? 1 : 0;
      refs.aBar.setAttribute("class", "anim-op " + (st.aState || ""));
      refs.banner.setAttribute(
        "class",
        "anim-banner" + (st.tone ? " is-" + st.tone : "")
      );
      refs.line1.textContent = st.banner[0];
      refs.line2.textContent = st.banner[1];
      if (i === 5) api.pulse(refs.store3);
      if (i === 4) api.pulse(refs.store2);
    }
  };
})();

(function () {
  var boot = window.InfraAnim.boot;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
