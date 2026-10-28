(function () {
  "use strict";

  // 高亮当前导航
  var page = location.pathname.split("/").pop() || "index.html";
  if (/^lab\d+\.html$/.test(page)) {
    page = "labs.html";
  }
  if (page === "lectures.html") {
    page = "course-map.html";
  }
  document.querySelectorAll(".site-nav a[data-page]").forEach(function (a) {
    if (a.getAttribute("data-page") === page) {
      a.classList.add("active");
    }
  });

  // 外部链接新窗口打开
  document.querySelectorAll('main a[href^="http"]').forEach(function (a) {
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  });

  // 任务列表：启用复选框，并用 localStorage 记住本页进度
  var boxes = Array.prototype.slice.call(
    document.querySelectorAll('main input[type="checkbox"]')
  );
  if (boxes.length === 0) return;

  var storageKey = function (i) {
    return "infra-course:" + location.pathname + ":" + i;
  };

  boxes.forEach(function (box, i) {
    box.disabled = false;
    try {
      if (localStorage.getItem(storageKey(i)) === "1") {
        box.checked = true;
      }
    } catch (e) {
      /* 隐私模式可能禁用 localStorage */
    }
    box.addEventListener("change", function () {
      try {
        localStorage.setItem(storageKey(i), box.checked ? "1" : "0");
      } catch (e) {
        /* 忽略 */
      }
    });
  });

  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "reset-progress";

  var update = function () {
    var done = boxes.filter(function (b) {
      return b.checked;
    }).length;
    btn.textContent = "进度 " + done + "/" + boxes.length + " · 重置本页";
  };

  btn.addEventListener("click", function () {
    boxes.forEach(function (box, i) {
      box.checked = false;
      try {
        localStorage.removeItem(storageKey(i));
      } catch (e) {
        /* 忽略 */
      }
    });
    update();
  });

  var h1 = document.querySelector("main h1");
  if (h1 && h1.parentNode) {
    h1.parentNode.insertBefore(btn, h1.nextSibling);
  }

  boxes.forEach(function (b) {
    b.addEventListener("change", update);
  });
  update();
})();
