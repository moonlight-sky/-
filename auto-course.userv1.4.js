// ==UserScript==
// @name         中特云课 自动刷课
// @namespace    https://cps.yunpub.cn/
// @version      1.4
// @description  防10分钟弹窗 + 防切标签页暂停 + 视频保活。控制台：[auto]
// @match        https://cps.yunpub.cn/personal.html*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    "use strict";

    var INTERVAL = 4 * 60 * 1000;
    var POPUP_CHECK = 2000;
    var VIDEO_KEEPALIVE = 3000;           // 视频保活间隔（高频，应对各种暂停）
    var ENABLE_LOG = true;

    function log() {
        if (!ENABLE_LOG) return;
        var args = ["[auto]", new Date().toLocaleTimeString()];
        for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
        console.log.apply(console, args);
    }

    /* ================================================================
       核心：覆盖 Visibility API，让页面永远以为自己在可见状态
       这样平台切换页面检测就失效了，不会主动暂停视频
       ================================================================ */

    function patchVisibility() {
        // 覆盖 document.hidden -> 始终返回 false
        try {
            Object.defineProperty(document, "hidden", {
                get: function () { return false; },
                configurable: true
            });
        } catch (e) {}

        // 覆盖 document.visibilityState -> 始终返回 "visible"
        try {
            Object.defineProperty(document, "visibilityState", {
                get: function () { return "visible"; },
                configurable: true
            });
        } catch (e) {}

        // 覆盖 document.hasFocus() -> 始终返回 true
        var origHasFocus = document.hasFocus;
        document.hasFocus = function () { return true; };

        // 拦截 visibilitychange 事件，不让它冒泡到平台的监听器
        document.addEventListener("visibilitychange", function (e) {
            e.stopImmediatePropagation();
        }, true); // capture phase，最先拦截

        // 也拦截 webkit 前缀版本
        document.addEventListener("webkitvisibilitychange", function (e) {
            e.stopImmediatePropagation();
        }, true);

        // 覆盖 document.onvisibilitychange setter，阻止平台绑定
        var _onvc = null;
        Object.defineProperty(document, "onvisibilitychange", {
            get: function () { return _onvc; },
            set: function (fn) { _onvc = fn; /* 吞掉不执行 */ },
            configurable: true
        });

        log("Visibility API 已覆盖");
    }

    // @run-at document-start 时立即执行
    patchVisibility();

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
        setTimeout(function () {
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
        log("act");
        mouse();
        setTimeout(function () {
            var acts = [key, scroll, click, mouse];
            acts[Math.floor(Math.random() * acts.length)]();
        }, 300 + Math.random() * 700);
    }

    /* ---- 弹窗自动关闭 ---- */

    var CONFIRMS = [
        "确定", "确认", "继续", "我知道了", "知道了",
        "关闭", "确定继续", "继续播放", "好的", "是", "OK"
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
                    log("dismiss", t);
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

    /* ---- 视频保活（高频，应对切换标签页+弹窗+各种暂停） ---- */

    var lastPlayAttempt = 0;

    function videoResume() {
        var vs = document.querySelectorAll("video");
        if (vs.length === 0) return;

        // 限制日志频率，避免刷屏
        var now = Date.now();
        var quiet = now - lastPlayAttempt < 10000;

        for (var i = 0; i < vs.length; i++) {
            var v = vs[i];
            if (v.paused && v.readyState >= 1) {
                if (!quiet) log("resume");
                v.play().then(function () {
                    if (!quiet) log("resumed");
                }).catch(function () {});
                lastPlayAttempt = now;

                // 设置视频不要静音（有些平台检测静音）
                if (v.muted) {
                    v.muted = false;
                    v.volume = 0.3;
                }
            }
        }
    }

    /* ---- DOM 弹窗监控 ---- */

    var obs = new MutationObserver(function (ms) {
        for (var i = 0; i < ms.length; i++) {
            var added = ms[i].addedNodes;
            for (var j = 0; j < added.length; j++) {
                var node = added[j];
                if (node.nodeType !== 1) continue;
                var cn = (node.className || "").toString();
                if (/modal|dialog|popup|alert|layer/i.test(cn)) {
                    log("popup-detected");
                    setTimeout(dismiss, 300);
                    setTimeout(dismiss, 800);
                    return;
                }
            }
        }
    });

    /* ---- 入口 ---- */

    var started = false;

    function boot() {
        if (started) return;
        if (window.location.hash.indexOf("course/player") === -1) return;
        started = true;
        log("==== 中特云课 自动刷课 v1.4 ====");
        obs.observe(document.body, { childList: true, subtree: true });

        // 活动模拟
        setInterval(function () {
            simulate();
            setTimeout(function () { videoResume(); dismiss(); }, 2000);
        }, INTERVAL);

        // 弹窗轮询
        setInterval(dismiss, POPUP_CHECK);

        // 视频保活（高频3秒，即使切标签页也能保持）
        setInterval(videoResume, VIDEO_KEEPALIVE);

        // 首次立即执行
        setTimeout(simulate, 2000);
    }

    window.addEventListener("hashchange", boot);
    setTimeout(boot, 1000);
    setTimeout(boot, 3000);
    setTimeout(boot, 8000);
})();
