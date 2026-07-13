# RINGGITME 2.0 — PRODUCTION SHELL PHASE 1 REPORT

日期：13/07/2026
类型：实现 + 验证报告（fixture-only，无真实数据接入）
范围：Phase B/C/D-early 壳 + 经批准的资产系统（资产页 / 储蓄卡页面 / 信用卡页面 / 账户详情）+ 全页打磨

---

## 1–4. 环境与初始状态（继续任务，未新建任何东西）

| 项 | 值 |
|---|---|
| Worktree（已存在，未新建） | `/Users/winnertang/Projects/ringgitme-2.0` |
| 分支（已存在，未新建） | `wip/ringgitme-2.0-core` |
| 基线 commit | `135f514b6345b8ca9a4aaa968f4649a06c6a2e1f`（蓝图 commit，HEAD 未动） |
| 蓝图 | `work/reports/RINGGITME_MASTER_REDESIGN_BLUEPRINT_20260712.md` |
| 初始检查 | `git status` 仅含未跟踪 `app-2.0/` 与截图目录；Vite dev server 已在 5173 存活并复用 |
| 视觉基准 | 用户提供的 4 张最终批准截图（资产页 / 储蓄卡页 / 信用卡页 / 账户详情） |

已完成的 Phase 1 实现（App 壳、五区导航、Today、Capture、Activity、Ledger、明暗模式、design tokens）全部保留，只做定向修改；没有重建、没有覆盖、没有丢弃任何可用交互。

## 5. 本次修改/新增的文件

新增：
- `src/components/CardCarousel.js` — 共享卡片轮播（居中选中卡 + 两侧露边 + 拖动/点选 + 页点）
- `src/components/StackedDeck.js` — 资产页竖向层叠卡组（每层可读：身份/名称/尾号/金额/chevron）
- `src/features/assets/category.js` — 储蓄卡页面 / 信用卡页面 / eWallet 页面（同一参数化实现）
- `src/features/assets/detail.js` — 账户详情（同类别轮播 + 字段区 + 最近记录）
- `src/styles/assets.css` — 资产系统样式（从 views.css 拆出，守住 500 行门槛）

重写/修改：
- `src/fixtures/demoData.js` — 4 储蓄（Maybank 储蓄卡/CIMB OctoSavers/Public Bank Savings/RHB Smart Account）、3 信用卡（+RHB Cashback Card）、4 eWallet（Boost/Touch 'n Go/GrabPay/BigPay）、投资、定存、本月流入流出、最近结算；本地日期修复（不再用 `toISOString` 造成的 UTC 偏移）
- `src/features/assets/index.js` — 经批准的资产总览页（净资产汇总 → 总览/资产/负债 → 储蓄卡层叠组 → 信用卡层叠组 → eWallet 横滑 → 投资 → 定存）
- `src/app/state.js` / `router.js` / `shell.js` — 资产子路由（overview→category→detail）、topbar 返回/标题/隐私眼/三点菜单、tab 重按回到区根视图
- `src/features/today/index.js` — pinned 项不再重复出现在雷达首行；已付打勾改为确认 sheet（非即时不可逆）
- `src/components/CaptureSheet.js` — 全称账户名（不再有 MBB 缩写）、移除演示字样、sticky 保存条
- `src/features/activity/index.js` — 月份导航改为 ‹ 居中月份 ›（由数据推导，可扩展），修复搜索后列表重渲
- `src/features/ledger/index.js` — 「对象」→「个人」、移除开发者文案、新增「最近结算」（个人）与「等待处理」（群组）
- `src/components/GlassTabBar.js` — 今天/资产/捕捉/动态/账本；中央按钮 46px 浮起 + 标签
- tokens/base/components/views/sheets/responsive CSS — hero 44→40px、tab bar 62→54px、行 caption 省略号、横滑区边缘渐隐、移除桌面圆角假手机框、键盘 52→46px
- `index.html` — 样式表接线 + data-URI favicon（消除 404）

## 6. 架构（保持并延续）

原生 ES modules、无框架；单一委托点击监听（`data-action`，0 个内联 handler）；`state.js` 单一 UI 状态 + action registry；所有数据经 `createDemoDataSource()` 接口（§25 fixture 边界）；共享组件（CardCarousel/StackedDeck/ActivityRow/AppSheet/Icons）+ 每区 feature 模块；样式全部 token 化，玻璃只在 chrome/sheet/分段控件白名单。

## 7–12. 经批准的资产页（截图 1 对照）

- 顶部：资产标题 + 隐私眼 + 头像；净资产主数字（Ringgit Jade 主强调）、总资产深色、总负债红色
- 分段：总览（全部）/ 资产（储蓄+eWallet+投资+定存）/ 负债（信用卡）——默认总览 ✔
- **储蓄卡层叠组**：图标+储蓄卡(4)+总额+chevron 头部；4 层竖向重叠卡，每层品牌色横幅完整可读（身份 chip、名称、•••• 尾号、余额、chevron）；首卡最强（更高 + 独立阴影）；头部→储蓄卡页面、卡→账户详情 ✔
- **信用卡层叠组**：独立区块、深色 premium 层叠（黑/深绿/深蓝）、−RM 欠款、同样的导航语义；绝不混入储蓄/钱包 ✔
- **eWallet**：头部 eWallet + 总余额 + 查看全部；固定宽 104px tiles、3 个完整可见 + 第 4 个（BigPay）右缘露出、scroll-snap、边缘渐隐；4+ 钱包不缩小、不消失，横滑展示 ✔（tile 点击 → 账户详情占位路由）
- **投资**：总市值 RM 28,540.30、组合 (3)、1 日收益 +RM 128.50 (+0.45%)、月收益 +RM 986.23 (+3.58%)、SVG sparkline、查看全部占位 sheet ✔（首屏之下，符合「不压缩进一屏」）
- **定存**：总本金 RM 17,500、定期存款 (2)、下次到期 18/08/2026（还有 36 天）、到期本息 RM 8,850.36、查看全部占位 sheet ✔

## 13. 储蓄卡页面（截图 2 对照）

返回 + 储蓄卡 + 隐私眼 + 头像 + 三点；储蓄卡总额大数字（主强调）、账户数量 4、本月流入 +RM 4,150.00（绿）、本月流出 −RM 2,318.40（红）；同类轮播（选中卡居中、两侧露边、拖动换卡、页点更新、上下文跟随选中卡）；最近记录 3 行 + 查看全部；全部账户 (4) 紧凑行 → 账户详情。无卡片/列表切换开关（按批准稿移除）。真实 Maybank 卡面 PNG + 克制品牌回退面；只显示 •••• 尾号，无 CVV、无完整卡号。

## 14. 信用卡页面（截图 3 对照）

信用卡总欠款 RM 5,258.25（红）、卡片数量 3、本月应还 RM 2,145.00（红）、总可用额度 RM 20,741.75；3 张卡轮播（Visa Platinum 艺术面居中，Ikhwan/RHB 两侧露边）；卡下摘要条：本月应还（选中卡 RM 1,250.00 = 850 + 400 分期）/ 下个到期日 26/07/2026 / 共享额度池 RM 20,000.00；最近消费 3 行；全部信用卡 (3) 行 → 账户详情。纯视觉/内存，无还款逻辑。

## 15. 账户详情（截图 4 对照）

返回 + 账户详情 + 三点；同类别轮播（储蓄详情只在储蓄间滑、信用卡只在信用卡间滑，绝不跨类型）、页点与下方数据/最近记录随选中账户联动；储蓄字段：余额/账户类型/银行/最近变动/备注；信用卡字段：当前欠额/可用额度/信用额度/本月应还/还款日/本月已还/共享额度池/分期摘要 + 最近消费 + 查看全部。结构为后续筛选/更多功能预留，未过度构建。

## 16–19. Today / Capture / Activity / Ledger 打磨

- **Today**：pinned（车贷 逾期 3 天）不再重复出现在雷达首行；雷达显示其余 3 项；打勾走确认 sheet（确认已付/取消，双向可恢复）+ toast；hero 40px；指标带边缘渐隐；「我的固定」定名；完整钱况集 10 项全保留
- **Capture**：sheet 可滚动、保存条 sticky 于底部安全区上方；More 展开内容完整可用；键盘 46px；chips 横滑 + 渐隐；全称账户名（Maybank 储蓄 / CIMB Octo / Public Bank / RHB S… / Touch 'n Go）；保存 → 内存 Activity 插入 + 成功动效 + toast「已记一笔 RM 26.00 · 餐饮」（实测）
- **Activity**：按日分组、搜索（实测 KFC→2 行）、筛选（收据→3 行）、月导航 ‹ 2026 年 7 月 ›（上月实测切至 6 月 53 行，尽头禁用）、右对齐 tabular 金额、回形针指示、编辑历史示例、底部 padding 足够
- **Ledger**：个人/群组分段（已更名）；AA 汇总；人行/群组行；人详情 当前未结/历史；历史 30 条 →「加载更多」+30（实测 30→60）→ 切换视图分页重置（实测回 30）；部分还款条（已收 RM 150.00 / RM 400.00 进度条）；收到款 sheet：4 储蓄 + 4 eWallet 入账 + 现金「只记录，不动余额」，确认后未结项离开视图、净额清零（实测 Abi → 已结清）；新增「最近结算」「等待处理」区；开发者文案全部移除

## 20. 暗色模式

Today/资产总览/储蓄卡页/信用卡页/账户详情/Capture/Activity/Ledger/个人资料 sheet/层叠卡组/钱包横滑/投资/定存/底部导航/分段控件/列表行均逐屏核对：实心财务表面、语义红绿可读、卡面细节清晰、玻璃 chrome 克制；非简单反色（暗色有独立 token：玻璃不透明度 +8–10%、高光减半、语义色提亮）。见截图 02/15。

## 21. 交互验证（浏览器实测记录）

| 流 | 结果 |
|---|---|
| 四 tab + 中央捕捉 | ✅ |
| 资产页竖滑 / 总览·资产·负债分段 | ✅ |
| 储蓄/信用层叠卡点击 → 账户详情 | ✅（点击 RHB Smart Account 实测） |
| eWallet 4+ 横滑、第 4 个露边不缩小 | ✅（BigPay 露边） |
| 投资 / 定存占位导航 | ✅（占位 sheet） |
| 储蓄卡页轮播滑动 + 页点 + 上下文联动 | ✅（滑至 CIMB，最近记录变为 CIMB 行） |
| 信用卡页摘要条 / 最近消费 / 全部卡行 | ✅ |
| 账户详情同类滑动 + 数据联动 + 返回 | ✅ |
| Capture 开/关/More/滚动/键盘/保存/入流 | ✅（键入 26 → 保存 → 动态顶部新行 + toast） |
| Activity 搜索/筛选/月导航/详情 | ✅ |
| Ledger 个人/群组/人行/历史/加载更多/分页重置/收到款 | ✅（30→60→重置 30；Abi 结清） |
| Profile sheet + 浅/深/自动 | ✅（`data-theme` 实测切换） |

说明：浏览器面板的合成拖拽不产生 pointermove 序列，轮播拖拽用合成 PointerEvent 序列验证通过（真实触屏/鼠标产生原生 pointer 事件，路径一致）。

## 22–23. 静态 / 构建 / 控制台 / 溢出

- `node --check` 全部 JS 通过；`vite build` 通过（34 模块，JS 66.6 kB / gzip 20.6 kB，CSS 27.8 kB / gzip 6.0 kB）
- 控制台错误 0（favicon 404 已用 data-URI 图标消除后复验干净）；无未处理 promise 错误
- 390px 横向溢出检查：today / assets-overview / saving-category / detail / activity / ledger 全部 `scrollWidth == 390` ✅；内容不被底部导航遮挡（底部 padding 96px > 导航 74px 占位）
- 内联 handler 0；无 localStorage/网络/supabase 引用；所有源文件 ≤ 449 行

## 24. 截图（15 张，`work/reports/ringgitme-2.0-shell-screenshots/`）

01-today-light / 02-today-dark / 03-assets-top-light / 04-assets-lower-light / 05-savings-page-light / 06-creditcard-page-light / 07-savings-detail-light / 08-creditcard-detail-light / 09-capture-collapsed-light / 10-capture-more-light / 11-activity-light / 12-ledger-people-light / 13-ledger-groups-light / 14-profile-sheet-light / 15-assets-dark

全部经 CDP `Emulation.setDeviceMetricsOverride` 以真机口径 390×844 @2x（mobile: true）截取——非 480px 桌面假框。旧版（重设计前）截图已删除。

## 25. Fixture 边界

UI 只经 `createDemoDataSource()` 读写；本任务未接入 rm_v3 / legacy localStorage / Supabase / 邀请 RPC / AA 生产数据 / Telegram Worker / SQL / 生产认证 / 推送 / Widget / Share Extension / Live Activity。保存与结算均为内存内演示状态。Phase 2 适配器以同接口替换 fixtures。

## 26–27. 保护面证据

- 本 worktree：`git status` 仅 `?? app-2.0/` 与 `?? work/reports/ringgitme-2.0-shell-screenshots/`；`git diff HEAD -- index.html supabase/ ios/` 为空 → 遗留 index.html、supabase/、ios/、24D 源全部未动
- 遗留仓库 `/Users/winnertang/Projects/ringgitme`：HEAD 仍为 `1e41f51`，无修改（仅存在 Codex 的既有未跟踪 D3C 报告，非本任务产物）
- D3C harness：PID 69344 存活（uptime 9h+），`http://127.0.0.1:8788/` 返回 200，未触碰；未动任何 Simulator
- 未 commit、未 push、未部署、未用 `git add .`

## 28. 剩余 Phase 2+ 工作

rm_v3 / finance-domain 适配器替换 fixtures（冻结函数集绑定）；Supabase 同步与认证；AA/邀请/结算真实链路（domain/invitations 原样搬运）；Telegram 契约；投资/定存真实详情页；钱包详情页完整化；三点菜单动作；i18n 字典化；Capacitor 壳接入与真机安全区验证；虚拟列表与满数据性能；§26 QA 矩阵自动断言迁移。

## 29–31. 预览

- 命令（如进程丢失时重启）：`cd /Users/winnertang/Projects/ringgitme-2.0/app-2.0 && npm run dev -- --host 127.0.0.1 --port 5173`
- URL：`http://localhost:5173`（等价 `http://127.0.0.1:5173`）
- 当前进程：node PID **71751**，端口 **5173**（strictPort，绝不漂移到 8788）；8788 归 D3C harness（PID 69344），未触碰

## 32. 最终交互修正（FINAL CAROUSEL INTERACTION CORRECTION，13/07/2026）

两套轮播契约按批准稿分离，互不混用：

- **类别页（储蓄卡/信用卡）视觉保持原批准样式**：邻卡两侧明显露出、内容可见；未套用详情页的「窄边露出」处理。
- **类别页居中卡点击 → 打开该卡账户详情**：只有居中选中卡触发；`aria-label="查看 X 账户详情"`（侧卡为「选择 X」）；可见 focus 态；Enter/Space 键盘激活（轮播显式 keydown 处理 + `preventDefault` 防双触发，经 CDP 受信任键事件实测：focus 居中卡 → Enter → 账户详情打开，余额 RM 6,842.15）。
- **下方 全部账户 / 全部信用卡 行同样直达详情**（两个入口并存，实测 Public Bank / RHB Cashback 行直开对应详情）。
- **拖拽不再误触导航**：pointer 位移超过 10 CSS px 判定为拖拽，拖拽后的 click 被捕获阶段吞掉；实测「拖拽换卡 + 尾随 click」停留在类别页且选中卡与上下文正确切换（信用卡页摘要条随 Ikhwan 更新为 RM 575.00），随后真点击才进入详情。
- **进入详情保留身份**：从类别页/行进入时 `categoryIndex` 同步，详情居中即所选卡；返回后类别页保持先前选中（实测 CIMB 往返保持）。
- **账户详情滑动直接切换完整详情，无需二次点击**：单一事实源 `ui.assetsView.accountId`；滑动落定即更新 页点/字段面板/金额/银行/欠额/可用额度/信用额度/本月应还/还款日/共享额度池/分期/最近记录（储蓄实测 Public Bank→RHB→Public Bank 全字段联动；信用卡实测 RHB→Ikhwan 七字段 + iPhone 16 分期 + 最近消费全部即时更新）；详情内点击居中卡不再打开嵌套页；同类隔离（详情轮播仅含同类账户实测）；不产生浏览器历史条目（全程无 history API 写入）。
- **详情侧露修正仅作用于账户详情**：`detail` 变体（步距 25%、缩放 0.89）+ 邻卡 overlay/徽标/回退面文字透明化——邻卡呈干净卡边（艺术面/品牌色可见，非空色条），文字金额绝不侵入居中卡；类别页完全不受影响。
- **Profile / 文案清理**：移除「设置、报税、备份与 Telegram 即将推出。」及全部路线图式文案；剩余占位动作统一为产品语「此功能暂未开放」（蓝图 §14.24 认可文案）；全源码 grep 无 即将推出/后续阶段/演示 残留。
- **底部导航可达性复核**：资产总览/储蓄卡页/信用卡页/两种详情/动态 滚到底后最后一行 bottom ≤ 728px < 导航顶 780px，全部完整可读，无遮挡；390px 全路由无横向溢出。
- **复检结果**：`vite build` 通过（66.85 kB JS / gzip 20.75 kB）；CDP 全路由扫描 console 错误 0；截图 05/06/07/08/14 已按 390×844@2x 真机口径重制（类别页保持原批准外观，详情页为修正后侧露样式）。

## 33. 最终裁定

**RINGGITME 2.0 PRODUCTION SHELL PHASE 1 READY FOR USER VISUAL REVIEW**
