// ==UserScript==
// @name         中特云课 自动刷课
// @namespace    https://cps.yunpub.cn/
// @version      2.0
// @description  防弹窗+防切页暂停+视频完播自动下一节+Angular切课+学习时间注入控制台:[auto]
// @match        https://cps.yunpub.cn/personal.html*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    "use strict";

    var INTERVAL        = 4 * 60 * 1000;
    var POPUP_CHECK     = 2000;
    var VIDEO_KEEPALIVE = 3000;
    var ENABLE_LOG      = true;
    var VIDEO_SPEED     = 3;             // 播放速度倍率（1=正常 2=两倍 3=三倍）

    function log() {
        if (!ENABLE_LOG) return;
        var a = ["[auto]", new Date().toLocaleTimeString()];
        for (var i = 0; i < arguments.length; i++) a.push(arguments[i]);
        console.log.apply(console, a);
    }

    /* ==============================================================
       1. Visibility API 覆盖
       ============================================================== */
    function patchVisibility() {
        var desc = function(val) {
            return { get: function(){ return val; }, configurable: true };
        };
        try { Object.defineProperty(document, "hidden", desc(false)); } catch(e) {}
        try { Object.defineProperty(document, "visibilityState", desc("visible")); } catch(e) {}

        document.addEventListener("visibilitychange", function(e) {
            e.stopImmediatePropagation();
        }, true);
        document.addEventListener("webkitvisibilitychange", function(e) {
            e.stopImmediatePropagation();
        }, true);

        var _vc = null;
        try {
            Object.defineProperty(document, "onvisibilitychange", {
                get: function(){ return _vc; },
                set: function(fn){ _vc = fn; },
                configurable: true
            });
        } catch(e) {}
    }
    patchVisibility();

    /* ---- blur/focus 防护 ---- */
    function patchBlurFocus() {
        window.addEventListener("blur", function(e) {
            e.stopImmediatePropagation();
            setTimeout(function() {
                window.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
            }, 50);
        }, true);
        document.addEventListener("blur", function(e) {
            e.stopImmediatePropagation();
        }, true);
    }

    /* ---- 播放速度设置 ---- */
    function setSpeed() {
        document.querySelectorAll("video").forEach(function(v) {
            try { v.playbackRate = VIDEO_SPEED; } catch(e) {}
        });
    }

    /* ---- 模拟用户活动 ---- */
    function mouse() {
        var e = new MouseEvent("mousemove", {
            bubbles: true, cancelable: true,
            clientX: 100 + Math.random() * 400,
            clientY: 100 + Math.random() * 400,
            movementX: Math.random() * 20,
            movementY: Math.random() * 20
        });
        document.dispatchEvent(e);
        document.body.dispatchEvent(e);
    }

    function key() {
        var kd = new KeyboardEvent("keydown", {
            bubbles: true, cancelable: true,
            key: "Shift", code: "ShiftLeft", keyCode: 16, which: 16
        });
        document.dispatchEvent(kd);
        document.body.dispatchEvent(kd);
        setTimeout(function() {
            var ku = new KeyboardEvent("keyup", {
                bubbles: true, cancelable: true,
                key: "Shift", code: "ShiftLeft", keyCode: 16, which: 16
            });
            document.dispatchEvent(ku);
            document.body.dispatchEvent(ku);
        }, 200);
    }

    function scroll() {
        window.scrollBy(0, Math.random() > 0.5 ? 3 : -3);
    }

    function click() {
        var e = new MouseEvent("click", {
            bubbles: true, cancelable: true,
            clientX: 300 + Math.random() * 200,
            clientY: 200 + Math.random() * 100, button: 0
        });
        document.body.dispatchEvent(e);
    }

    function simulate() {
        mouse();
        setTimeout(function() {
            var acts = [key, scroll, click, mouse];
            acts[Math.floor(Math.random() * acts.length)]();
        }, 300 + Math.random() * 700);
    }

    /* ---- 弹窗自动关闭 ---- */
    var CONFIRMS = [
        "\u786e\u5b9a", "\u786e\u8ba4", "\u7ee7\u7eed", "\u6211\u77e5\u9053\u4e86",
        "\u77e5\u9053\u4e86", "\u5173\u95ed", "\u786e\u5b9a\u7ee7\u7eed",
        "\u7ee7\u7eed\u64ad\u653e", "\u597d\u7684", "\u662f", "OK"
    ];

    function visible(el) {
        if (!el) return false;
        var s = getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    function dismiss() {
        var btns = document.querySelectorAll(
            'button, a, .btn, [role="button"], [ng-click], .button, [class*="btn"]'
        );
        for (var i = 0; i < btns.length; i++) {
            var b = btns[i];
            var t = (b.textContent || "").trim().replace(/\s+/g, "");
            for (var j = 0; j < CONFIRMS.length; j++) {
                if (t.indexOf(CONFIRMS[j]) !== -1 && visible(b) && t.length < 15) {
                    b.click();
                    return true;
                }
            }
        }
        var sels = [
            ".modal.show .btn-primary", ".modal.in .btn-primary",
            ".modal .btn-primary", ".modal-dialog .btn-primary",
            ".modal-content .btn-primary", ".dialog .confirm",
            ".popup .confirm", ".layui-layer-btn0",
            ".el-message-box__btns .el-button--primary",
            ".weui-dialog__btn_primary", ".van-dialog__confirm"
        ];
        for (var k = 0; k < sels.length; k++) {
            var el = document.querySelector(sels[k]);
            if (el && visible(el)) { el.click(); return true; }
        }
        return false;
    }

    /* ---- 视频保活 ---- */
    function videoResume() {
        document.querySelectorAll("video").forEach(function(v) {
            if (v.paused && v.readyState >= 1) {
                v.play().catch(function() {});
                if (v.muted) { v.muted = false; v.volume = 0.3; }
            }
        });
    }

    /* ==============================================================
       2. 学习时间注入 — localStorage 重写
       每隔N秒将当前视频的 localStorage 累计时间设为视频时长
       ============================================================== */
    var lastTimeInjection = 0;

    function injectStudyTime() {
        var now = Date.now();
        // 每15秒注入一次，减少频繁写入
        if (now - lastTimeInjection < 15000) return;

        document.querySelectorAll("video").forEach(function(v) {
            if (v.duration && !isNaN(v.duration) && v.duration > 0) {
                // 从 currentSrc 提取 m3u8 URL
                var src = v.currentSrc || v.src || "";
                if (!src) return;

                // 设置学习进度 = 视频总时长（100%完成）
                try {
                    localStorage.setItem(src, String(v.duration));

                    // 也设置哈希简写版本的 key（平台同时用两种 key）
                    var hashMatch = src.match(/\/([^/]+)-sd-nbv1\.m3u8$/);
                    if (hashMatch) {
                        // 短key 格式：hash前部分
                        var segs = hashMatch[1].split("-");
                        if (segs.length >= 2) {
                            var shortKey = segs[0];
                            localStorage.setItem(shortKey, String(v.duration));
                        }
                    }

                    lastTimeInjection = now;
                } catch(e) {}
            }
        });
    }

    /* ==============================================================
       3. 视频完播 → Angular 自动切下一节
       ============================================================== */
    var jumpedTasks = {};
    var nextCourseCheckRunning = false;

    // 通过 Angular scope 切换课程
    function switchViaAngular(courseObj) {
        try {
            var rootScope = angular.element(document.body).scope();
            // 遍历 scope 找 switchCourse
            var s = rootScope;
            var depth = 0;
            while (s && depth < 5) {
                if (typeof s.switchCourse === "function") {
                    // 检查 next_course 是否存在
                    if (s.next_course && s.next_course.task_id) {
                        var next = s.next_course;
                        log("Angular switchCourse ->", next.name || next.task_id);
                        s.switchCourse(next);
                    } else if (courseObj) {
                        log("Angular switchCourse ->", courseObj);
                        s.switchCourse(courseObj);
                    } else {
                        // 从 course_dirs 找下一节
                        findAndSwitchNext(s);
                    }
                    return true;
                }
                s = s.$$childHead || s.$$nextSibling;
                depth++;
            }
        } catch(e) {
            log("Angular switch failed:", e.message);
        }
        return false;
    }

    // 从 course_dirs 结构中找下一节
    function findAndSwitchNext(scope) {
        if (!scope.course_dirs) return false;
        var dirs = scope.course_dirs;
        var currentTask = getCurrentTaskId();
        var allCourses = [];
        var foundCurrent = false;

        // 展开所有 group.courses 到扁平列表
        for (var i = 0; i < dirs.length; i++) {
            var courses = dirs[i].courses || [];
            for (var j = 0; j < courses.length; j++) {
                allCourses.push({ course: courses[j], groupIndex: i, courseIndex: j });
            }
        }

        for (var k = 0; k < allCourses.length; k++) {
            var item = allCourses[k];
            if (String(item.course.task_id) === String(currentTask)) {
                foundCurrent = true;
                continue;
            }
            if (foundCurrent) {
                log("Found next:", item.course.name || item.course.task_id);
                scope.switchCourse(item.course);
                return true;
            }
        }

        // 没找到下一节 = 章节结束
        if (foundCurrent) {
            log("=== ALL COURSES IN CHAPTER COMPLETED ===");
            autoClickNextChapter();
        }
        return false;
    }

    function autoClickNextChapter() {
        // 尝试找"下一章"按钮
        var nextChapterBtn = document.querySelector(
            '[ng-click*="nextChapter"], [ng-click*="next_chapter"], ' +
            '[class*="next-chapter"], [class*="nextChapter"], ' +
            '.btn-next-chapter, [class*="chapter"] [class*="next"]'
        );
        if (nextChapterBtn && visible(nextChapterBtn)) {
            log("Clicking next chapter");
            nextChapterBtn.click();
            jumpedTasks = {};
            setTimeout(function() { started = false; boot(); }, 3000);
        }
    }

    function getCurrentTaskId() {
        var m = window.location.hash.match(/task_id=(\d+)/);
        return m ? m[1] : null;
    }

    // 视频结束时触发
    function onVideoEnded() {
        log("VIDEO ENDED");

        // 先确保 localStorage 学习时间已标记完成
        injectStudyTime();

        var currentTask = getCurrentTaskId();
        if (jumpedTasks[currentTask]) return;  // 防止重复
        jumpedTasks[currentTask] = true;

        // 方式1: Angular scope 切课
        setTimeout(function() {
            if (!switchViaAngular(null)) {
                // 方式2: DOM 点击下一节
                goToNextViaDOM();
            }
        }, 1500);
    }

    // DOM 方式跳转（备用）
    function goToNextViaDOM() {
        var courseItems = document.querySelectorAll('[ng-repeat*="course in group.courses"]');
        if (courseItems.length === 0) {
            courseItems = document.querySelectorAll('[data-task-id], [ng-click*="course"]');
        }
        if (courseItems.length === 0) { log("No course items found"); return; }

        var currentIndex = -1;
        var currentTask = getCurrentTaskId();

        for (var i = 0; i < courseItems.length; i++) {
            var item = courseItems[i];
            if (item.classList.contains("active") || item.classList.contains("current") || item.classList.contains("on")) {
                currentIndex = i; break;
            }
            var activeChild = item.querySelector('[class*="active"], [class*="current"]');
            if (activeChild) { currentIndex = i; break; }
            if (item.innerHTML.indexOf(currentTask) !== -1) { currentIndex = i; break; }
        }

        if (currentIndex === -1) { currentIndex = 0; }
        var nextIndex = currentIndex + 1;
        if (nextIndex >= courseItems.length) {
            log("=== CHAPTER ENDED ===");
            autoClickNextChapter();
            return;
        }

        var nextItem = courseItems[nextIndex];
        var clickTarget = nextItem.querySelector("a, button, [ng-click], .cursor-p") || nextItem;
        log("Clicking next DOM item:", nextIndex);
        clickTarget.click();

        // 回退：手动修改 URL
        setTimeout(function() {
            if (window.location.hash.indexOf("task_id=" + currentTask) !== -1) {
                var nextTaskMatch = nextItem.innerHTML.match(/task_id[=:](\d+)/) ||
                                    (nextItem.getAttribute("ng-click") || "").match(/(\d{6,})/);
                if (nextTaskMatch) {
                    var newHash = window.location.hash.replace(/task_id=\d+/, "task_id=" + nextTaskMatch[1]);
                    log("Manual redirect:", newHash);
                    window.location.hash = newHash;
                }
            }
        }, 2000);
    }

    // 监听视频 ended 事件
    function attachVideoEndedListener() {
        document.querySelectorAll("video").forEach(function(v) {
            if (!v.__autoNextAttached) {
                v.__autoNextAttached = true;
                v.addEventListener("ended", function() {
                    onVideoEnded();
                });
                log("ended listener attached");
            }
        });
    }

    /* ---- DOM 弹窗监控 ---- */
    var obs = new MutationObserver(function(ms) {
        for (var i = 0; i < ms.length; i++) {
            var added = ms[i].addedNodes;
            for (var j = 0; j < added.length; j++) {
                var node = added[j];
                if (node.nodeType !== 1) continue;
                var cn = (node.className || "").toString();
                if (/modal|dialog|popup|alert|layer/i.test(cn)) {
                    setTimeout(dismiss, 300);
                    setTimeout(dismiss, 800);
                    return;
                }
            }
        }
    });

    /* ---- 主入口 ---- */
    var started = false;

    function boot() {
        if (started) return;
        if (window.location.hash.indexOf("course/player") === -1) return;
        started = true;
        log("==== 中特云课 自动刷课 v2.0 ====");

        jumpedTasks = {};
        patchBlurFocus();

        // 设置播放速度
        setTimeout(setSpeed, 3000);

        obs.observe(document.body, { childList: true, subtree: true });

        // 学习时间注入
        setInterval(injectStudyTime, 15000);

        // 定期任务
        setInterval(function() {
            simulate();
            setTimeout(function() { videoResume(); dismiss(); attachVideoEndedListener(); setSpeed(); }, 2000);
        }, INTERVAL);

        setInterval(dismiss, POPUP_CHECK);
        setInterval(videoResume, VIDEO_KEEPALIVE);
        setInterval(attachVideoEndedListener, 5000);
        setInterval(setSpeed, 10000);

        setTimeout(function() {
            simulate();
            setTimeout(attachVideoEndedListener, 3000);
        }, 2000);
    }

    window.addEventListener("hashchange", function() {
        started = false;
        jumpedTasks = {};
        setTimeout(boot, 1000);
        setTimeout(boot, 3000);
    });

    setTimeout(boot, 1000);
    setTimeout(boot, 3000);
    setTimeout(boot, 8000);
})();
