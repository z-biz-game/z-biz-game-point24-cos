# 二十四点 · POINT 24

四张牌, 加减乘除, 凑出 24. 区别在于: 这一版里"这手牌能不能解""最少用几张""本质不同的最简算式
有几条"三个数字, 全部由**有理数域上的穷举枚举**算出来 —— 所有二叉树形状, 所有运算符, 所有
左右顺序, 中间值一律是既约分数 `{n, d}`, 没有一处浮点数.

完整空间是 1..13 的四张牌多重集, 共 **1820** 副. 全部跑完, 可解的是 **1362/1820 = 74.8%** ——
这个数字不是文档里的一句话, 它是 `test/anchor.test.mjs` 里一条真的把 1820 副枚举一遍的断言.

## 跑起来

```bash
npm run check      # 逐个文件 node --check, 零依赖
npm run unit       # 8 个 node 测试套件
npm start          # node server.cjs, 默认 5199
npm run bake       # 重新量一遍题库 (约 5s), 写 js/data/lots.js
npm run verify     # node 套件 + 一次 headless Chrome 的 CDP 实机点击
```

依赖数 0, 素材 0, 网络请求 0.

## 这一版的数字从哪来

`node tools/bake.mjs` 的第一遍是**对整个 1820 副做穷举**, 输出实测:

```
census over 1820 deals in 4.7s
  可解(全四张) 1362/1820 = 74.8%  <- 公开锚点 1362/1820
  整数中间值可解 1346/1820;其中只有分数才可解 16 副
  最少张数分布 {"2":433,"3":779,"4":352,"unsolvable":256}
  难度带 rejected:458 solo:352 narrow:433 spark:359 open:218
  单副穷举耗时 中位 2ms · 最大 19ms
```

四条难度带是按**量出来的** `(cards, exprs)` 定义的, 不是拍脑袋的星级:

| 带 | 判据 | 全空间里有多少副 | 池子里 | 独解比例 |
| --- | --- | --- | --- | --- |
| `spark` 火花 | `cards <= 2` | 359 | 12 | 11/12 |
| `open` 开阔 | `cards == 3 && exprs >= 3` | 218 | 12 | 0/12 |
| `narrow` 窄门 | `cards == 3 && exprs <= 2` | 433 | 12 | 9/12 |
| `solo` 独解 | `cards == 4` | 352 | 12 | 3/12 |

如实记录两件事: 一是 `open` 带只占完整空间的 **218/1820 = 12.0%** —— 随机发一副牌落进"开阔"
的概率本来就低到两成以下, 所以那一档的搜索要多试几副 (实测 13 次取满 12 副, 拒绝原因里
`otherBand:73 / unsolvable:13 / partialOnly:13 / duplicate:1`). 二是**接受率不等于命中率**:
1362/1820 是"全四张可解"的比例, 池子里每一副都还额外要求全四张可解, 所以池子的接受率是 100%,
而随机一副牌能进池的概率是 74.8%.

## 已烘焙的池子

浏览器**不做**穷举. `js/data/lots.js` 是 48 副牌连同它们的 `(cards, steps, exprs, sample, plan,
intSolvable, fraction)` 一起烤出来的结果; `js/core/library.js` 只做查表. `test/library.test.mjs`
会把这 48 副**重新解一遍**, 七个字段任何一个漂了就红.

每副牌还带一个 `plan`: 长度正好 `cards - 1` 的点击序列 `{i, j, op}`, 位置是**当前牌桌上**的槽位号,
左操作数永远是 `i`. 这是"认证解法" —— 测试和 playtest 都照着它点.

## 负例: 只允许整数中间值的弱求解器

`js/core/intonly.js` 是一个**故意更弱**的独立求解器: 同样的全形状枚举, 但每一步的中间值必须是
整数, 除法只允许整除. 它不 import `frac.js`, 也不共享搜索代码.

它存在的意义是**证伪**而不是自夸:

```
3,3,7,7   整数中间值: 无解      有理数: (3+3/7)*7 = 24
1,5,5,5   整数中间值: 无解      有理数: (5-1/5)*5  = 24
```

这两行是 `test/intonly.test.mjs` 的断言. 顺手还有一组**人工可复核**的普查: 只从 {1,3,5,7} 四张
点数里发的 35 副牌 (`C(4+4-1,4) = 35`), 有理数可解 20 副, 整数可解 18 副, 差的那 2 副正好就是
`1,5,5,5` 和 `3,3,7,7`.

语义要说清楚: `solvable` 判的是**全四张**能不能凑出 24 (锚点就是这个口径), 而 `cards` 判的是
**最少用几张**. 所以 `3,3,7,7` 在两个求解器里 `cards` 都是 3 (`3*7+3`), 但只有有理数求解器认为
全四张可解. `measure()` 把 `intCards`/`intSolvable`/`fraction` 三个字段并排放着, 就是为了不让这两
件事在文档里被混为一谈.

## 验收

```bash
bash tools/verify.sh                  # node 套件 + 浏览器五段, 末尾 === ALL GREEN ===
SKIP_UNIT=1 bash tools/verify.sh      # 只跑浏览器 (CI 的 browser job)
SCENARIOS="pointer" bash tools/verify.sh
```

浏览器层是真鼠标: CDP `Input.dispatchMouseEvent` 按 `plan` 的坐标点数字、点运算符, 断言
"每三击恰好一步" "先点运算符/点同一个数两次/除以零都不计数" "分数那一格真的是 7/8".

## 文件地图

```
index.html            一个 canvas + 右侧读数/按钮/进度架; <link rel="icon" href="data:,">
css/game.css          布局与配色, 无框架
js/core/frac.js       既约分数 {n,d}: 六个二元动作 (含两个非交换方向), 除零 -> null
js/core/solve.js      穷举: 可达值集 + 最少张数 + 最少步数 + 本质不同算式条数, 全部记忆化 + 硬预算
js/core/intonly.js    负例: 只允许整数中间值的弱求解器
js/core/make.js       1820 副的索引空间 dealAt/dealIndex, 难度带判据, makeLot 搜索
js/core/library.js    烘焙池的查表层 (浏览器只用这个)
js/core/game.js       一次点击的规则: 选两个数 + 一个运算符, 拒绝计数, 实时可达性
js/core/rng.js        FNV-1a + mulberry32 (与标杆仓逐字一致)
js/core/storage.js    单键 localStorage, 三层保护: 无 window / 被拒 / 存档损坏
js/data/lots.js       构建期产物: 48 副牌的测量结果
js/view.js            像素: 四张牌、分数格、运算符键、算式流水
js/main.js            路由 #/ #/lot/<id> #/daily #/random/<band>/<token>, 挂钩 window.point24
tools/bake.mjs        两遍烤池: 全空间普查 -> 逐带取样 -> 逐手复解 -> 写文件
tools/playtest.mjs    CDP 驱动 + 五段页内断言 @boot @play @routes @save @pointer
tools/verify.sh       一次性验收, 自己起的 Chrome 自己收
test/*.test.mjs       8 个套件, 64 条断言
```

## 规则

- 四张牌, 每次选**两个数**再选**一个运算符**, 两数被结果替换.
- 允许: `+ - * /`, 中间值可以是任意既约分数.
- 不允许: 乘方、开方、阶乘、数字拼接、小数点. 加任何一条, 1362/1820 这个锚点就作废.
- 目标 24. 每手的 `张数 / 步数 / 算式条数` 由穷举给出, 不是难度标签.

## 已知边界

- 分数中间值**必须**支持, 否则 `3,3,7,7` 会被误判无解 —— 弱求解器就是专门留着演示这一点的.
- 实时提示 `survey()` 在 4 个数上跑, 实测中位 2ms/最大 19ms, 并且有 `limit` 硬预算; 超预算时
  返回 `live = null` 并显示"搜索预算耗尽", 不会假装"无解".
- 存档的 id 只在"同一次 bake"内稳定: 重新烤池子等于换一批题 (`test/library.test.mjs` 会立刻发现).
- 没有计时、连击、签到、排行榜、内购 —— 这个项目只有牌桌.

## License

MIT, 见 `LICENSE`.

## 上线的到底是哪一批文件

这个仓没有打包器：站点=一次文件拷贝。以前「拷哪些」写在 `pages.yml` 的 `run:` 里（手抄的几行
`cp`）。本地 `index.html` 直读仓库根，永远自洽；线上却按那份清单拷，于是页面后来引用的
`manifest.webmanifest`、`sw.js`、`icons/*` 可能一个都没上去——线上 404，而仓里的引擎测试与
真浏览器闸全绿，因为它们跑的都是仓库根，没有任何一步在「按清单拷」的那个环境下加载过页面。

现在清单只有一份，住在 `tools/assemble-site.sh`：CI 调它拷 `_site`，本地闸调它拷临时目录，
然后**对拷出来的产物**提要求（`tools/deploy-set.mjs`）：

- **W 清单与页面同源**：`pages.yml` 里必须真有 `run: bash tools/assemble-site.sh <dir>` 这一行，
  `ci.yml` 里必须真有 `run: node tools/deploy-set.mjs`。认的是调用那一行，不是文件里出现过这个
  路径——注释里本来就会写它，只 grep 字符串会被一句散文喂绿。
- **R 引用可达**：引用不靠手打名单。从 `index.html` 的 `href/src` 出发，凡解析出来是 `.js`/`.css`
  的就把那一站也扫一遍（CSS 的 `url()`、JS 去掉注释后的 `'./…'` 字面量、`new URL(x, base)` 的两种
  基、`navigator.serviceWorker.register`、`scope`），`manifest` 的 icons/screenshots/shortcuts 各自
  的 `src` 也算引用。取径上读不到的那一站本身就是红（读不到＝这一站根本没扫）。每条引用都必须在
  产物里且非 0 字节；绝对路径单列一条红，因为 Pages 挂在 `/<repo>/` 前缀下会跳出去。
- **P 位图不许说谎**：`manifest` 声明的 `sizes` 必须等于 PNG IHDR 的真实宽高——文件图标读文件头，
  内联成 base64 的图标先解码再读同一段。后一条不是可选项：图标可能住在清单里而不是盘上的 `.png`
  （有的仓另有一条"零二进制文件"的承诺，那条只约束"有没有 .png 这个文件"）；如果 P 段只筛文件名，
  声明写 512 而真图 192 就一路放行。
- **钉住两个数**：R 段实际检查的路径条数（`24`）与这一次跑的断言条数（`42`），两个数
  都钉在 `tools/deploy-set.mjs` 顶部的那对常量里。没改页面却掉了，说明解析断了；删掉一张图标会同时
  少一条 R10 与那张的 P1/P2，所以两个数一起钉，断言条数能漂就是闸在缩水的信号。这一节故意只写数值、
  不写那对常量的名字，也不写别仓文档闸的编号：有的仓的文档闸会拿"文档里出现过的同名标识号"回数它
  自己的条数，还有的会把文档里点到的每个组编号逐个核对"这一轮真的发过"——两道闸共用一个名字，
  或者在本仓的文档里出现一个本仓没有的组编号，打红的都是不相干的那一边。

`tools/deploy-set-selftest.mjs` 是这两颗钉的阳性证明：它把仓库复制到临时目录，照着每一类断言
各下一刀（X1 清单不收位图目录 / X2 模块边改名 / X3 CSS 写绝对路径 / X4 `start_url` 绝对 /
X5 删光 >=512 图标 / X6 少一个必填字段 / X7 声明尺寸与真图不符 / X8 workflow 不调脚本 /
X9 CI 不跑闸 / X10 是阴性对照——往入口 JS 追加一行只写在注释里的假路径，闸必须仍然绿、条数仍然
`24`、断言仍然 `42`；X11 og:image 退回相对路径 / X12 og:image 的前缀指向别的 slug /
X13 内联位图谎报尺寸——只在有靶子时下：X11/X12 要页面上那句 og:image，X13 要清单里真有一段 base64
图标，没有就打印 SKIP；反过来 X1 没有位图目录可砍时改砍 css，P 段一位都不核时台架直接报靶子不够），
要求每一刀都让闸**点名**变红。靶子从 `DEPLOY_SET_DUMP=1`
的出处表现挑（取径真的会读的那支 JS / 那一张 CSS，不写死某一个仓的入口名），所以页面改了、仓与仓
不同，台架跟着走。

`node tools/deploy-set.mjs` 与 `node tools/deploy-set-selftest.mjs` 就是 CI 跑的那两条命令本身
（package.json 里的 `deploy-set` / `deploy-set:selftest` 只是同一支脚本的 npm 入口）；本仓的整闸在 `tools/verify.sh` 的 `=== deploy-set ===` 那一段也各跑一次。它们红的时候并进本仓那条出口的退出码——这一条是这么证的：
把 ci.yml 里那行 `run: node tools/deploy-set.mjs` 砍掉，本仓整闸必须点名红且退出码非 0。
所以「本地全绿、线上 404 自己的 manifest / sw.js / 图标」这一类坏法在本地就会红。

## 在线试玩

<https://z-biz-game.github.io/z-biz-game-point24-cos/>（`main` 分支推送即自动部署）
