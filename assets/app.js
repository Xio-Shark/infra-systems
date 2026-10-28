(function () {
  "use strict";

  // 构建时替换成资源哈希。GH Pages 连 HTML 都是 max-age=600，刷新页面可能仍拿旧文档；
  // 这里比对部署版本，变了就带新 ?v= 跳转一次（同一版本只跳一次，避免循环）。
  var ASSET_VER = "__ASSET_VER__";

  (function checkVersion() {
    if (ASSET_VER.charAt(0) === "_" || !window.fetch) return;
    fetch("version.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data || !data.v || data.v === ASSET_VER) return;
        try {
          if (sessionStorage.getItem("infra-course:ver") === data.v) return;
          sessionStorage.setItem("infra-course:ver", data.v);
        } catch (e) {
          return;
        }
        var url = new URL(location.href);
        url.searchParams.set("v", data.v);
        location.replace(url.toString());
      })
      .catch(function () {
        // 离线或 version.json 缺失时跳过，页面其余部分照常工作
      });
  })();

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
