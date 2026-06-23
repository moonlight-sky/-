v2.2 改动总结
AliPlayer 自动播放（aliPlay() 函数，5 层递进）：
第1层: 查 .prism-player 上的 __player / _player / aliPlayer 实例调 play()
第2层: 全局变量 window[id] 上的 AliPlayer 实例
第3层: 点击 .prism-big-play-btn（大播放按钮）
第4层: 点击播放器容器
第5层: 直接 video.play()
切课后调度播放（schedulePlay()）：
切课完成后在 2/3/4/5/7/10 秒六个时间点依次尝试，确保不管 AliPlayer SDK 加载多慢都能抓到。
倍速 + 保活合一：
每 6 秒执行 aliPlay() + setSpeed()，视频保活、倍速重置、播放按钮检测三合一。

三层机制：
localStorage 累计 — 每个 m3u8 视频 URL 存一个秒数键值对，timeupdate 事件增量写入
3 秒心跳上报 — e._report() 发到 /video/play/behavior/log，携带当前播放进度
阿里云播放器遥测 — vod-newplayer + hermes-player 日志
