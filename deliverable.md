# 二十四点 - 交付报告

## 摘要

| 字段 | 值 |
| --- | --- |
| **App 名称** | 二十四点 |
| 英文名 / 路由 | POINT 24 · `#/`、`#/lot/<id>`、`#/daily`、`#/random/<band>/<token>` |
| 玩法一句话 | 四张牌, 加减乘除, 凑出 24; 点两个数再点一个运算符合成新数 |
| 难度数字的来源 | `cards`(最少张数)/`steps`(最少步数)/`exprs`(本质不同最简算式条数)由 `js/core/solve.js` 在有理数域上穷举全部二叉树形状与运算算出, 构建期 `tools/bake.mjs` 烘焙进 `js/data/lots.js`, 每手在 `test/library.test.mjs` 重解复验 |
| 完备性锚点 | 1..13 可重复四元组 1820 副全枚举, 可解 **1362/1820** —— `test/anchor.test.mjs` 真跑全部 1820 副 |
| 分数证据 | 正向 `3,3,7,7`、`1,5,5,5` 有理数域可解; 整数中间值负例求解器 `js/core/intonly.js` 判其不可解 (`test/intonly.test.mjs`) |
| 依赖数 | 0 (`dependencies` 与 `devDependencies` 均为 `{}`) |
| 二进制资产 | 0 (画面为 canvas 2D 程序绘制, 图标 `data:,`) |
| 测试钩子 | `window.point24` (`js/main.js` 第 365 行起, state getter / load / numberPoint / keyPoint / plan / play) |

## 文件清单与验证者

| 文件 | 作用 | 由谁验证 |
| --- | --- | --- |
| `index.html` | 壳与 DOM id 面 | verify.sh `@boot`「页面标题」「favicon 已声明」、`@pointer`「每个控件都在」 |
| `css/game.css` | 版式; `#board` 给出真实盒 | `@pointer`: 点击 `numberPoint()` 坐标必须命中牌面, 依赖 canvas 的真实尺寸 |
| `js/main.js` | 路由/存档/接线, 暴露 `window.point24` | `@boot` `@routes` `@save` 全部断言经由该钩子读取状态 |
| `js/view.js` | 像素 + 命中区, 只上报点中了谁 | `@pointer` 23 条 (真实 mousePressed/mouseReleased 走完整认证解) |
| `js/core/frac.js` | 既约分数 `{n,d}`, 无浮点 | `test/frac.test.mjs` (10 条, 含 `1/3*3===1` 精确成立) |
| `js/core/solve.js` | 有理数域穷举: cards/steps/exprs/活路 | `test/solve.test.mjs` (15 条, 含手算 fixture、不改入参、硬预算报错) 与 `test/anchor.test.mjs` (6 条) |
| `js/core/intonly.js` | 整数中间值负例求解器 | `test/intonly.test.mjs` (9 条): 对两副分数牌判不可解, 对其余牌与有理数求解器对账 |
| `js/core/game.js` | 选牌/合成/撤销的单机状态机, 非法不计数 | `test/game.test.mjs` (8 条) + `@play` (15 条) |
| `js/core/library.js` | 48 手 campaign 的索引/分带 | `test/library.test.mjs` (7 条): 从序列化数据逐手重解复验三个数字 |
| `js/core/make.js` | `dailyLot`/`randomLot` 种子出题 | `test/make.test.mjs` (5 条) + `@routes`「同种子两次同牌」 |
| `js/core/rng.js` | `hashSeed` + `mulberry32` | `test/make.test.mjs` 自洽断言 (同种子相等、`>>>0` 32 位内), 不比对公开 FNV 向量 |
| `js/core/storage.js` | 唯一可碰 `window` 的 core 层文件 | `test/storage.test.mjs` (9 条: 单调性/无 window 退化内存) + `@save` (15 条) |
| `js/data/lots.js` | 烘焙产物 (48 手测量记录) | `test/library.test.mjs` 重解每行; `node tools/bake.mjs` 是它的生成命令 |
| `server.cjs` | 零依赖静态服务器 (ES module 需要 origin) | `tools/verify.sh` 全程从它服务的 `http://127.0.0.1:5187/` 跑 |
| `tools/bake.mjs` | 构建期出题 + 1820 副普查 | 本报告「数字从哪来」的原样输出即它跑出来的 |
| `tools/harness.mjs` | node/浏览器同形状的 rows+fail 输出 | 每个 `test/*.test.mjs` 尾行的 `rows: N fail: 0` |
| `tools/playtest.mjs` | 零依赖 CDP 驱动, 五段场景 | `SKIP_UNIT=1 bash tools/verify.sh` 本身 |
| `tools/verify.sh` | 一次性验收门 | 本次实测输出见「验收结论」 |
| `README.md` `DESIGN.md` | 玩法与边界 / 维护者文档 | 数字与本报告同源 (bake 输出、锚点测试) |

## 数字从哪来

`node tools/bake.mjs` 真实统计行 (原样):

```
census over 1820 deals in 4.4s
  可解(全四张) 1362/1820 = 74.8%  <- 公开锚点 1362/1820
  整数中间值可解 1346/1820;其中只有分数才可解 16 副
  最少张数分布 {"2":433,"3":779,"4":352,"unsolvable":256}
  难度带 rejected:458 solo:352 narrow:433 spark:359 open:218
  单副穷举耗时 中位 2ms · 最大 33ms
band spark(火花) n=12 cards={"2":12} exprs=1:11/12=91.7% 单副耗时 中位2ms/最大4ms 状态数 中位48/最大101 拒绝[unsolvable:8 otherBand:29] 尝试12次
band open(开阔) n=12 cards={"3":12} exprs=1:0/12=0.0% 单副耗时 中位4ms/最大5ms 状态数 中位159/最大165 拒绝[otherBand:73 unsolvable:13 partialOnly:13 duplicate:1] 尝试13次
band narrow(窄门) n=12 cards={"3":12} exprs=1:9/12=75.0% 单副耗时 中位3.5ms/最大5ms 状态数 中位127/最大171 拒绝[otherBand:35 partialOnly:6 unsolvable:9] 尝试12次
band solo(独解) n=12 cards={"4":12} exprs=1:3/12=25.0% 单副耗时 中位2ms/最大4ms 状态数 中位112/最大178 拒绝[unsolvable:13 partialOnly:9 otherBand:30] 尝试12次
wrote 48 hands (spark:12 open:12 narrow:12 solo:12) -> js/data/lots.js
```

如实的接受率边界: `open` 带只覆盖全空间 218/1820 = 12.0% (< 20%), 烤该带用了 13 次尝试. 全部搜索只在构建期; 浏览器里点击时只做单步校验与"是否还能达成"的有预算查询 (`live/need`), 见 DESIGN §6.

复现命令: `node tools/bake.mjs`

## 改动表(先写错在哪 → 为什么对)

| 曾经的错误 | 错在哪 | 为什么现在是对的 | 证据 |
| --- | --- | --- | --- |
| `@pointer` 17 条失败, 真实点击全部"没反应" | `js/view.js` 的 `measure()` 牌行高度只按宽度算 (1.32×tileW), 运算符行贴底按牌高放大 (0.55×tileH). 900×780 headless 下 canvas 864×400: 牌占 y 50–314, 键占 239–384, **两行重叠**; `hit()` 先查牌, 每次点运算符都被当成点牌, moves/rejects 永远不动 | `measure()` 改为高度预算: `keyH`、牌行、日志带各设上限, `tileH` 被 `H - header - keyH - logH - PAD` 夹住, 两行不再重叠. 这是真实布局缺陷(手机短屏同样触发), 不是测试的错 | `@pointer` rows: 23 fail: []; 修复前同场景 17 条失败, 事件日志证明 pointerdown 已到达 canvas 但命中到了牌 |
| `@save`「an unfinished run does not touch the record」失败 (`open: null`) | 断言先解首手(解锁 ladder 到 2), 再 `load('#/')` —— 而 `#/` 开的是 `store.unlocked` 指向的第 2 手 spark-02, 它本来没有纪录, 于是检查错了手 | 场景改为 `load('#/lot/' + id)` 回到刚解出的那只手, 断言原文不动, 检查的确实是"未打完的一手不改纪录" | `@save` rows: 15 fail: [] |
| `@pointer` 键盘两条失败 + spark-11 一段级联失败 | 牌面点击修好后仍失败: 键盘段在 spark-11(一手即胜)上 `play(plan.slice(0,1))`, 提交即完成, curtain 落下且 undo/hint 按钮 disabled, u/h 键按的是禁用按钮; 同段还期望真实点击 shelf 里的 spark-11, 但该按钮 `n > unlocked` 时 disabled, `.click()` 无效果 | 键盘段路由改到 open-01 (认证 2 步), 打首步后一手未结束, u/h 按到的是活按钮; spark-11 段前 `store.unlock(11)` 是场景铺垫(只升不降), 点击本身仍是真实点击 | `@pointer` rows: 23 fail: [] (`the u key undoes`、`the h key asks for a hint` 原样保留) |
| 台架环境坑 (DESIGN §9.3 已记, 此处复述) | 兄弟仓/残留 headless Chrome 抢 9347 端口会伪装成"游戏坏了"; 固定 sleep 在导航后会产生假故障 | 验收前先 `pgrep -f remote-debugging-port` 清掉 PPID=1 的孤儿 Chrome(本次清掉一个占 9348 的); `verify.sh` 用 `mktemp -d` 独立 profile、`trap cleanup EXIT` 里 `wait` 掉全部后台 PID、`waitShell()` 轮询钩子而非 sleep | 本次 verify 全绿且跑完 `pgrep` 无残留 |

## 验收结论(真实输出)

```
$ npm run check
OK

$ node --test test/
ℹ tests 8  ℹ pass 8  ℹ fail 0
# 8 个 suite 的 harness 行数: 6 + 10 + 8 + 9 + 7 + 5 + 15 + 9 = 69 条断言, 每条 "rows: N fail: 0"

$ bash tools/verify.sh          # EXIT=0
=== node suites ===  (8 个文件全 fail: 0)
boot hand: spark-01
=== @boot ===      rows: 12 fail: []
=== @play ===      rows: 15 fail: []
=== @routes ===    rows: 13 fail: []
=== @save ===      rows: 15 fail: []
=== @pointer ===   rows: 23 fail: []
=== console ===    (none)
=== ALL GREEN ===
```

浏览器层合计 78 条断言 (12+15+13+15+23), 失败 0; node 层 69 条, 失败 0. `@pointer` 的输入全部经 CDP `Input.dispatchMouseEvent` / `dispatchKeyEvent` 真事件, 坐标取自 `window.point24.numberPoint()/keyPoint()`.

## 未实现清单

- `electron/main.cjs` 存在但本验收未启动它 (无头环境不跑 Electron); 验收全部走 `server.cjs` 的浏览器路径.
- `.github/workflows/ci.yml`、`pages.yml` 已在 GitHub Actions 实跑：发布后 trigger sha `b02dba1` 结论
  `success`（主代理 2026-09-27 复核）。
- 线上部署已实测，数据见下面的「线上验收」章节。
- 无乘方/开方/阶乘/拼接/小数点、无限时模式 —— 见 DESIGN §10, 属于明确不做.

## 线上验收（GitHub Pages，主代理 2026-09-27 实抓）

发布 sha `66d684c`，CI trigger `b02dba1` → Actions `success`。

| 资源 | 结果 |
| --- | --- |
| `/`（index.html） | 200 / 3,341 B |
| `js/main.js` | 200 / 14,690 B |
| `css/game.css` | 200 / 5,427 B |
| `js/data/lots.js` | 200 / 13,534 B |
| `<title>` | `二十四点 · POINT 24`，与 README 标题一致 |

真实浏览器渲染（`https://z-biz-game.github.io/z-biz-game-point24-cos/`，2026-09-27 09:50Z）：

- canvas 后备缓冲 `1384x800`，CSS 盒 `692x400`（devicePixelRatio 2 生效，不是未布局的 300x150）；
- `getImageData` 全量采样 1,107,200 个像素，其中 **1,106,800 个非近黑**（99.96%），出现 **1,055 种不同 RGB**
  —— 牌面与按键铺满了整块画布，不是一张贴图或空白；
- `window.point24` 暴露 **14 个键**（`version state pool load hand numberPoint keyPoint clearPicks …`），
  即验收脚本驱动的那套入口在线上真实存在；
- 控制台 **0 条消息**（无 error / warning；`index.html:8` 的 `<link rel="icon" href="data:,">` 使浏览器
  不发 favicon 请求，所以这条断言没被 404 噪音污染）。

这一节是"结构 + 像素统计"级证据（在真实页面里跑 `evaluate_script` 取 `getImageData`），**不是**逐帧视觉
截图比对；本次未产出 PNG，仓库保持 0 个二进制资产。

值得单列的一条线上修复：`@pointer` 那 17 条断言在发布前全红，根因是 `js/view.js` 的 `measure()` 只按宽度
给牌列定尺寸（1.32×tileW）、运算符列固定 0.55×tileH 贴底，两列盒子在 864x400 画布上重叠，而 `hit()`
先判牌列 —— 于是每一次运算符点击都被吃成一次选牌。改为按高度预算共同分配 tileH/keyH 后，两列不再可能重叠。
CDP 事件日志证实 pointerdown 一直有送达：错的不是输入，是命中区。
