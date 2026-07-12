# RINGGITME 2.0 — MONEY & LIFE OS
# 完整重新设计总蓝图（MASTER REDESIGN BLUEPRINT）

日期：12/07/2026
类型：BLUEPRINT ONLY（纯蓝图，无任何实现改动）
作者：Claude（Claude Code 隔离 worktree 会话）

---

## 1. Executive Verdict（总裁决）

RinggitMe 是一个**财务逻辑成熟、但外壳已到极限**的产品。

经过对 `index.html`（12,424 行、约 2,097 个唯一函数名）、`supabase/migrations/24d/`（13 张共享表 + 完整邀请生命周期 RPC）、Capacitor iOS 壳、以及 4 份 iOS 阶段报告的全量只读审计，结论是：

1. **财务内核值得完整保留。** 信用卡周期（`ensureCardCycle`、`getCardAutoDueDate`）、共享额度、分期（`ccInstallments`）、recordOnly 记账模式（`getTransactionPostingMode` / `isRecordOnlyTransaction`）、余额正反向效应（`applyTransactionBalanceEffect` / `reverseTransactionBalanceEffect`）、AA 应收（`aaReceivables`）、对象账本（`personLedgerItems`）、群组分账（`groupSplitItems` / `groupSplitLines`）、编辑历史（`normalizeEditHistoryItem19_1B`）都是经过多轮修复和自带回归测试（`__ringgitmeTest*` 系列）打磨出来的真实业务逻辑。
2. **UI 架构已经不可持续。** 全应用是一个单文件，采用「每个 Phase 追加一个 IIFE、包裹并覆盖上一代 `window.*` 函数、再用正则对上一代渲染出来的 HTML 字符串做手术」的层叠模式（证据见 §5）。钱包卡组渲染器存在至少 8 个世代（`renderWalletDeck18_8B` 到 `renderCardsClosedStack18_8J`）同时留在文件里。第 20–462 行整块代码位于 `<script src=".../supabase-js@2">` 标签内部——按 HTML 规范带 `src` 的 script 内联内容不会执行，即约 440 行是死代码（多数在后文有活副本）。
3. **重设计必须是「换骨架、保内脏」。** 2.0 的正确路径不是重写财务逻辑，而是：先冻结数据契约（`rm_v3` 状态结构、Supabase 表/RPC、邀请安全边界），再把 UI 从层叠补丁模式迁移到一套全新的五区信息架构 + Apple Liquid Glass 材质系统 + 宽视角移动密度，分小阶段推进，每阶段后 App 都可用。
4. **Phase 24D 尚未收尾**，本蓝图基线（commit `1e41f51`）不能直接作为 2.0 实现基线；实现前必须执行 §23 的 FINAL PHASE 24D DELTA INTAKE GATE。

**十大蓝图决策**（详情见对应章节）：

| # | 决策 | 章节 |
|---|------|------|
| 1 | 五区导航：今日 Today / 资产 Assets / ＋捕捉 Capture / 动态 Activity / 账本 Ledger；工具与设置移入头像入口 | §9–10 |
| 2 | 数据契约冻结先行：`rm_v3` 全部键、`ledgers` 整包云同步、24D 邀请 RPC 列为「不可变或仅可包装」 | §20 |
| 3 | Liquid Glass 只用于系统层（导航、Tab bar、Sheet、覆盖层），财务内容留在实心可读表面 | §8/§11 |
| 4 | Ringgit Deck 以现有 `D.cards`（type: cc/saving/ew）为唯一数据源，新增堆叠视图但保留全部信用卡逻辑 | §14.3 |
| 5 | Money Pulse 保留用户已确认的完整钱况集：当前现金、My Fixed（自己份额）、Total Card Debt、本月卡+分期应还、还卡后 Cash、AA 待收、收回后 Cash、总负债/净负债/净资产——全部绑定既有函数（`getCashNow/getMyMonthlyFixedTotal18_5B/getTotalCardDebt/getPendingCardDue/getAfterCardPaymentCash/getAAReceivables/getFullPayoffPosition`），层级克制、非等权巨卡 | §14.1 |
| 6 | 模块化采用「先建新壳、逐区搬迁、旧补丁链整链退役」而非逐函数抽取 | §21 |
| 7 | Smart Capture 首屏只有 模式/金额/类别/账户 四要素，其余进 More（现有 spend modal 一屏十一组字段是反面证据） | §17 |
| 8 | 邀请/群组安全逻辑（24DD/24DDB/24DD3 层 + 005 SQL）在 2.0 中原样搬运，禁止在视觉阶段触碰 | §6/§18 |
| 9 | 附件 base64 存在 `rm_v3` 内是最大伸缩性风险，2.0 期间维持现状 + 配额管理，2.1 才迁移存储 | §22/§27 |
| 10 | 实现顺序：Phase 0（24D Delta Intake）→ A（契约验证）→ B（Token/材质）→ C（App Shell）→ D…（逐页） | §24 |

---

## 2. Audit Scope 与精确基线（Exact Baseline）

### 2.1 会话环境记录（只读采集）

- 工作目录 / 仓库根：`/Users/winnertang/Projects/ringgitme/.claude/worktrees/ringgitme-2-0-blueprint-ae9be8`
- 当前分支：`claude/ringgitme-2-0-blueprint-ae9be8`（Claude Code App Worktree 自动创建的分支名；会话配置中提到的 `wip/ringgitme-2.0-master-blueprint` 并非本 worktree 实际分支名，本会话遵守「不切换分支」规则，全程停留在该分支）
- 当前 HEAD：`1e41f51b65c4438ca869671d176114e4ad739ab9`（`Phase 24D-D3C-FIX1 fix invitation sheet layout`）
- 原始 worktree：`/Users/winnertang/Projects/ringgitme`，分支 `wip/phase24d-d3-invite-deep-links`，tip 同为 `1e41f51`
- `git status`：干净（无未提交改动）
- `git worktree list`：仅两个 worktree（原始 + 本会话隔离 worktree），确认隔离成立
- 未接触 `/Users/winnertang/ringgitme-d3c-harness`、端口 8788、Simulator、任何进程

### 2.2 审计范围

已读取/静态分析：

- `index.html`（12,424 行；含 4 个 script 块：20–462［死块，位于带 src 的 script 内］、1015–4622、4624–4805、4808–12421）
- `supabase/migrations/24d/`：001–007、900–905、999、README.md
- `capacitor.config.json`、`package.json`、`manifest.json`、`ios/App/`（含 `Info.plist` 的 `CFBundleURLSchemes`）、`scripts/prepare-capacitor-web.mjs`
- `assets/`（cards 5 张 Maybank PNG；brands/ewallets/merchants 为空；sounds 3 个音效文件）
- `work/reports/` 4 份 iOS 阶段报告（本 worktree 内已跟踪版本）
- `README.md`、`REAL_ASSETS_TODO.md`

### 2.3 关键缺失（诚实记录）

- **`RINGGITME_FULL_AZ_MVP_RECOVERY_AUDIT_20260712.md` 未找到（范围限定声明）**：审计时点，在本会话可访问的路径——当前会话 worktree、原始 worktree 的 `work/reports/`、以及仓库已跟踪文件树——均未找到该文件。本声明不主张它在可访问路径之外全局不存在。本蓝图因此完全基于代码与 SQL 直接证据，未参考该恢复审计；该文件列为 Phase 0 Delta Intake 的证据收集项（§23/§34-1），若届时取得，其结论并入 Phase 0 报告。
- `/Users/winnertang/Projects/ringgitme/work/backups` 目录在审计时点不存在。
- **D3C harness 事件在本蓝图任务范围之外**：Phase 24D-D3C Scratch harness 恢复由 Codex 另行处理，本蓝图未采纳任何未经验证的 harness 结论；其最终验收结果只能经 §23 的 FINAL PHASE 24D DELTA INTAKE GATE 进入 2.0 基线。
- **Telegram Worker 源码不在本仓库**：App 只引用 `https://ringgitme-bot-v2.tangryan00.workers.dev`（见 `telegramFiles15` 中的 `/tg-file?fid=` 代理）。Worker 行为只能从 App 侧调用面推断。
- 旧版（24D 之前的）Supabase SQL（`rm_submit_quick_entry`、`rm_create_telegram_link_code`、`aa_partners`/`aa_settlements`/`person_ledger_items` 等表的建表 SQL）不在仓库中——App 内 toast「先运行 Telegram AA SQL」证明这些 SQL 曾以外部方式执行。这是 §34 的重要未知项。

---

## 3. Current System Inventory（现状系统清单）

### 3.1 运行时结构

- **单文件 App**：全部 HTML/CSS/JS 在 `index.html`。CSS token 在第 467 行 `:root`（浅色 `--bg:#f5f5f7`、深色 `--bg:#000000`、主色 `--accent:#0a8a54`/暗色 `#34d27f`、`--font-display:'Space Grotesk'`），另有 447 处内联 `style="…"`。
- **全局状态**：数据态 `D`（由 `fresh()` 第 1278 行定义、`load()`/`save()` 持久化到 `localStorage['rm_v3']`），UI 态 `U`（tab、modal、各类子 tab/段选择），锁态 `LOCK`（第 1389 行状态机），会话 `SESSION`。
- **渲染管线**：`render()`（第 2365 行）每次把整个 `#app.innerHTML` 重建，含 topbar（5 个图标动作：刷新/报税/隐私/设置/锁定）、`.content`、FAB（`openAddHub20_1`）、`.nav`（6 tab）、`renderIncomingInvitationModal24DDB()`、`buildModal()`。第 2370–2400 行有滚动位置、Sheet 滚动、输入值快照恢复补丁——证明全量重渲的代价已经被反复打补丁。
- **导航**：`TABS`＝home 首页 / cards 卡片 / record 记账 / history 记录 / fixed 固定 / aa 账本（第 2367 行）；settings 是 modal 而非 tab（`getActiveMainTab20_1` 第 2222 行把 modal 当第七 tab 处理）。

### 3.2 数据域（本地）

`fresh()` 初始键：`cards, subs, loans, txns, incomes, aaPeople, aaReceivables, groups, groupMembers, groupSplitItems, groupSplitLines, groupPayments, groupTelegramBindings, groupTombstones24B, favs, goals, resists, taxItems, customTaxCats, recurIncomes, ccInstallments, netSnaps, incomeCats, spendCats, nextId, incomeMode, privacyMode, budget, theme, accent, soundOn, updatedAt`。

运行期由各 Phase `ensure*()` 追加的键（同样持久化在 `rm_v3`）：`aaSettlementReceipts, tgPartnerMap, tgAAReceivableMap, tgAAPendingSettlements, tgSettlementApplied, aaHiddenSettlementIds, personLedgerItems, personLedgers, telegramPartners18_6R, telegramAttachments, telegramBindings, fixedAAInstancingV1, transfers`。

### 3.3 财务域函数（活代码，主块 1506–1560 行区）

现金/账户：`getCashNow, getSavingsTotal, getEwalletTotal`；信用卡：`normalizeCreditCard, ensureCardCycle, resetCardCycleIfCleared, getCardCycleStart, getCardAutoDueDate, getCardDueLabel, getCreditCardOutstanding, getCardUsedLimit, getCardAvailableLimit, getCardTotalDebt, getTotalCardDebt, getCreditCardMonthlyDue, getPendingCardDue, getPendingCreditCardMonthlyDue`；分期：`getInstallments, normalizeInstallment, cardInstallments, activeInstallments, getInstallmentMonthlyTotal, getInstallmentRemainingTotal`；固定：`getMonthlyFixedTotal, getFixedMonthlyTotalIncludingCardPayments`，月度过账 `postFixed`（第 6522 行，经 7155/7484 两层包裹）；记账模式：`getTransactionPostingMode, isRecordOnlyTransaction`；余额效应：`applyTransactionBalanceEffect, reverseTransactionBalanceEffect`；综合：`getFullPayoffPosition, getAfterCardPaymentCash`；AA：`getAAReceivables, calcAAOwed`。

### 3.4 云端与集成

- **整包云同步**：`pushCloud()`（第 1297 行）把整个 `D` upsert 到 `ledgers` 表（`user_id` 主键 + `data` JSON + `updated_at`）；`pullCloud()`、`adoptCloudOrPush()`（第 1300 行）按 `updatedAt` 做 last-write-wins，用 `localStorage['rm_owner']` 防止 A 的数据泄给 B。`SUPA_URL` 与 publishable key 硬编码在第 1285 行（值不在本报告复现）。
- **旧共享层（Telegram AA）**：表 `quick_entries, telegram_bindings, aa_partners, aa_settlements, aa_ledger_items, person_ledger_items, person_ledger_payments, person_ledger_attachments`；RPC `rm_submit_quick_entry, rm_create_shortcut_token, rm_create_telegram_link_code, rm_create_aa_partner_code(_v23d), rm_cancel_aa_partner_invite, rm_disconnect_aa_partner`。Partner Center 入口 `openPartnerCenter23C`（第 10602 行）。
- **24D 新共享层**（已写 SQL、仅 scratch 验证、未部署生产）：13 表 `profiles, identities, telegram_identities, shared_ledgers, shared_ledger_members, invitations, shared_entries, shared_entry_lines, shared_entry_events, shared_settlements, private_postings, shared_media, shared_media_links`；金额一律整数 sen；变更仅经 RPC；`invitations` 只存 `code_hash`。RPC 全集见 §20.3。
- **邀请客户端（24DD/24DDB/24DD3 层，11462–12421 行）**：26 字符 Crockford base32 邀请码（`generateInviteCode24DD`，`crypto.getRandomValues`）、`hashInviteCode24DD`（SHA-256）、web 深链 `?invite=CODE`（`captureWebInvite24DD3`：立即从地址栏清除、未登录暂存 `rm_pending_invite_24dd_v1`、TTL 24h）、原生深链 `ringgitme://invite/CODE`（`parseNativeInviteUrl24DD3` + `appUrlOpen`）、路由目标固定为 tab `aa` / segment `groups` / modal `incoming`，只做 `inspect_invitation` 预览，绝不自动 accept。
- **原生 OAuth（IOS2 层）**：`ringgitme://auth/callback`、`handleNativeOAuthCallbackIOS2`、`initNativeOAuthIOS2`（冷启 `getLaunchUrl` + 热启 `appUrlOpen`）。
- **Capacitor**：`com.winnertang.ringgitme`，webDir `www`（由 `scripts/prepare-capacitor-web.mjs` 生成），插件仅 `@capacitor/app` 与 `@capacitor/browser`（8.x），`Info.plist` 注册 `ringgitme` URL scheme。无 associated domains（无 Universal Links）。
- **PWA**：`manifest.json`（standalone/portrait）但**没有注册 service worker**（代码里只有清理性 `getRegistrations().unregister()`，见第 9185 行 `clearPwaCacheOnly18_7P`），且 `<meta http-equiv="Cache-Control" content="no-store">`——离线能力实际为零。
- **锁与安全**：PIN（`rm_pin_hash`）+ WebAuthn/Face ID（`rm_webauthn_cred`）、启动错误守卫（`showBootError` 第 1029 行、3496 行的启动保护 UI）。
- **报税**：`TAX_CATS`（第 1277 行，22 类马来西亚 relief 含 cap，如 生活方式 ≤2,500、医疗 ≤10,000）、`taxItems`、`customTaxCats`、`saveTax`。
- **内嵌 QA**：`inspectFixedUI20_7A, runRinggitMeRegression19_0, __ringgitmeTestGroups24BA, __ringgitmeTestIOS2OAuth`、24DD3 大型自测（第 12235–12283 行，覆盖深链清洗、原始码不落 D/localStorage/DOM/日志等断言）。

### 3.5 用户偏好已实现部分

- `formatDateMY19_1A`（DD/MM/YYYY）、`formatTimeAMPM19_1A`（12 小时 AM/PM）、`formatDurationSinceMY19_1A` 与 `buildFixedDurationDisplayLine19_1C_FIX2`（≥30 天显示 月+日、≥365 天显示 年+月+日）已存在——2.0 必须全局统一使用而非重造。
- Home 已由 18_5B 层移除「最近记录」，改名「我的月固定 My Fixed」，注入对象账本净额 tile 与「收回后 Cash」tile（第 5555–5578 行）——但实现方式是对 HTML 字符串做正则替换，2.0 需原生化这些需求。
- 音效：`assets/sounds/money-in.wav / money-out.mp3 / neutral.mp3`，`D.soundOn` 开关，符合「声音可选」偏好。

---

## 4. Current UX Diagnosis（现状 UX 诊断）

对任务书 §11 每条诊断给出 确认/否定/修正 + 证据：

| 诊断 | 裁定 | 证据 |
|------|------|------|
| 视觉「放大/zoomed-in」 | **确认** | Home hero 主数字 + `.hero::before` 120px 装饰性「RM」水印（第 578 行）；`renderRecord` 中 28px 结余 + 两块大色卡；每张信用卡渲染为整幅 `creditCardFaceHTML` + 5 按钮动作条（第 2104 行） |
| 卡片过大 | **确认** | `creditCardFaceHTML` 一张卡包含 头部/欠额/4 格义务/badges/进度条/footer 七层；储蓄卡 `accountCardHTML` 同样整幅 |
| 按钮过大过多 | **确认** | 每张信用卡下 5 个 `.btn`（还款/记消费/分期/编辑/删除）；每个 goal 卡 3 个按钮；settings modal 内 8+ 个全宽按钮 |
| 五动作头部重复 | **确认** | topbar 固定 5 icon（刷新/报税/隐私/设置/锁定，第 2384–2388 行），每个 tab 都一样，报税与设置的重要性并不对等 |
| 六个拥挤底部 tab | **确认（实际 6+1）** | `TABS` 6 项 + settings 以 modal 形式充当第七区（`getActiveMainTab20_1`） |
| chips/胶囊过多 | **确认** | `mini-badges`、`card-tabs`（每个 tab 内含 zh/en/sum 三行文本）、taxCat pill-row 22 项一次全展开（第 2015 行 spend modal） |
| 双语标签过密 | **确认** | 几乎每个标签都是「储蓄 Savings」「电子钱包 eWallet」式并排双语（`renderHome` 第 2069 行、`SUBS` 第 2369 行） |
| 颜色不一致 | **部分确认** | 语义色系统存在（`--green/--red/--orange`）但大量硬编码 hex 混用：`#0a8a54`、`#c07a1a`、`#a87d28`、`#dc2626`、`#0a84ff`（第 2069/5561 行），且 `scIc()` 直接拼 `${c}1a` 透明度后缀 |
| 大片空状态 | **确认** | 每个区块都有独立 `.empty`（图标+两行文案），Home 满屏可出现 3 个空状态（目标/忍住没买/收藏） |
| 长表单一次全展 | **确认** | spend modal（第 2015 行）一屏包含：金额键盘、描述、日期、时间、付款方式、balance effect、AA split、类别网格、报税勾选+22 类 pill、收藏勾选、附件——11 组字段无渐进披露 |
| Home/Cards/Income/Records/Fixed/Object Ledger 职责重叠 | **确认** | `renderRecord` 同时是「收入页+快速记账页+收入分析页」；Home 有最近记录（已被补丁移除）+收藏快捷；卡片页含消费入口；AA tab 里又分 people/groups 两段（`renderAAContent24B`） |
| 层级不清 | **确认** | Home 上 hero 三统计 + 4 格 summary grid + 注入的 2 格 = 9 个几乎同权重数字 |
| 渐进披露不足 | **确认** | 同上 spend modal 与 taxCat 全展开 |
| 组件不一致 | **确认** | 同为「卡片列表」存在 `creditCardFaceHTML`、`accountCardHTML`、8 代 wallet deck、`fixed-clean-card18g3` 至少 4 代行渲染（6547/6731/7173/7352 行）并存 |
| 移动密度差 | **确认** | 一屏通常只装得下 hero + 1–2 个区块 |
| 桌面式布局 | **部分否定** | 布局本身是移动优先的单列，问题不是桌面化而是尺度过大 |
| 单体 index.html 风险 | **确认** | 见 §5 |
| 重复 CSS/逻辑 | **确认** | `ensureCss18_7G/18_8B/…24B/24BB` 每层注入独立 style；`payCard` 定义 3 次（231 死块/6476/6649）；`localPersonForPartner` 定义 3 次（3274/3357/4403） |
| 全局状态耦合 | **确认** | 所有层直接读写 `D`/`U`/`window.*`，无接口边界 |
| 回归测试难 | **修正** | 难，但项目已内建大量 `inspect*/__ringgitmeTest*` 自测函数——2.0 应把这份资产迁移为正式 QA fixtures，而不是丢弃 |
| 后台工具感/个人项目感 | **确认** | settings modal 内出现「先运行 Telegram AA SQL」「载入示例数据」「启动保护」等开发者语气文案；`inspectStorage18_7P` 等调试入口离用户一步之遥 |

---

## 5. Current Architecture Diagnosis（现状架构诊断）

### 5.1 层叠覆盖（override-chain）模式

证据链（以 `renderHome` 为例）：基础定义（第 2050 行）→ 自动记账入口包裹（第 2817 行，字符串 `replace` 注入）→ 18_5B 包裹（第 5555 行，正则删除「最近记录」区、重命名「月固定」、在「储蓄目标」marker 前注入两块 tile）→ 24B 包裹（第 10675 行，尾部拼接群组摘要卡）。`renderAA` 至少被定义/包裹 8 次（110［死］、2520、6984、7052、7090、9020、9045、9071、10512）。`buildModal` 被 20_4A/20_6A/20_8A 层再分发（第 10054 行）。

后果：任何上游 HTML 结构改动都可能让下游正则 marker（如 `'<div class="sec">储蓄目标'`）失配而静默失效；这正是「不能再套一层新皮」的技术原因——新皮必须终结这条链，而不是成为第 N+1 层。

### 5.2 死代码块

第 20–462 行位于 `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2">` 内部，浏览器不执行。其中 `telegramFiles15`、`hydrateObjectLedgerBeforeRender18_6YA3`、`migrateFixedAAInstancingV1` 在活块有等价/更新副本（4505、8215、7136 行）；`postFixed18_6M`、`syncFixedAAReceivable18_6M` 仅存在于死块，活体固定过账走 `postFixed`（6522 行）。**2.0 模块化时该块应整体删除，但删除前需按 §24 Phase M 的对照清单确认每个函数在活块的对应物。**

### 5.3 世代堆积

钱包卡组：`renderWalletDeck18_8B/18_8C/18_8D/18_8F`、`renderCardsStackedTabs18_8G`、`renderCardsReadableStack18_8H`、`renderCardsClosedStack18_8J` 共 8 代并存，另保留 `window.renderCardsOriginalPre18_8B`。固定支出行渲染 4 代。这些不是功能，是历史地层；Feature Preservation Matrix（§18）逐条标注「最终活代」。

### 5.4 其他结构性结论

- 事件绑定混用三种机制：内联 `onclick`（多数）、`data-action` 事件委托（18_8B+、24B+）、`window.addEventListener('click', …, true)` 捕获段（`attachConnect23C`）。2.0 统一为委托。
- 每层 `ensureCss*()` 动态 `appendChild(style)`，样式加载顺序=补丁顺序，无法静态审计。
- `save()` 每次写整包 `rm_v3` 并 `schedulePush()` 1.5s 防抖整包上云——附件 base64 在 `files[]` 内使 `rm_v3` 体积失控（18_7P 层的配额告警、`stripAttachmentBinaryKeepMetadata18_7P` 等即为此而生）。
- 自愈/修复迁移以一次性标志位实现（`repairObjectLedgerCashflowPlacement18_7Q_done` 等 3 个 repair 键 + `D.fixedAAInstancingV1`）——2.0 需要正式的 schema 版本号 + 迁移登记，而非散落布尔键。

---

## 6. Complete Redesign Mandate（大改造边界）

允许重想：产品层级、信息架构、底部导航、页面组合、密度、表单结构、动作位置、modal/sheet 用法、资产呈现、共享账本呈现、字体/间距/颜色/材质/图标/动效、明暗模式、加载/空/错误态、组件系统、代码模块化。

**不可触碰（红线）**：

1. `rm_v3` 内既有财务数据必须原样兼容（读旧写旧，或读旧写新且有回滚）。
2. `ledgers` 整包同步协议在 2.0 Core 期间不变（否则旧客户端并存期间互相覆盖）。
3. 24D 邀请安全模型：`code_hash` 只存哈希、`inspect_invitation` fail-closed 通用错误、终态互斥、原始码不落任何持久层/日志/DOM——UI 重设计不得为便利而放宽。
4. `applyTransactionBalanceEffect`/`reverseTransactionBalanceEffect` 的语义与调用点集合不变；删除/回滚必须继续正确恢复余额。
5. AA/结算/对象账本/群组还款的双向同步行为（如 `groupRepaymentIncomeProjections24CCFix2`、`createLinkedOutgoingCore24CH` 的防重复与余额效应判定）不回归。
6. App 与 Worker 改动分阶段；一次一个 coding worker；每阶段先备份；不推荐 `git add .`。

判定标准：完成后用户应感到「这个是完整重新设计过的 RinggitMe」，而所有 §18 矩阵条目仍逐条可验证。

---

## 7. Product Positioning（产品定位）

**RINGGITME — MONEY & LIFE OS**（马来西亚人的钱与生活操作系统）

- **核心承诺**：打开 App 三秒内知道「我现在有多少钱、这个月还要付多少、谁欠我/我欠谁、接下来要做什么」。
- **每日主用例**：记一笔（<5 秒）、看今日钱况、核对到期项、处理 AA/群组分账。
- **情感收益**：掌控感与「账都对得上」的安心，而非理财焦虑。
- **马来西亚相关性**：RM 与 sen、SST/服务费（未来收据）、LHDN 报税 relief 分类（`TAX_CATS` 已内建 22 类）、本地银行/eWallet 品牌（Maybank/TNG/GrabPay…）、Telegram 主流沟通习惯、DD/MM/YYYY + AM/PM。
- **与通用记账 App 差异**：真实信用卡周期与共享额度、recordOnly 历史债务、AA/对象账本/群组三层人际金钱关系、Telegram 双向集成。
- **与 AI 记账 App 差异**：AI 永远只产生草稿（§17/§18 收据规则），账本的每一笔都是用户确认过的。
- **防超级 App 蔓延边界**：不做聊天、不做投资交易、不做电商比价；牌局账本（§29）与生活资产（§14.28）都必须复用既有账本/邀请核心而非另起系统。
- **从个人 App 到消费级**：移除开发者语气文案、SQL 提示、debug 入口进入隐藏诊断页（§14.22 Tools 规划）。

---

## 8. Exact MVP Definition（精确 MVP 定义）

### MUST HAVE — 2.0 CORE

1. 完整视觉系统（§15 tokens 全套 + 明暗模式 + 可访问性回退）
2. Apple Liquid Glass 基础层（导航/Tab bar/Sheet/覆盖层材质，§11）
3. 新 App Shell + 五区导航（§9–10）
4. Today / Money Pulse（§14.1；完整钱况集：当前现金、My Fixed、Total Card Debt、本月卡+分期应还、还卡后 Cash、AA 待收、收回后 Cash、总负债/净负债/净资产，全部沿用既有函数定义）
5. Assets / Ringgit Deck（§14.3；堆叠+列表双模式；信用卡逻辑全保留）
6. 账户/信用卡详情页（§14 页面 4–5）
7. Smart Capture（§14.6；四要素首屏 + More 渐进披露）
8. Activity（历史/搜索/月度分析迁移；`renderAnalytics20_9A`、`buildMonthlyReport` 能力保留）
9. Commitment Radar（§14.10；subs/loans/ccInstallments/月供统一视图；`postFixed` 语义不变）
10. Shared Ledger（§14.12；people/groups/邀请/结算 UI 重排，安全逻辑原样）
11. Tools 迁入头像入口（设置/报税/备份/Telegram/语言/外观）
12. 现有功能保留矩阵全绿 + 模块化地基（app shell / tokens / store 三个模块起步）

### SHOULD HAVE — 2.1 SMART LIFE

真 24 小时 Life Ledger（时间轴/日历/照片模式）、任务与提醒、Second Memory Inbox、OCR/AI 收据 + Ringgit Receipt、附件存储迁移（脱离 base64-in-localStorage）。

### LATER — 2.2 NATIVE / 2.3 LIFE ASSETS / AI 扩展

可靠推送、Live Activities/Dynamic Island、Share Extension、widgets、原生扫描、App Intents、安全原生存储；物品资产（保修/维护/转售/每日成本）；牌局账本（§29）。

判据：凡是「新数据域」（任务、收据 AI、物品、牌局）一律不进 2.0 Core；2.0 Core 只重排既有数据域的呈现与录入。

---

## 9. Information Architecture（信息架构）

五区结构经与现有功能对照验证成立，映射如下：

| 新区 | 旧位置（证据） | 职责 |
|------|----------------|------|
| **Today 今日** | home tab（`renderHome`）+ topbar 隐私切换 | Money Pulse、到期提醒（`billReminders()`）、预算、下一个重要项（pin/island）、群组摘要卡（`renderHomeGroupSummary24BB`） |
| **Assets 资产** | cards tab（`renderCards` + 18_8 系列 deck）+ record tab 的收入总览部分 | Ringgit Deck（cc/saving/ew 三类 `D.cards`）、净资产/总负债头部、转账（`openModal('transfer')`）、账户详情 |
| **＋ Capture 捕捉** | FAB `openAddHub20_1` + `openModal('spend'/'addincome')` + 键盘 `openKeypad` | 支出/收入/转账/（2.1：任务/收据）统一捕捉面 |
| **Activity 动态** | history tab（`renderHistory`）+ record tab 的收入记录 + 统计（`renderAnalytics20_9A`）+ 交易详情（`renderTxnDetail20_6A`）+ 媒体管理（`renderMediaManager20_11A`） | 统一时间流、搜索/筛选（`openFilterModal`）、月度分析、编辑历史（`renderEditTimelineEntry19_1B`） |
| **Ledger 账本** | aa tab（`renderAAContent24B`：people 段 = 对象账本 18_7 系列，groups 段 = 24B/24BB/24C 系列）+ Partner Center（`openPartnerCenter23C`）+ 邀请（24DDB incoming modal） | 人、群组、AA 应收应付、还款、结算、邀请全生命周期 |
| **头像 / Tools** | topbar 4 icon + settings modal（第 2030 行）+ tax modal + Telegram（`openBot` 区） | 账号/云同步、外观、语言、声音、锁、备份/导出/导入、报税、Telegram、诊断（隐藏） |

固定/订阅/贷款（fixed tab）不再占一级 tab：**Commitment Radar 挂在 Today 的「本月必还」入口与 Activity 的筛选之下，同时在 Assets 信用卡详情内展示关联月供**。理由：fixed 是低频管理、高频提醒的域——提醒进 Today，管理进二级页，符合拇指热区分配（高频 tab 在底部，低频进入口）。

深链目的地：`?invite=` / `ringgitme://invite/` → Ledger 区 groups 段 incoming 预览（现状 24DD3 路由 `{tab:'aa',segment:'groups',modal:'incoming'}` 语义不变，仅 tab 名映射为 ledger）；`ringgitme://auth/callback` → 不路由 UI。返回行为：二级页用页栈返回，不复用「换 tab」；iPad/桌面：五区变左侧栏 + 双栏（列表/详情），Deck 变网格。全局搜索入口放 Activity 顶部（现 `openFilterModal` 升级）。

---

## 10. Navigation（导航定案）

- 底部 Tab bar：4 tab + 中央 ＋（Today / Assets / ＋ / Activity / Ledger），Liquid Glass 浮动条（§11.1 G3）。
- 旧→新页面映射：home→Today；cards→Assets；record→拆分（快速记账→＋，收入列表/分析→Activity，经常性收入 `recurIncomes`→Commitment Radar 收入侧）；history→Activity；fixed→Commitment Radar（Today 入口 + Assets 关联）；aa→Ledger；settings modal→头像页；tax modal→头像页›报税；telegramBot modal→头像页›Telegram。
- Modal/Sheet 职责：捕捉、确认、选择器用 Sheet；详情一律用 push 页面（现状把 txnDetail、群组详情都塞 modal，是层级混乱来源之一）。
- topbar 重设计：仅 页标题 + 头像 +（Today 专属）隐私眼睛；刷新动作合并进下拉刷新；锁定进头像页；报税进头像页。

---

## 11. Apple Liquid Glass — 主视觉方向

### 11.1 材质分级（tokens 见 §26）

| 层级 | 名称 | blur | 背景不透明度 | 用途 |
|------|------|------|--------------|------|
| G3 | glass-chrome | 24–32px + saturate(1.6) | 8–14% | Tab bar、顶栏、浮动控件 |
| G2 | glass-sheet | 16–24px + saturate(1.4) | 55–70% | Sheet、modal 头、context menu、segmented control |
| G1 | glass-accent | 8–12px | 20–35% | 选中卡覆盖层、pin/island 表面、Deck 选中过渡 |
| S2/S1/S0 | 实心表面 | 无 | 100% | **全部财务内容**：列表行、金额、图表、表单 |

### 11.2 规则

- 边缘：1px 内侧高光（浅色 `rgba(255,255,255,.35)`、深色 `rgba(255,255,255,.12)`）+ 极浅外描边；阴影只给 G2/G3（y=8–24px、低不透明度），G1 不加投影避免「廉价毛玻璃矩形」。
- 自适应 tint：玻璃层叠 `color-mix(in srgb, var(--accent) 4–8%, transparent)`，随内容滚动由 backdrop 自然变化，不做人工彩虹折射。
- 滚动交互：内容顶到 chrome 下方时 G3 从 0% 渐入到满值（scroll-driven opacity），静止顶部时 tab bar 几乎透明。
- 暗色：blur 不变、白色高光减半、背景不透明度 +8–10%（暗背景下玻璃需要更实以保对比）。
- **禁区**：交易行、图表、金额卡、表单输入一律不用玻璃；不做发光、渐变彩虹、透明表格。
- 回退链：`@supports not (backdrop-filter)` → 半透明实心；`prefers-reduced-transparency` → 全实心（保留同样的层级投影）；低端设备（首帧 > 32ms 探测或 `navigator.deviceMemory<4`）→ 降 G3 blur 至 12px 或禁用；PWA 近似用 `backdrop-filter`（iOS Safari 支持），原生增强路径留给未来 Capacitor 原生 bar。
- Ringgit Deck 是玻璃最沉浸表达：选中卡展开时用 G1 覆盖层承载快速动作，卡片本体仍是实心艺术面（用户批准的真实卡面 PNG，如 `assets/cards/maybank-visa-platinum.png` 等 5 张现有资产 + `REAL_ASSETS_TODO.md` 清单补齐）。

---

## 12. Mandatory User-Liked Experience Requirements（用户已认可体验的落地）

对任务书 §10 十五项逐条给出 2.0 落点（详细规格并入 §14 各页）：

1. **宽视角密度（10.1）**：§15 密度 tokens；每页首屏内容清单写入 §14。基准：行高 44–52px、页边距 16px、区块间距 20px、正文 15px、说明 12–13px、一页一个 40–48px 主金额。
2. **真数字资产卡包（10.2）**：Ringgit Deck 双模式（折叠堆叠 stack / 紧凑列表 list），继承 18_8J「closed stack」的方向但作为唯一正典实现；排序管理、隐私模式（`D.privacyMode` 既有）、真实卡面 + 克制回退（`renderCardPresetFallback20_2B` 思路保留）。
3. **上下文跟随选中卡（10.3）**：Deck 选中态驱动下方「该账户余额/欠额/可用额度/下期应还/近期交易/关联月供」联动刷新；状态存 `U.assetsSelectedCardId`；Reduce Motion 时用淡入淡出替代位移。
4. **完整账户与信用卡详情（10.4）**：信用卡详情页字段清单 = `normalizeCreditCard` 输出全集（limit、availableLimit、currentOutstanding、共享池、monthlyDue、paymentDueDate、普通消费、recordOnly 历史债、`activeInstallments`、还款历史、删除回滚）——禁止简化为「余额+流水」。
5. **完整订阅/承诺详情（10.5）**：Commitment 详情含 价格/频率/下期扣款/付款来源/状态/历史/累计已付/月均/AA 份额/备注/附件/提醒；贷款含剩余额；居住时长沿用 `buildFixedDurationDisplayLine19_1C_FIX2` 规则。
6. **真 24 小时时间轴（10.6）**：2.1 交付；2.0 的 Activity 先落地「按日分组 + 真实时间排序（`normalizedRecordEpoch24CDFix1` 已给出取时优先级）+ 筛选 All/Money/Shared/Receipts/Photos」。
7. **Next item 与今日进度（10.7）**：Today 顶部一条「下一项」（下一个到期 commitment / 下一笔预期 AA 收款），克制、单条。
8. **第二记忆 Inbox（10.8）**：2.1；契约先行——一切捕获先入 `inbox` 草稿态，显式转换，绝不自动过账。
9. **Pin/Island（10.9）**：2.0 做 Today 顶部单一 pinned 卡（G1 玻璃面）；原生 Live Activity 留 2.2。永远只有一个主 pin。
10. **Share-in（10.10）**：2.1 PWA import → 2.2 Share Extension；一律进 Inbox 草稿。
11. **极简捕捉键盘（10.11）**：§14.6；现有 `openKeypad` 自定义键盘保留升级。
12. **有目的的财务动效（10.12）**：金额滚动（`animateHeroNet` 已有雏形，680ms 缓出）、卡片入组、到期→已付翻转；时长 160–420ms；全部尊重 `prefers-reduced-motion`。
13. **标准化 Ringgit Receipt（10.13）**：2.1；确认后生成统一样式小票，原件保留（`files[]`/`person_ledger_attachments` 既有附件链路）。
14. **照片与附件浏览（10.14）**：`renderMediaManager20_11A` 能力迁入 Activity 照片模式；分页与性能约束见 §27。
15. **未来生活资产（10.15）**：2.3；不进 Core。

---

## 13. Signature Systems（签名系统）

2.0 的五个可识别签名（每个都有功能理由，非装饰）：

1. **Money Pulse**：Today 唯一 40–48px 主数字 + 可切换主状态（当前现金/净资产/总负债/净负债），下方一条紧凑可横滑指标带承载完整钱况集（My Fixed / Total Card Debt / 本月卡+分期应还 / 还卡后 Cash / AA 待收 / 收回后 Cash）——层级：一个主数字 ＞ 一条指标带，绝不铺成等权巨卡墙。
2. **Ringgit Deck**：折叠卡堆 + 选中即上下文，全 App 唯一沉浸面。
3. **Commitment Radar**：按「距今天数」排序的到期雷达列表，逾期红、7 日内橙、其余中性。
4. **一条时间流（Activity）**：钱与（未来）生活事件同流不同标记——金额右对齐等宽数字，生活事件无金额列。
5. **收回后 Cash**：`getCashNow() + AA 待收`（现 19_0A 层公式 `round(cash+N(olNet18_8ZA.net))`）作为 RinggitMe 独有指标持续置顶；与之成对的「还卡后 Cash」＝`getAfterCardPaymentCash()`（当前现金 − 本月卡+分期应还）。

---

## 14. Page-by-Page Specifications（逐页规格）

通用约定（适用全部页面，不再逐页重复）：日期一律 `formatDateMY19_1A`（DD/MM/YYYY）、时间一律 `formatTimeAMPM19_1A`（h:mm AM/PM）；隐私模式沿用 `D.privacyMode` 全局遮罩金额；危险动作（删除/结算/撤销/断开）一律 `confirmSheet` 式确认 + 说明后果；暗色模式与 Dynamic Type 全页支持；Liquid Glass 仅按 §11 分级使用；空/加载/错误态使用 §15 统一组件；反 AI 风险按 §16 检查。

### 14.1 Today（今日 / Money Pulse）

- 用户目标：3 秒了解钱况与下一件事。
- 首屏（iPhone 标准视口内，不滚动可见）：① 主状态数字（默认当前现金 Current Cash＝`getCashNow()`，可横滑切换 净资产/总负债/净负债）＋隐私眼睛；② **紧凑可横滑指标带**（高≤64px，一次可见 3–4 格，横滑见其余）承载完整钱况集（定义见下）；③ 单条 Pinned/Next 项；④ 到期雷达前 3 条（`billReminders()` 数据源重排）。
- **钱况集与精确定义**（全部为派生只读值，绑定既有已验证函数，不得重定义）：
  - 当前现金 Current Cash ＝ `getCashNow()`（Σ savings + Σ eWallet）；
  - My Fixed 我的月固定 ＝ `getMyMonthlyFixedTotal18_5B()`——**永远是用户自己的份额**：subs/loans/信用卡月度义务经 `ownAmount18_5B`（AA 拆分后自付部分）累加。例：RM1,312 房租两人平分 → My Fixed 计入 RM656。My Fixed 只含固定承诺（订阅+贷款/租金+`getCreditCardMonthlyObligations()` 的卡月度义务），**绝不把普通信用卡消费混入**；
  - Total Card Debt 信用卡总欠 ＝ `getTotalCardDebt()`（各卡未还普通消费 `getCardNormalUnpaidSpending` ＋ 分期剩余 `getCardInstallmentRemaining`）；
  - 本月卡+分期应还 This Month Card & Instalment Due ＝ `getPendingCardDue()`（Σ `getCardThisMonthDue`：`monthlyDuePaid` 的卡计 0；auto 模式＝当期非 recordOnly 普通消费欠额 ＋ `getCardInstallmentMonthlyDue`（含 `includeInMonthlyPressure` 的分期月供）；manual 模式＝用户设定 `monthlyDue`）；
  - 还卡后 Cash（Cash After This Month's Card & Instalment Payments）＝ `getAfterCardPaymentCash()` ＝ 当前现金 − 本月卡+分期应还；
  - AA 待收 AA Receivable ＝ `getAAReceivables` 净额（Σ max(0, owedAmount−settledAmount)）；
  - 收回后 Cash（Cash After Receive）＝ 当前现金 ＋ AA 待收；
  - 总负债 Total Debt ＝ Total Card Debt（含分期剩余）＋ 其他已录负债（按现契约）；净负债 Net Debt / 净资产 Net Assets ＝ 总负债与可计入的储蓄/eWallet 余额相抵——以 `getFullPayoffPosition()`（`getCashNow()−getTotalCardDebt()−getInstallmentRemainingTotal(true)`）为现有最近实现，其精确构成（`getInstallmentRemainingTotal(true)` 参数语义、是否与卡内分期重叠）在 Phase A 定点审计后按 RinggitMe 域内确认定义锁死，不得凭直觉重写。
- **呈现纪律**：以上绝不铺成等权巨卡；主数字唯一，指标带每格＝小标签+tabular 数字；负值格（缺口/净负债）用语义色但不放大。
- 二屏以下：预算环（`D.budget`）、储蓄目标（`D.goals`）、忍住没买（`D.resists`）、群组摘要（`groupMemberBalanceSummary24C` 聚合）。
- 主动作：无页内大按钮——记账走中央 ＋。次动作：指标带每格点击进对应域。
- 移除：最近记录区（用户已确认）；收藏快捷移入 Capture 面板。
- 动效：主数字入场滚动（继承 `animateHeroNet`，680ms→改 480ms）；指标带无动画。
- 保留规则：`netSnaps` 月度快照逻辑（`netTrendHTML` 第 2044 行）继续记录。
- 反 AI 风险：钱况集条目多，最容易退化成「一墙等权 dashboard 巨卡」——必须做成一条紧凑可横滑指标带（高≤64px），主数字唯一。

### 14.2 Assets 总览 + 14.3 Ringgit Deck

- 用户目标：看全资产负债、切换账户、进详情。
- 首屏：净资产/总资产/总负债三数一行（一主两次）→ Deck（默认 stack 模式，当前选中卡完整可见 + 上下各露 12–16px 邻卡边）→ 选中账户上下文区（余额/欠额/可用/下期应还 + 最近 3 笔）。
- 数据源：`D.cards` 按 `type`（cc/saving/ew）分组；排序字段新增 `deckOrder`（兼容扩展，§20 第 3 类）；转账入口保留 `openModal('transfer')` 语义。
- 交互：左右滑切卡（阈值 ≥40% 卡宽或速度触发）、上滑展开列表模式、长按进入排序；Reduce Motion→无位移堆叠改分页点。
- 卡面：真实艺术资产（`c.customImg || c.cardAsset`，`isAvailableCardAsset20_2B` 校验逻辑保留）；回退面用品牌色 + 名称 + 类型徽标（`renderCardPresetFallback20_2B` 风格，禁止假 AI 卡面）。
- 错误/不完整数据：卡字段缺失时显示「—」并可进详情补全，不显示 0.00 假数据。
- 保留：共享额度池、`getCardAvailableLimit`、`getPendingCardDue` 等全部只读展示；隐私模式遮金额不遮卡面。

### 14.4 储蓄 / eWallet 详情

余额主数字（一页唯一大金额）、本月进出小结、最近记录（点入 Activity 过滤视图）、关联 commitment（付款来源=本账户的 subs/loans）、备注/附件；动作：入账（`openModal('topup')`）、记消费、转账、编辑、删除（删除沿用余额回滚链路）。eWallet 额外保留 PayLater 额度块（`c.hasLimit && c.limit`，`accountCardHTML` 现有逻辑）。

### 14.5 信用卡详情

- 分区：卡面头部（G1 覆盖动作条：还款/记消费/分期）→ 义务区（总额度/可用/当前欠额/本月应还/还款日 `paymentDueDate`/状态 已还 Paid·待还 Pending）→ 分期列表（`activeInstallments`：名称、月供、剩 x/y 期、剩余额，编辑/删除保留 `delInstallment` 回滚）→ recordOnly 历史债务区（明确标注「只记录，不影响余额」）→ 还款历史（`payHistoryHTML18_6U` 数据）→ 月度小结。
- **到期日规则（已验证实现，必须原样保留，不得重新诠释）**：不是通用「月末」规则。卡结清（`getCardNormalUnpaidSpending(card)<=0`）后，周期字段被 `resetCardCycleIfCleared`/`ensureCardCycle` 清空；**下一笔普通消费建立新周期起点**（`ensureCardCycle(card, isoDate)` 把该消费日期写入 `card.currentCycleStartDate`），下一到期日＝起点之后**恰好 30 个日历日**，由 `addDaysISO(start, 30)` 精确计算（如首笔新消费 26/06/2026 → 到期 26/07/2026；结果可能恰好落在次月同一号数，但「次月对应日」不是独立规则，唯一规则是 +30 日历日），写入 `card.autoDueDate`；`card.manualDueDate` 存在时优先（`getCardAutoDueDate` 的取值顺序：manualDueDate → autoDueDate → 起点+30）。周期尚未建立时显示「下一笔消费后自动生成」（`getCardDueLabel` 现文案语义）。注：`autoPaymentDueDay()`（月末日）仅是 `normalizeCreditCard` 中 `paymentDueDate` 缺省显示回退，与周期到期逻辑无关，2.0 文案不得把它表述为到期规则。删除建立周期的那笔首消费时，周期状态必须随 `ensureCardCycle`/`resetCardCycleIfCleared` 正确恢复/重算。
- **建卡/编辑卡表单（简化字段锁定）**：
  - 显示字段：卡名、银行/发卡行（`bankName`）、卡组织（`network`：Visa/Mastercard/Amex）、信用额度（`limit`）、当前欠额（`currentOutstanding`）、本月应还（`monthlyDue`，manual 模式才可编辑）、还款日（`paymentDueDate`）、本月已还状态（`monthlyDuePaid`）、共享额度池归属、备注、经批准的真实卡面图（`customImg`/`cardAsset`）。
  - **默认隐藏/移除**（除非 Phase A 审计证实有活跃域依赖）：Statement Balance（`statementBalance` 字段存在于 `normalizeCreditCard` 但不进普通表单）、Statement Date、Minimum Payment。
  - **字段分层，用户只编辑档案层**：① 卡档案（名称/银行/组织/额度/还款日/卡面/备注/共享池）——可编辑；② 派生值（可用额度 `getCardAvailableLimit`、总债 `getCardTotalDebt`、auto 模式本月应还）——只读展示，**绝不让用户手改本应由记录计算的值**；③ 周期状态（`currentCycleStartDate`/`autoDueDate`/`manualDueDate`/`monthlyDuePaid`/`monthlyDueMode`）——由消费/还款动作驱动，表单仅暴露 manualDueDate 覆盖与已还标记；④ 共享池状态——池内联动展示，不在单卡表单里重复输入。
  - 「当前欠额」仅在建卡录入存量欠款时可填（等价 recordOnly 初始化），之后由记录驱动。
- 危险动作：删卡需二次确认并说明关联交易处理方式（现 `delCard` 行为先审计再迁移，见 §18 未知项）。
- 禁止：出现 CVV/完整卡号字段（现状本就无，2.0 不得新增）。

### 14.6 Smart Capture（＋）

- 首屏四要素：模式切换（支出/收入/转账，分段控件 G2）、金额（自定义键盘 `openKeypad` 升级版，等宽数字、大键位、防误触）、类别（最近+常用横排，一行）、账户（默认上次使用或 `rm_shortcut_default_pay_id_v1` 逻辑迁移）。
- More 展开：日期/时间（默认现在）、AA 分账（`aaSplitHTML` 逻辑）、报税（`TAX_CATS` 选择器改为搜索式而非 22 pill 全展）、收藏、附件、描述、recordOnly 切换（`balanceEffectHTML` 语义）、经常性设置。
- 保存副作用：沿用 `saveSpend` → `applyTransactionBalanceEffect` → `save()` 链路；重复提交防护（连点 1s 内幂等）；成功动效 240ms 入流 + 可选音效（money-out.mp3）+ 轻触觉。
- 错误恢复：保存失败保留全部输入并可重试（现有 `_inSnap` 快照机制的正规化）。

### 14.7 Activity（动态时间流）

按日分组倒序；每行：图标/商户或描述/类别+账户/右侧等宽金额（支出中性、收入绿、转账灰）；行左滑删除（现有 swipe 手势保留）；行点击进详情（`renderTxnDetail20_6A` 内容迁为 push 页）。顶部：搜索 + 筛选（All/Money/Shared/Receipts/Photos）+ 月份切换（`U.histMonth` 逻辑）。分析入口常驻顶部第二位。

### 14.8 搜索/历史筛选

`openFilterModal` 升级：类别、账户、金额区间、日期区间、来源（手记/Telegram/Shortcut/群组）。结果复用 Activity 行组件。

### 14.9 Analysis（分析）

迁移 `renderAnalytics20_9A` + `buildMonthlyReport`：本月支出结构（类别条形，禁止装饰性 3D/发光图表）、收入来源、月对比（`prevMonth20_0`）。图表全实心表面。

### 14.10 Commitment Radar + 14.11 Commitment 详情

- Radar 列表按下次到期日升序：每行 名称/来源账户/月额/到期 DD/MM + 状态徽（已付 `o.lastPaid===ym`、待付、逾期）。三段筛选：订阅/贷款租金/信用卡月供（`rm_fixed_active_tab_v1` 语义迁移）。头部：本月固定总额（`getMonthlyFixedCashflowTotal18_5B`）+ 我的负担（My Fixed＝`getMyMonthlyFixedTotal18_5B`，AA 拆分后自付份额）。
- **固定支出创建/编辑表单（简化产品规则锁定）**：
  - 字段全集（不多不少）：名称、金额、自定义 logo/图标（一等公民需求，非可选装饰）、每月到期日（如「每月 7 号」）、付款来源（saving/eWallet；可不选）、AA 对象（人/群组）与我的份额、入住/起始日期（租金/居住类适用）、备注。
  - **禁止复用旧复杂字段**：不设令人困惑的「首期开始月」、不设重复的开始月控件、普通月付租金/订阅不暴露复杂周期配置、不并存到期日与多个重叠还款日字段（除非 Phase A 证实某字段有已验证域依赖，需在阶段报告点名说明）。
  - 行为契约：设到期日后每月按日提醒；「本月已付」过账（`postFixedPay18_6I`→`postFixed`）从所选 saving/eWallet 来源正确扣款；**未选扣款来源时 UI 必须明示「只记录，不扣余额」**（recordOnly 语义）；RM1,312 平分租金 → My Fixed 计入 RM656；过账时对应 AA 义务**恰好实例化/更新一次**（`upsertFixedAAForMonth`/`fixedAAInstancingV1` 幂等语义）；删除/撤销当月过账必须恢复来源余额并回退关联 AA 状态。
  - 过账后 UI 状态四标齐显：本月已记 / 已扣款（或 只记录）/ AA 已生成 / 已付·待付。
  - 固定支出生成的 AA 项必须出现在 Shared Ledger 对应人/群组下并可结算，结算状态双向可见（§14.12）。
- 详情：14.5/12.5 所列字段全集 + 编辑历史（`openFixedAudit18_6G3` 数据：时间戳、原金额→新金额、原描述→新描述格式，§15.9 组件）+「本月已付/待付」主动作。
- 居住/持续时长显示规则（锁定）：满 30 天后显示 月+日；满 365 天后显示 年+月+日；**任何情况下不得只显示原始总天数**（`formatDurationSinceMY19_1A`/`buildFixedDurationDisplayLine19_1C_FIX2` 现行为）。

### 14.12 Shared Ledger（账本）+ 14.13 人详情 + 14.14 群组详情

- 顶部两段：People（对象账本）/ Groups（群组），沿 `U.aaSegment24B` 语义。
- People 段首屏：AA 净待收/待付汇总（`calculateAllPeopleNetLedger18_7G` 数据）→ 人列表（头像/名字/净额方向色/Telegram 状态点 `telegramDisplay23EFix1`）。
- 人详情：当前未结（`currentRows15` 语义）/ 历史（`historyRows15`）两段；每项：标题、方向、总额/已收/剩余、还款记录（`person_ledger_payments`）、附件；动作：收到款（见下）、编辑、删除（同步删除对应 txn/income 投影，18_7Q 修复语义保留）。
- **AA 历史列表分页规则（锁定）**：首屏显示 30 条（现 `slice(0,30)` 语义）；「加载更多 Load More」每次追加下一页 30 条（`loadMoreAAHistory18_5C`＝`U.aaHistoryLimit18_5C+30` 语义保留）；切换 人/群组/段/相关 tab 时分页重置回首页。列表内附件**只用回形针/紧凑指示器**表示存在，**不在主历史列表内展开大图预览**；完整图片/附件只从详情视图打开。
- **「收到款 Received Payment」流（锁定，适用 People 账本、固定支出生成的 AA、以及现域允许处的群组还款）**：
  - 入口：未结项上明确的「收到款 / Received Payment」动作。
  - 去向选择：储蓄账户 / eWallet / 现金（现金按现规则为 recordOnly，只记录不动余额）；saving/ew 入账（`/^(saving|ew)$/` 余额效应规则）。
  - 全额结清确认后：该未结 AA 项离开「当前未结」视图 → 生成一条还款/结算历史记录（`aaSettlementReceipts` 语义）→ **恰好一次**生成对应收入/账户投影（防重复：settlement key 幂等 + `tgSettlementApplied` 标记）→ 目的账户余额只按已验证账户类型规则变动（`adjustCard14` 语义）。
  - 部分还款：项保持可见并显示剩余额（owedAmount−settledAmount）。
  - 删除/撤销一笔收款必须同时恢复：未结金额、关联收入/交易投影、目的账户余额、结算状态四者。
  - 重复确认必须幂等：同一 settlement 的二次确认不产生第二条收入、不二次入账。
- 群组详情：成员余额（`groupMemberBalanceSummary24C`）、账单列表（`groupSplitItems`/`groupSplitLines`）、还款（`openGroupRepaymentSheet24CC` 链路：防重复、收款账户余额效应 `/^(saving|ew)$/` 规则）、结算历史与撤销、Telegram 绑定状态。
- 邀请：生成（26 字码 + `ringgitme://invite/` 链接 + 未来 QR 同一凭证三种呈现）、incoming 预览（`renderIncomingInvitationModal24DDB`：只显示 `inspect_invitation` 白名单字段——ledger_kind/ledger_title/inviter_display_name/assigned_member_display_name/expires_at/can_accept）、接受/拒绝/撤销/过期终态统一文案「这个邀请无法使用。」（`productError24DDB` 现有文案保留）。
- 红线：原始邀请码只在生成后的一次性 sheet 中显示与复制，不落列表、不落日志、不进 `D`。

### 14.15 邀请预览 / 14.16 终态 / 14.17 结算 / 14.18 撤销

预览 sheet（G2）：标题、邀请人、席位名、过期时间、接受/拒绝双按钮 + 「接受后对方可看到什么」说明。终态：单一通用不可用态（不区分过期/拒绝/撤销/已用——安全要求）。结算：金额、方向、收款账户、确认双按钮；撤销：说明将恢复的余额与状态，确认后走既有 reversal 链路。

### 14.19–14.21 收据导入 / 收据审核 / Ringgit Receipt（2.1 规格占位）

流程契约：拍照/导入 → OCR/AI 提取（商户/日期/条目/小计/SST/服务费/总额/支付方式）→ 审核页逐字段可改 + 置信度标记（低置信度高亮）→ 显式确认 → 才生成财务记录 + 标准化 Ringgit Receipt → 原件永远保留。重复检测：同商户+同额+同日提示。绝不自动过账。

### 14.22 Tools / 14.23 报税 / 14.24 Telegram / 14.25 语言与外观 / 14.26 备份导出

- Tools（头像页）：账号与云同步（`cloudSettingsHTML` 内容）、外观（theme/accent，`setTheme`/`setAccent`）、语言、声音（`D.soundOn` + 三个试听）、安全锁（`lockSettingsHTML`）、报税、Telegram、备份与数据、诊断（隐藏长按入口：storage manager 18_7P、demo 数据、`resetData`——开发者功能不再直接暴露）。
- 报税：年度分组 `taxItems`、22 类 `TAX_CATS` + `customTaxCats`、cap 提示、附件；从 Capture 的报税勾选自动归类。
- Telegram：owner 绑定（`rmGenerateTelegramCode`→`/connect` 命令复制）、partner 连接（Partner Center 23C 全流程：生成/取消 `rm_cancel_aa_partner_invite`/断开 `rm_disconnect_aa_partner`/刷新状态）、群组绑定状态。文案去开发者化（「先运行 Telegram AA SQL」→「此功能暂未开放」）。**同步契约（§18 六行）在此页可自检**：App 手记 AA 与固定支出 AA 在受支持工作流下必须出现在 Telegram AA 总览；App 结算/撤销/删除后 TG 侧不得残留陈旧活跃余额；双向记录经映射键防重复；partner/群组身份映射保持稳定。Worker 源码在仓库之外——任何 Worker 改动前必须先做显式接口冻结/审计，且 App 与 Worker 改动分属不同实现阶段。
- 备份：导出 JSON（`exportData`）/CSV（`exportCSV`）/导入（`importFile`/`importPaste`）/恢复上一次（`restorePrev`，`rm_v3_prev`）全保留。

### 14.27 未来 Inbox / 14.28 未来物品资产（2.1/2.3 占位）

Inbox：捕获项列表（文本/图/URL/收据草稿）+ 逐项「转换为…」动作面板。物品资产：购买价/日期/来源/关联收据/每日成本/保修/维护/配件/转售/回收/持有状态。

---

## 15. Visual Design System（视觉设计系统）

### 15.1 Design Tokens（建议以 CSS 变量落地，替换现 467 行 `:root` 并逐步消灭 447 处内联 style）

**排版**（SF Pro 文本 + 等宽数字 `font-variant-numeric: tabular-nums`；`Space Grotesk` 仅保留给品牌数字或退役——开放决策 §30-4）：

```
--type-page-title: 28px/700      （每页最多 1 个）
--type-section:    18px/650
--type-body:       15px/450–500
--type-caption:    12.5px/500
--type-amount-hero:44px/700 tabular（每页最多 1 个）
--type-amount-row: 15px/600 tabular
--type-amount-sub: 13px/600 tabular
```

**间距/密度**：`--space-page-x:16px; --space-section:20px; --row-h:48px; --row-h-dense:40px; --control-h:44px; --control-h-compact:32px; --card-pad:14px;`

**圆角**：`--r-card:16px; --r-control:12px; --r-sheet:24px; --r-pill:999px;` 全 App 只允许这四档。

**颜色**（评估结论：采纳 Ringgit Jade 体系）：

```
--jade-600:#0a8a54（浅色主）  --jade-400:#34d27f（深色主）  ← 与现有 --accent 完全兼容
--emerald-800:#065f3f（Deep Emerald，强调背景/选中态）
--gold-500:#b8860b 系（Champagne Gold，仅限：成就徽章、目标达成、年度总结——每屏至多 1 处）
--mist-50…900：中性灰阶（浅 #f5f5f7→深 #000，对齐现 tokens）
--sem-red:#dc2626 / --sem-green:#0a8a54（语义涨跌；注意马来西亚语境支出红/收入绿沿用现状）
--sem-orange:#c2620a（到期警示）
```

**材质**：§11 的 G1/G2/G3 + S0（页面底）/S1（卡）/S2（浮起卡）三档实心表面；阴影两档 `--shadow-1`（y2 blur8 4%）/`--shadow-2`（y8 blur24 8%）。

**图标**：延用 Tabler Icons（现 CDN `@tabler/icons-webfont@3.19.0`，2.0 改为自托管子集——见 §28 离线要求）；单一家族、单一描边宽度。

**动效**：`--dur-fast:160ms; --dur-base:240ms; --dur-slow:420ms; --ease-out:cubic-bezier(.2,.8,.2,1)`（与现 swipe 手势曲线一致）；金额滚动 480ms 特例；全部包 `@media (prefers-reduced-motion: reduce)` 回退为不透明度切换。

**触觉**：轻 impact＝保存成功/滑动锁定（现 `haptic(8)` 保留）、中 impact＝结算确认、错误＝notification error。

### 15.2 状态组件

骨架屏（列表行/卡面/指标带三种）、空状态（图标 40px + 一句话 + 单一 CTA，禁止两行以上抒情文案）、错误态（内联条＋重试）、成功 toast（现 `toast()` 升级为顶部 G2 胶囊）。

### 15.3 图表

条形/环形两种，实心表面、语义色、无渐变无阴影、类别最多 6+其他折叠；数字标签用 tabular-nums。

### 15.9 编辑历史组件（用户全局偏好）

统一渲染：`编辑于 {DD/MM/YYYY h:mm AM/PM}`＋`RM {原} → RM {新}`＋`“{原描述}” → “{新描述}”`；应用于 txns/incomes/AA/fixed/群组账单（`normalizeEditHistoryItem19_1B` + `renderEditTimelineEntry19_1B` 为基础实现，迁移为共享组件）。

---

## 16. Anti-AI-Look Review Checklist（反 AI 外观强制清单）

每个实现阶段结束必须逐项通过（写入阶段报告）：

1. 视觉层级：每屏能指出唯一主焦点？主金额每页 ≤1 个 44px+？
2. 排版：只用 §15.1 档位？无随机字号？数字全部 tabular-nums？
3. 间距节奏：全部取自 spacing tokens？无目测像素？
4. 圆角：仅 4 档？同层级元素圆角一致？
5. 图标：单一家族/线宽？无 emoji 当功能图标（装饰性 emoji 限文案语气处）？
6. 颜色纪律：语义色只表语义？Champagne Gold 每屏 ≤1？无未登记 hex？
7. 材质纪律：玻璃只在 §11 白名单表面？财务内容全实心？
8. 卡片密度：无「巨卡墙」？列表优先于卡片？
9. 表面层级：S0/S1/S2 三档内？无多层嵌套卡中卡？
10. 控件一致：同类动作同组件？无五种按钮样式并存（现状反例：`.btn/.btn pay/.btn spd/.btn topup/.btn del`）？
11. 动效目的：每个动画能说出传达了什么状态变化？无 spring 全家桶？
12. Liquid Glass 目的：每处玻璃有交互/层级理由？无装饰性 blur 矩形？
13. 平台原生感：返回手势/Sheet 行为/滚动回弹符合 iOS 习惯？
14. 模板相似度：与通用 finance dashboard 模板逐屏对比无雷同结构？
15. RinggitMe 识别度：五个签名系统（§13）至少一个在当前屏可感知？
16. 日用性：高频操作 ≤2 步？拇指热区覆盖主动作？
17. 截图美 vs 实用：满数据（loadDemo 级数据量）下仍可读？
18. 渐进披露：首屏字段 ≤ 首屏清单？More 内无高频项？
19. 明/暗模式逐屏核对？
20. 可访问性：对比度 ≥4.5:1（金额 ≥7:1）、Dynamic Type 两档放大不破版、Reduce Motion/Transparency 回退生效？
21. 双语纪律：无「中文 English」并排堆叠（现状 `card-tab-zh/card-tab-en` 反例）；英文副题仅在术语确需处？
22. 文案：无开发者语气、无 Phase 编号、无内部术语泄漏（`inspectFixedUI20_7A` 的 `noInternalCopyVisible` 检查思路正规化）？

---

## 17. Content & Language（内容与语言）

架构：`i18n` 字典模块（zh-MY 主 / en-MY 全量 / ms-MY 预留 key 结构），语言设置入 Tools；禁止同屏双语并排（英文副题白名单：eWallet、PayLater、AA 等无自然中文的术语）。

语气基准：短句、平静、具体、像靠谱朋友；不用感叹号轰炸、不用「智能/赋能/一键开启美好生活」式 AI 腔。

示例文案（zh 主 / en 备）：

| 场景 | 文案 |
|------|------|
| 空账户列表 | 还没有账户。添加第一张卡或钱包，开始记录。/ No accounts yet. |
| 记账成功 | 已记一笔 RM 23.50 · KFC / Saved. |
| 保存失败 | 没保存成功，内容还在，请再试一次。 |
| 即将到期 | Netflix · 3 天后扣款 RM 54.90 |
| 逾期 | 房租逾期 2 天 · RM 1,300 |
| 卡债 | 本月应还 RM 850 · 15/08/2026 前 |
| AA 待收 | Abi 还欠你 RM 50 |
| AA 待付 | 你还欠 Jason RM 32 |
| 结算确认 | 收到 Abi 的 RM 50？确认后会记入 Maybank 储蓄。 |
| 结算撤销 | 撤销这笔结算？余额会退回 RM 50，账目恢复未结。 |
| 收据审核 | 检查一下：有 2 个字段我不太确定（黄色标记）。 |
| 邀请等待 | 邀请已发出，等对方接受。有效期至 19/07/2026。 |
| 邀请不可用 | 这个邀请无法使用。（保留现 `productError24DDB` 通用文案，不区分终态） |
| 无权限 | 你没有权限做这个操作。 |
| 离线 | 现在没有网络。已记的账都在本机，联网后自动同步。 |


---

## 18. Feature Preservation Matrix（现有功能保留矩阵）

图例：目的地＝2.0 归属；处置＝保留 Preserve / 重构 Refactor（行为不变实现重排）/ 退役 Retire（仅限死代码与被取代世代）；风险＝迁移回归风险 低/中/高。

| 能力 | 实际实现（代码位置） | 数据源 | 现 UI 位置 | 2.0 目的地 | 处置 | 依赖 | 风险 | 回归测试 | 未知项 |
|---|---|---|---|---|---|---|---|---|---|
| 认证（邮箱+密码） | `authSignUp/authSignIn`（1304–1305） | Supabase Auth | settings modal | Tools›账号 | Preserve | supabase-js | 低 | 登录/登出/切号 | — |
| Google OAuth（web+原生） | `authGoogle`（1346）、IOS2 层（1306–1361） | Supabase Auth + `ringgitme://auth/callback` | 同上 | Tools›账号 | Preserve | Capacitor App/Browser | 中 | `__ringgitmeTestIOS2OAuth` 迁移 | — |
| 多账号记忆/切换 | `rememberAccount/switchAccount/removeAccount`（1293–1365）、`rm_accounts` | localStorage | settings modal | Tools›账号 | Preserve | — | 低 | 切号后数据归属 | — |
| 数据归属守卫 | `adoptCloudOrPush`（1300）、`rm_owner` | localStorage+`ledgers` | 隐式 | 同语义 | Preserve | 云同步 | **高** | A/B 切号不串数据 | 并发双设备写 |
| 24DC 身份引导 | `bootstrap_current_user_identity` 客户端层（11026–11160） | RPC+`rm_shared_identity_24dc_v1:` 缓存 | 隐式 | 同语义 | Preserve | 004 SQL | 中 | not_deployed 分类 | 生产未部署 |
| 现金 | `getCashNow`（1535） | `D.cards`(saving/ew)+txns | Home hero | Today 主数字 | Preserve | 余额效应 | 低 | 现金=Σ 校验 | — |
| 储蓄/银行账户 | `getSavingsTotal`、`accountCardHTML` | `D.cards type:'saving'` | cards tab | Assets/Deck | Refactor | — | 低 | 增删改+入账 | 银行账户与储蓄同型 |
| eWallet+PayLater | `getEwalletTotal`、`c.hasLimit/limit/owed` | `D.cards type:'ew'` | cards tab | Assets/Deck | Refactor | — | 低 | 充值/限额条 | — |
| 信用卡账面 | `normalizeCreditCard`（1518） | `D.cards type:'cc'` | cards tab | Deck+详情 | Refactor | 周期函数群 | 中 | 欠额/可用/到期全套 | — |
| 卡消费（普通） | `saveSpend`+`applyTransactionBalanceEffect` | `D.txns` | spend modal | Capture | Refactor | postingMode | 中 | 记账→欠额增加 | — |
| recordOnly 历史债 | `getTransactionPostingMode/isRecordOnlyTransaction`（1548–1549） | `t.postingMode` | spend modal balance effect | Capture›More | Preserve | — | **高** | recordOnly 不动余额 | — |
| 共享额度池 | shared-limit 逻辑（`getCardUsedLimit` 族） | `D.cards` 关联 | cards | 卡详情 | Preserve | — | 中 | 池内两卡联动 | 池字段名需 Phase A 定点审计 |
| 分期 | `ccInstallments`、`activeInstallments`、`delInstallment` | `D.ccInstallments` | cards+fixed | 卡详情+Radar | Preserve | 月供并入 due | 中 | 增删+月供计算 | — |
| 卡还款 | `openModal('pay')`→还款链路+`getAfterCardPaymentCash` | txns+cards | cards | 卡详情 | Preserve | 余额效应 | **高** | 还款后 outstanding/现金 | — |
| 卡周期/自动到期日 | `ensureCardCycle/resetCardCycleIfCleared/getCardCycleStart/getCardAutoDueDate`（结清→清空周期；首笔新普通消费日＝周期起点；到期＝起点后恰好 30 个日历日 `addDaysISO(s,30)`；`manualDueDate` 优先；**非月末、非「次月对应日」规则**） | `D.cards` 周期字段（`currentCycleStartDate/cycleStartDate/autoDueDate/manualDueDate`） | 卡面到期标签 | 卡详情同语义 | Preserve（原样审计保留，不重新诠释） | 消费/还款链路 | **高** | 结清→首消费建周期；26/06/2026→26/07/2026（精确 +30 日历日）；删首笔消费周期重算；月末与二月/闰年按精确 +30 日历日结果断言 | — |
| 固定支出（订阅/贷款/租金） | `D.subs/D.loans`、`postFixed`（6522）、`renderFixed20_7A`；简化表单规则见 §14.10 | `rm_v3` | fixed tab | Commitment Radar | Refactor（表单按 §14.10 简化，行为不变） | 付款来源扣款 | **高** | 过账扣对来源/recordOnly 提示/RM656 份额/AA 恰好一次/删除恢复余额与 AA/四状态标显 | 自定义 logo 字段名 Phase A 确认 |
| 固定 AA 实例化 | `upsertFixedAAForMonth`/`migrateFixedAAInstancingV1`（7136）、`D.fixedAAInstancingV1` | aaReceivables | fixed | Radar 详情 | Preserve | AA 域 | **高** | 月度 AA 生成幂等 | 死块旧版勿参照 |
| 经常收入 | `D.recurIncomes`、`recurIncomeHTML` | `rm_v3` | record tab | Radar 收入侧 | Refactor | — | 低 | 月度入账 | — |
| 收入记录 | `D.incomes`、`openModal('addincome')` | `rm_v3` | record tab | Capture+Activity | Refactor | 收款账户 | 中 | 收入→余额 | — |
| 转账 | `openModal('transfer')`、`D.transfers` | `rm_v3` | cards | Assets+Capture | Preserve | 双边余额 | 中 | 出入相等 | — |
| 记录/编辑/删除+回滚 | `delTxn`、`reverseTransactionBalanceEffect`、`rm_v3_prev`/`backupPrev` | `rm_v3` | history | Activity | Preserve | — | **高** | 删除后余额恢复 | — |
| 编辑历史 | `editHistory`/`edits` 数组、19_1B 组件、`txnAuditEvents14`、`openFixedAudit18_6G3` | 各记录内嵌 | 详情 | §15.9 组件 | Refactor | — | 中 | 原→新格式 | — |
| Home 汇总指标 / 完整钱况集 | `renderHome`+18_5B/19_0A 注入；函数集 `getCashNow/getMyMonthlyFixedTotal18_5B/getTotalCardDebt/getPendingCardDue/getAfterCardPaymentCash/getAAReceivables/getFullPayoffPosition` | 派生 | home | Money Pulse（§14.1 定义集） | Refactor（呈现重排，定义不变） | 财务函数群 | 中 | §14.1 每指标＝对应函数值；My Fixed＝自付份额（RM1,312 平分→RM656）；本月卡应还含分期月供、不含 recordOnly | Net Debt 精确构成 Phase A 锁定 |
| 预算 | `D.budget`、budget 卡 | `rm_v3` | home | Today 二屏 | Preserve | — | 低 | 超支/剩余 | — |
| 储蓄目标 | `D.goals`、`contributeGoal` | `rm_v3` | home | Today 二屏 | Preserve | — | 低 | 存入进度 | — |
| 忍住没买 | `D.resists` | `rm_v3` | home | Today 二屏 | Preserve | — | 低 | 累计省下 | — |
| 收藏快捷 | `D.favs`、`useFav` | `rm_v3` | home | Capture 面板 | Refactor | — | 低 | 一键记账 | — |
| 报税 | `TAX_CATS`（1277）、`D.taxItems/customTaxCats`、`saveTax` | `rm_v3` | topbar modal | Tools›报税 | Refactor | 附件 | 低 | 分类/cap/年度 | 2026 cap 值需年度核对 |
| AA 应收 | `D.aaReceivables`、`aaInfo15` 活副本、`calcAAOwed` | `rm_v3`+云 | aa tab people | Ledger›People | Preserve | 结算 | **高** | owed/settled/due | — |
| AA 结算收据/收到款流 | `D.aaSettlementReceipts`、`syncSettlementReceipts15`（活副本 4505 区）、`saveAAReceipt14`/`adjustCard14`、`tgSettlementApplied` 幂等标记 | `aa_settlements` 表+本地投影 | aa 历史 | Ledger（§14.12 收到款流） | Preserve | Telegram | **高** | 全额结清离开未结视图；收入投影恰好一次；部分还款显剩余；删除/撤销四项恢复；重复确认幂等 | Worker 侧行为 |
| 对象账本 | `personLedgerItems`、18_6/18_7 系列（`getObjectLedgerItemState18_7K` 等） | `rm_v3`+`person_ledger_items` | aa people | Ledger›People | Refactor | 云拉取 `hydrateObjectLedgerBeforeRender18_6YA3`(8215) | **高** | 净额/方向/还款 | 18_7Q 修复标志位保留 |
| 还款去向 | `person_ledger_payments`+收款账户逻辑（7724/7730 区） | 云+本地投影 | 人详情 | 同 | Preserve | recordOnly 判定 | **高** | cash=recordOnly、sav/ew=入账 | — |
| 结算撤销 | settlement-reversal 链路（18_6REC/24CD 区） | 双侧 | 人/群详情 | 同 | Preserve | — | **高** | 撤销恢复余额 | — |
| Partner Center | `openPartnerCenter23C`、23E/23F/23H 函数群 | `aa_partners` | telegramBot modal | Ledger›人详情+Tools | Refactor | RPC 群 | 中 | 连接/取消/断开 | — |
| 群组/成员 | `createGroup24B/deleteGroup24BFix2`、`groupMembers` | `rm_v3` | aa groups | Ledger›Groups | Refactor | — | 中 | 建删组+成员 | — |
| 群组账单/分账 | `groupSplitItems/groupSplitLines`、`openGroupBill24BB` | `rm_v3` | aa groups | 同 | Preserve | 合计=0 校验 | **高** | 拆分/编辑 | — |
| 群组还款（收/付） | `groupRepaymentIncomeProjections24CCFix2`、`createLinkedOutgoingCore24CH` | txns 投影 | 群详情 | 同 | Preserve | 防重复 seenIds/seenLinks | **高** | 幂等+余额 | — |
| 邀请生成/预览/接受/拒绝/撤销/移除 | 24DD 客户端（11462+）+ 005 SQL 六 RPC | `invitations` 表 | 24DDB modal | Ledger›Groups | Preserve | 24D 部署 | **高** | 24DD3 自测全集迁移 | 生产未部署 |
| 深链（web/原生） | `captureWebInvite24DD3`/`parseNativeInviteUrl24DD3`（12101+） | URL+`rm_pending_invite_24dd_v1` | 全局 | App Shell 路由 | Preserve | Capacitor App | **高** | 清洗/TTL/防自动接受 | Universal Links 未配置 |
| Telegram owner 绑定 | `rmGenerateTelegramCode`、`rm_tg_owner_code_v1` | `telegram_bindings` | telegramBot modal | Tools›Telegram | Preserve | Worker | 中 | 绑定状态刷新 | Worker 外部 |
| Telegram partner/群组身份映射 | `tgPartnerMap`、`localPersonForPartner14`(4403)、`groupTelegramBindings` | `aa_partners` 等 | 同上 | 同 | Preserve | Worker | **高** | partner→本地人映射稳定、不重建重复人 | Worker 外部 |
| Telegram 同步契约：App 手记 AA→TG 总览 | App 内创建的 `aaReceivables` 经既有同步路径出现在 Telegram AA 总览/汇总（该工作流受支持处） | `aa_ledger_items`/`aa_partners` | Telegram Bot | 同（契约冻结） | Preserve | Worker 接口审计 | **高** | 手记 AA 后 TG 总览含该笔且金额正确 | Worker 外部，改动前须接口冻结 |
| Telegram 同步契约：固定支出 AA→TG 总览 | `postFixed` 实例化的月度 AA（`upsertFixedAAForMonth` 语义）同步至 Telegram 总览 | 同上 | Telegram Bot | 同 | Preserve | 同上 | **高** | 过账后 TG 总览出现当月 AA 份额 | 同上 |
| Telegram 同步契约：结算/撤销/删除→TG | App 侧结算、撤销、删除后 Telegram 侧不得残留过期活跃余额（`tgSettlementApplied`/`aaHiddenSettlementIds` 标记链） | 同上 | Telegram Bot | 同 | Preserve | 同上 | **高** | 结算→TG 汇总归零；撤销/删除→TG 余额恢复且无陈旧值 | 同上 |
| Telegram 同步契约：双向防重复 | TG 起源与 App 起源记录经映射键（settlement key、`quickEntryId`、`tgPartnerMap`）互不重复入账 | `quick_entries`+本地 | 隐式 | 同 | Preserve | 同上 | **高** | 重试/双向同步零重复；幂等标记不丢失 | 同上 |
| Shortcut 直连 | `rm_submit_quick_entry` 端点（2862）、`rm_shortcut_*` 三键 | `quick_entries` | 自动记账入口卡 | Tools›自动化 | Preserve | 外部 SQL | 中 | 导入幂等 | SQL 不在仓库 |
| 附件/媒体 | `files[]` base64、`attachFieldHTML`、`renderMediaManager20_11A`、18_7P 配额管理 | `rm_v3` | 各详情 | Activity 照片模式+详情 | Preserve(2.0)/迁移(2.1) | 配额 | **高** | 上传/查看/清理 | 见 §22 |
| 隐私模式 | `D.privacyMode`、`togglePrivacy` | `rm_v3` | topbar | Today 眼睛 | Preserve | — | 低 | 全金额遮罩 | — |
| 锁（PIN/FaceID） | LOCK 状态机（1389）、`rm_pin_hash`/`rm_webauthn_cred` | localStorage | 启动 | 同+Tools›安全 | Preserve | WebAuthn | 中 | 锁/解锁/降级 | — |
| 备份/导出/导入/恢复 | `exportData/exportCSV/importFile/importPaste/restorePrev` | `rm_v3(_prev)` | settings | Tools›备份 | Preserve | — | 中 | 导出→导入 roundtrip | — |
| 声音/触觉 | `D.soundOn`、`previewSound`、`haptic` | assets/sounds | settings | Tools+Capture | Preserve | — | 低 | 静音尊重 | — |
| 主题/强调色 | `applyTheme/setTheme/setAccent`、`data-theme` | `rm_v3` | theme modal | Tools›外观 | Refactor | tokens | 低 | 三态切换 | — |
| PWA 壳 | `manifest.json`（无 SW） | — | — | §28 方案 | Refactor | — | 中 | 安装/启动 | 离线为零 |
| Capacitor iOS 壳 | `capacitor.config.json`、`ios/App`、prepare 脚本 | — | — | 同 | Preserve | Xcode | 中 | scheme 深链 | D3C 由 Codex 处理 |
| 内嵌 QA | `inspect*`/`__ringgitmeTest*` 全系 | — | console | QA fixtures 模块 | Refactor | — | 中 | 断言迁移清单 | — |
| 死块 20–462 | `<script src>` 内联 | — | 不执行 | 删除 | Retire | Phase M 对照 | 低 | 删除前 diff 活副本 | `postFixed18_6M` 仅存死块 |
| 8 代 wallet deck / 4 代 fixed 行 | 18_8B–J、6547/6731/7173/7352 | — | 最后一代活跃 | 单一正典组件 | Retire（留最终代语义） | — | 中 | 视觉回归 | 需运行时确认最终活代 |

**任何一行「保留/重构」条目在其对应实现阶段报告中缺失验证，即视为阶段失败。**

---

## 19. End-to-End User Flows（端到端用户流）

每条流列：路径 → 危险转换（⚠）→ 确认点（✋）。

1. **记支出**：＋ → 四要素 → 保存 → `applyTransactionBalanceEffect` → Activity 顶部入流。⚠ 连点重复提交 ✋ 无（低危，靠幂等）。
2. **记收入**：同上走 income 链路，收款账户必选（cash=不动余额提示）。
3. **转账**：Assets›转账 → 出/入账户+金额 → ⚠ 双边余额一致 ✋ 金额>出账余额时警示。
4. **卡消费（含周期建立）**：Capture 选 cc 账户 → outstanding 增加、可用额度减少；若卡此前已结清（无周期），这笔普通消费经 `ensureCardCycle` 成为新周期起点，`autoDueDate`＝消费日后恰好 30 个日历日（`addDaysISO(start,30)`；26/06/2026 → 26/07/2026）。⚠ 共享池双卡联动；⚠ 删除这笔建周期首消费后周期状态必须正确恢复/重算（结清则清空、仍有欠额则按现实现重建）。
5. **历史债（recordOnly）**：Capture›More›记账模式 → 只记欠额不动现金。⚠ 用户误选普通模式 ✋ 模式切换即时预览余额效应（`balanceEffectHTML` 语义）。
6. **卡还款**：卡详情›还款 → 来源账户扣款 + outstanding 减少 + `monthlyDuePaid` 置位；全额结清后 `resetCardCycleIfCleared` 清空周期，到期标签回到「下一笔消费后自动生成」。⚠ 还款额>欠额 ✋ 超额确认。
7. **固定支出创建→月度过账→删除**：Radar›添加（§14.10 简化表单：名称/金额/logo/到期日/来源/AA 份额/入住日/备注）→ 每月到 due 日提示 → 「本月待支付」→ `postFixed` 扣正确 saving/eWallet 来源 + 标记 `lastPaid=ym` + AA 恰好一次实例化（`upsertFixedAAForMonth`）→ UI 显示 本月已记/已扣款/AA 已生成/已付。删除/撤销当月过账 → 恢复来源余额 + 回退 AA 状态。⚠ 重复过账（`lastPaid` 幂等守卫必须保留）✋ 无来源时「只记录，不扣余额」提示。
8. **订阅/贷款/分期**：同 Radar 域；分期到期自动并入卡月供（`getCardInstallmentMonthlyDue`）。
9. **收据流（2.1）**：导入→提取→审核→✋ 显式确认→记录+Ringgit Receipt。⚠ 重复收据、AI 误读金额。
10. **AA 创建**：Capture›More›AA 或人详情 → 生成 `aaReceivables` 行。⚠ 与主记录金额联动。
11. **AA 删除**：✋ 确认 → 同步清理关联 receivable（`delTxn` 现有联动语义）。
12. **收到款 Received Payment**：未结项›「收到款」→ 选去向（saving/eWallet 入账；cash 按现规则 recordOnly）→ 全额结清：项离开未结视图 + 结算历史记录 + **恰好一次**收入/账户投影 + 目的余额按账户类型规则变动；部分还款：项保留并显示剩余额。⚠ 余额效应判定错账户类型；⚠ 重复确认必须幂等（settlement key + `tgSettlementApplied`）。适用 People 账本、固定支出 AA、现域允许的群组还款。
13. **结算**：✋ 双按钮确认（金额+去向复述）→ confirmed。
14. **结算撤销/收款删除**：✋ 后果复述（退回金额、恢复未结）→ reversal 链路 → 同时恢复 未结金额/收入投影/目的账户余额/结算状态 四者，且 Telegram 侧不得残留过期活跃余额。⚠ 不可重复撤销。
15. **建群/邀请/加入**：建群 → 生成邀请（码/链接/未来 QR 同一凭证）→ 对方 `?invite=` 或 `ringgitme://invite/` → 预览（inspect）→ ✋ 接受/拒绝。⚠ 原始码泄漏面（分享面板文案提醒）；⚠ 拒绝是 bearer 能力（005 已知边界，README §D1）。
16. **撤销邀请/移除占位成员**：owner 端 ✋ 确认 → `revoke_invitation`/`remove_unclaimed_member`（revision 保护）。
17. **过期**：到 `expires_at` 后统一「无法使用」。
18. **编辑/编辑历史/删除/回滚**：详情›编辑 → 历史条目追加；删除 ✋ → 余额反向恢复；`rm_v3_prev` 兜底。
19. **报税归类**：Capture 勾选 → `taxItems` 追加 → Tools›报税年度视图。
20. **账户动态↔时间流**：Deck 选卡 → 该卡过滤视图 ↔ Activity 全局流互跳。
21. **Share-in→Inbox→转换（2.1）**：一律草稿先行 ✋ 转换确认。

全局危险清单：余额类（4/5/6/7/12/14/18）必须有反向函数覆盖；周期类（4/6）删除与结清路径必须重算正确；授权类（15/16）必须走 RPC 且 UI 不早显示未授权数据；重复类（1/7/9/12/15）必须幂等。

---

## 20. Data Contract Freeze（数据契约冻结）

分类：①不可变 ②可包装 ③可兼容扩展 ④需迁移 ⑤已废弃但不可删 ⑥未知待审计。

### 20.1 localStorage / sessionStorage

| 键 | 分类 | 说明 |
|---|---|---|
| `rm_v3` | ① 结构不可变 / ③ 可加新键 | 全部财务数据；新键必须有默认值兼容旧包 |
| `rm_v3_prev` | ① | 一键恢复依赖 |
| `rm_owner`、`rm_accounts`、`rm_onboarded` | ① | 账号归属与引导 |
| `rm_pin_hash`、`rm_webauthn_cred` | ① | 安全锁 |
| `rm_supa_url`、`rm_supa_key` | ⑤ | 被硬编码 SUPA_URL 取代但读取链仍在（`supaCfg` 回退） |
| `rm_cards_active_tab_v1`、`rm_fixed_active_tab_v1` | ② | UI 记忆，可包装进新 UI 状态持久层 |
| `rm_auto_save_img_note` | ② | — |
| `rm_shortcut_direct_token_v1`、`rm_shortcut_default_pay_id_v1`、`rm_shortcut_auto_import_v1` | ① | Shortcut 直连协议 |
| `rm_tg_owner_code_v1`、`rm_tg_aa_partner_code_v1` | ① | Telegram 绑定码缓存 |
| `rm_pending_invite_24dd_v1` | ① | 深链暂存（版本 1、TTL 24h、登录即提升并清除） |
| `rm_shared_identity_24dc_v1:<uid>` | ① | 身份缓存（版本字段自带） |
| `repairObjectLedger*18_7Q/18_7T_done`、`qa_fix3_local` | ⑤ | 一次性修复标志，不可删（防重跑），2.0 迁移到正式迁移登记表后可包装 |

### 20.2 `rm_v3` 内部 schema

- ①：`txns/incomes` 记录形状（`id, amt, desc, catId/catLabel/catIcon, payId/payName, postingMode, date, isoDate, time, files[], aaSplit, editHistory/edits, sourceType/source, metadata` 等）、`cards`（`type:'cc'|'saving'|'ew'` + 额度字段 + **周期字段 `currentCycleStartDate/cycleStartDate/autoDueDate/manualDueDate/paymentDueDate` 与月度状态 `monthlyDuePaid/monthlyDueMode/monthlyDue`**——`ensureCardCycle` 的「结清→首笔新消费建周期、到期＝起点+30 天」写入语义属契约一部分）、`aaReceivables`（`owedAmount/settledAmount/totalAmount/status/personId`）、`aaSettlementReceipts`（`settlementId` 幂等键）与 `tgSettlementApplied` 结算已应用标记、收入投影字段 `receiveCardId/receiveCardName/receiveCardType`、`ccInstallments`（含 `includeInMonthlyPressure`）、`subs/loans`（`lastPaid` 幂等键、`aaSplit` 份额与到期日字段）、群组五表键、`nextId`。
- ③：新增 `deckOrder`、`pinnedItemId`、i18n 语言键等展示性字段。
- ④（仅 2.1+，带完整迁移程序）：`files[]` base64 → 外部存储引用。
- ⑥：`personLedgers` 与 `personLedgerItems` 并存关系、共享额度池确切字段名、`D.uid/D.apply/D.test` 等低频键的真实用途——Phase A 定点审计。

### 20.3 Supabase 契约

- ① 表：`ledgers`（整包同步）、`quick_entries`、`telegram_bindings`、`aa_partners`、`aa_settlements`、`aa_ledger_items`、`person_ledger_items`、`person_ledger_payments`、`person_ledger_attachments`；24D 13 表全部（见 §3.4）。
- ① RPC（旧）：`rm_submit_quick_entry, rm_create_shortcut_token, rm_create_telegram_link_code, rm_create_aa_partner_code, rm_create_aa_partner_code_v23d, rm_cancel_aa_partner_invite, rm_disconnect_aa_partner`。
- ① RPC（24D）：`bootstrap_current_user_identity, ensure_current_identity, create_shared_ledger, invite_member, inspect_invitation, accept_invitation, reject_invitation, revoke_invitation, create_member_invitation, remove_unclaimed_member, create_shared_entry, respond_to_line, revise_entry, void_entry, mark_line_paid, confirm_line_received, waive_line, reopen_line, record_settlement, issue_media_url`。签名与错误语义（通用 `invitation unavailable`、`P0002`、revision `IS DISTINCT FROM` 规则）全部 ①。
- ① RLS 假设：active-membership 读、无广泛表级写 grant、`SECURITY DEFINER` + `pg_catalog, public, pg_temp` search path、`code_hash` 列不可读、`shared_entry_events` 只追加（002/005 + README「RLS and SECURITY DEFINER deployment model」）。
- ① 深链契约：`?invite=CODE`（仅此参数被清洗，其余 query/hash 保留）、`ringgitme://invite/<26码>`（无 query/hash/多级路径）、`ringgitme://auth/callback`。
- ① Telegram：`tgPartnerMap` 的 partnerId→本地 person id 映射、Worker `/tg-file?fid=` 附件代理 URL 形状。
- ⑥：Worker 与旧 SQL 全部对象（不在仓库）——Delta Intake 时列入审计。

---

## 21. Safe Modular Architecture（安全模块化架构）

策略：**新壳吸收，整链退役**。不做逐函数抽取（层叠链使单函数抽取必断），而是：新 App Shell 建立后，每迁一个域，把该域「基础函数+全部包裹层」一次性合并成单一正典模块，旧链整链移除。

| 模块 | 职责 | 现源（index.html） | 接口（示意） | 状态所有权 | 抽取序 | 风险 | 测试 |
|---|---|---|---|---|---|---|---|
| `core/tokens` | §15 全 tokens + 材质 | 467–1014 行 CSS + 各 `ensureCss*` | CSS 变量 | 无 | 1 | 低 | 视觉快照 |
| `core/store` | `D/U` 读写、`load/save/backupPrev`、schema 版本登记 | 1278–1290、1842–1844 | `getState()/update(fn)/subscribe` | 全数据 | 2 | 高 | roundtrip+配额 |
| `core/shell` | 路由、tab bar、topbar、Sheet 栈、深链分发 | `render()/setTab/openModal/buildModal` | `navigate(route)` | `U` | 3 | 中 | 路由矩阵 |
| `core/format` | 日期/时间/金额/时长 | 19_1A/19_1B 函数群、`fmt` | 纯函数 | 无 | 1 | 低 | 单测 |
| `domain/finance` | §3.3 全函数 + 余额效应 | 1506–1560 及包裹层 | 纯函数入 `D` 出值 | — | 4 | 高 | 数字全量对照 |
| `domain/cards` | 信用卡周期/分期/共享池 | 同上+`ccInstallments` 区 | — | `D.cards/ccInstallments` | 4 | 高 | §26 卡组 |
| `domain/commitments` | subs/loans/postFixed/AA 实例化 | 6522/7136/7155/7484 链 | `postFixed(kind,id)` 语义不变 | `D.subs/loans` | 5 | 高 | 过账幂等 |
| `domain/activity` | txns/incomes 查询、编辑历史 | renderHistory/20_5A/20_6A 链 | 查询器 | `D.txns/incomes` | 5 | 中 | 过滤矩阵 |
| `domain/shared` | AA/对象账本/群组/结算 | 18_6/18_7/23B/24B–24CH 链 | 现有函数名保留 | 相关键 | 6 | 高 | `__ringgitmeTestGroups24BA` 迁移 |
| `domain/invitations` | 24DD/24DDB/24DD3 三层 | 11462–12421 | **原样搬运不改写** | `rm_pending_invite_24dd_v1` | 6 | 高 | 24DD3 自测全集 |
| `adapters/supabase` | 客户端、整包同步、RPC 封装 | 1285–1303 + 分散 rpc 调用 | `sync.push/pull`、`rpc.<name>` | SESSION | 3 | 高 | mock 契约测试 |
| `adapters/telegram` | 绑定/partner/附件代理 | 3185–3300、23C–23H 链 | — | `tgPartnerMap` | 7 | 中 | 状态刷新 |
| `features/*`（today/assets/capture/activity/ledger/tools） | 各页 UI | 对应渲染链 | 组件 | `U` 子树 | 4–7 | 中 | 页级快照+交互 |
| `qa/fixtures` | 内嵌自测迁移 | `inspect*/__ringgitmeTest*` | `runRegression()` | — | 与各域同步 | 低 | 自身 |

硬规则：每阶段结束 App 可运行；旧新实现并存期以特性开关（`U.shell20`）切换；`rm_v3` 读写只经 `core/store`；没有大爆炸重写。

---

## 22. Migration & Compatibility（迁移与兼容）

- **原则**：每次迁移必须 fail loudly；先 legacy preflight（统计异常行、停机条件）→ `backupPrev()` 强制 → 兼容检查 → 明确 rollout 顺序 → 回滚脚本 → 验证探针 → 并发分析 → 授权分析（对齐 24D README 的 005 preflight 模式）。
- **2.0 Core 期间零 schema 迁移**：`rm_v3` 只加键不改型；云端零 SQL 改动。
- **schema 版本登记**：`core/store` 引入 `D.schemaVersion`（新键，③类），把散落的 `repair*_done`/`fixedAAInstancingV1` 标志读入登记表但不删除原键。
- **附件迁移（2.1）**：预检（`estimateAttachmentBytes18_7P` 逻辑复用）→ 分批外迁 → 双写验证 → 原 base64 只在校验通过后按批置换为引用 → 每批可回滚。禁止「清理历史数据让迁移通过」。
- **并发**：整包 `ledgers` 同步在双设备场景本就 last-write-wins——2.0 不改协议但必须在 Tools›备份显示「最后同步时间/设备」，并把该风险列入 §27。

---

## 23. Final Phase 24D Delta Intake Gate（24D 最终增量吸收闸门）

2.0 实现开工前的强制 Phase 0：

1. 确认 Phase 24D 最终验收 commit（预计在 `wip/phase24d-d3-invite-deep-links` 或其后续分支上，含 D3C harness 恢复成果——D3C 结论仅在此处经验证后进入，任何未验证 harness 结论不得直接写入产品蓝图）。
1a. 证据收集：定位并读取 `RINGGITME_FULL_AZ_MVP_RECOVERY_AUDIT_20260712.md`（本蓝图审计时点未见于可访问路径，见 §2.3/§34-1）；若取得，将其结论并入本闸门报告并复核与本蓝图的冲突。
2. `git diff 1e41f51..<final>` 全量比对本蓝图基线。
3. 清点每一处新增/删除/变更：函数（重点 24DD/24DD3/24DDB 层与 D3C 相关）、本地状态结构、storage 键、Supabase 表/RPC/RLS/grant/migration（重点 005 之后是否有 008+）、群组/邀请/结算行为、深链行为（重点 Universal Links 是否已配置）、原生行为（Info.plist/entitlements）、UI 状态、测试（`__ringgitmeTest*` 新断言）、安全规则。
4. 逐条更新 §18 矩阵、§20 冻结表、§26 QA 矩阵。
5. 冲突消解：蓝图规格与 24D 最终行为冲突时，**以 24D 已验收行为为准**，修订蓝图相应页（尤其 14.12–14.18）。
6. 从最终验收 HEAD 创建 2.0 实现分支（命名建议 `wip/ringgitme-2.0-core`）；**绝不从本蓝图快照分支开工**。
7. 产出 `PHASE0_DELTA_INTAKE_REPORT` 后才允许 Phase A 开始。

吸收方式：24D 的邀请/身份/深链三层代码在 2.0 中以 `domain/invitations` 原样搬运（§21），其自测断言进 `qa/fixtures`；任何 24D 行为差异都通过该模块边界吸收，不散落改写。

---

## 24. Phased Implementation Roadmap（分阶段实现路线图）

每阶段模板（全部阶段强制）：目标 / 基线 commit / 精确范围 / 禁区 / 涉及文件与模块 / 开工前备份 / 受保护契约（引用 §20 条目号）/ 截图（明+暗）/ 静态测试 / 功能测试 / 回归测试（§18 相关行）/ 视口测试（iPhone SE·15 Pro·Pro Max·iPad）/ 暗色模式 / 可访问性 / §16 反 AI 清单 / §11 Liquid Glass 审查 / 停机条件 / commit 边界（单一目的 commit，不 `git add .`）/ 回滚步骤。

| Phase | 内容 | 关键范围与停机条件 |
|---|---|---|
| **0** | Final 24D Delta Intake | §23 全九步；停机：diff 中出现未理解的安全/财务变更 |
| **A** | 数据契约冻结验证 | 把 §20 表逐条与 Phase 0 后代码核对；补 ⑥ 类审计（共享池字段、`personLedgers`、`D.uid/apply/test`）；产出机器可读契约清单进 `qa/fixtures`；零 UI 改动 |
| **B** | Tokens + Liquid Glass 地基 | 新 `core/tokens` 样式层并存于旧 CSS 之后；仅影响颜色/字号变量映射；停机：任何页面数字不可读 |
| **C** | App Shell + 五区导航 | `core/shell` + 特性开关 `U.shell20`；旧 6 tab 仍可切回；深链路由接管（24DD3 语义不变）；禁改任何财务函数 |
| **D** | Today / Money Pulse | 14.1 规格；数据只读现有函数；禁改 `netSnaps` 写入逻辑以外的状态 |
| **E** | Assets / Ringgit Deck | 14.2–14.3；8 代 deck 退役、单一正典组件；停机：任一卡指标与旧页数值不一致 |
| **F** | 账户/卡详情 | 14.4–14.5；还款/分期/删除链路 + 卡周期六项 QA（结清建周期/+30 天/删首消费/月末/二月闰年）回归全绿才可合并；建卡表单按 §14.5 简化字段集 |
| **G** | Smart Capture | 14.6；`saveSpend` 链路不改语义；键盘组件化 |
| **H** | Activity/历史/分析 | 14.7–14.9；过滤/搜索/详情/编辑历史组件 |
| **I** | Commitment Radar | 14.10–14.11；`postFixed` 幂等回归重点 |
| **J** | Shared Ledger | 14.12–14.18；邀请/结算 UI 重排、`domain/invitations` 原样搬运；**禁改 SQL 与 RPC 调用形状** |
| **K** | Tools/语言/设置 | 14.22–14.26 + i18n 字典架构 |
| **L** | 一致性/可访问性/暗色收口 | 全页 §16 清单复查、对比度扫描、Reduce Motion/Transparency 全检 |
| **M** | 安全模块化收尾 | 死块 20–462 删除（含对照清单）、旧补丁链清除、`qa/fixtures` 迁移完成 |
| **N** | Smart Life 准备 | Inbox/收据/时间轴数据契约草案（只写文档与空模块，不实装） |

禁止合并的组合：大面积样式 × 数据迁移；导航重构 × 财务逻辑；邀请安全 × 视觉；App × Worker；同阶段多个高危域。

---

## 25. Codex Model & Reasoning Recommendations（模型与推理档位建议）

原则：不默认最强档；每档位说明配额理由。「审计档」指该阶段结束后的独立复查运行。

| Phase | 实现档 | 审计档 | 理由 |
|---|---|---|---|
| 0 | High | Extra High | diff 涉及邀请安全与 SQL——审计必须最强档，实现（清点）High 足够 |
| A | Medium | High | 机械核对为主，但契约误判代价高 |
| B | Low–Medium | Medium | Token 替换重复性高、可静态验证 |
| C | High | High | 路由+深链+特性开关是回归重灾区 |
| D | Medium | Medium | 只读数据装配，公式已冻结 |
| E | High | High | 8 代退役 + 手势 + 数值对照，域敏感 |
| F | High | Extra High（仅还款/删除链路） | 余额效应高危；审计聚焦反向函数 |
| G | Medium–High | High | 保存链路语义敏感但范围小 |
| H | Medium | Medium | 展示层为主 |
| I | High | Extra High（仅 postFixed/AA 实例化） | 幂等与 AA 联动是历史事故区 |
| J | High | Extra High | 共享账本+邀请 UI；任何触碰授权面的 diff 直接停机 |
| K | Low–Medium | Medium | 文案/设置/字典 |
| L | Low–Medium | Medium | 清单执行 |
| M | High | Extra High | 删死代码/退役链——误删活体的风险最高 |
| N | Medium | High | 契约设计文档 |

Extra High 全局白名单（其余场景不得使用，节约配额）：未决架构冲突、财务迁移、邀请安全、并发、RLS/RPC、回滚/恢复、跨系统关键变更。每次使用需在阶段报告写明「为什么值得」。

---

## 26. QA Master Matrix（QA 主矩阵）

执行方式图例：A=自动（qa/fixtures 迁移的 `__ringgitmeTest*` 断言）、F=固定数据集（loadDemo 级 fixture）、S=静态（grep/契约扫描）、M=手动、SIM=Simulator、P=生产冒烟。

| 域 | 关键断言 | 方式 |
|---|---|---|
| 总额/现金 | `getCashNow`=Σ(saving,ew)±效应；Today 主数字=函数值 | A+F |
| 余额/转账 | 转账双边和为零；删除后恢复 | A |
| 信用额度 | used+available=limit；共享池联动 | A+F |
| 卡债/还款/到期 | outstanding、monthlyDue（auto=非 recordOnly 当期欠额+分期月供；manual=设定值）、还款置位 `monthlyDuePaid` | A+F |
| 卡周期规则 | 结清卡（欠额≤0）→ 周期字段清空；首笔新普通消费→`currentCycleStartDate`=消费日 | A |
| 卡到期日 | `getCardAutoDueDate`＝起点后恰好 30 个日历日（`addDaysISO(start,30)`；26/06/2026→26/07/2026）；不得以「次月对应日」为独立规则断言；`manualDueDate` 优先 | A |
| 删除建周期首消费 | 删除后周期状态正确恢复/重算（结清→清空并显示「下一笔消费后自动生成」） | A+F |
| 周期月末边界 | 起点在 29/30/31 日：断言精确 +30 日历日结果（`addDaysISO` 输出），不假设落在次月同号数 | A |
| 周期二月/闰年边界 | 起点 29/01–31/01 及闰年 29/02 附近：断言精确 +30 日历日结果（`addDaysISO` 输出） | A |
| Money Pulse 钱况集 | §14.1 每指标＝对应函数值（Current Cash/My Fixed/Total Card Debt/本月卡+分期应还/还卡后 Cash/AA 待收/收回后 Cash/Total·Net Debt） | A+F |
| My Fixed 份额语义 | RM1,312 平分租金→My Fixed 含 RM656；普通信用卡消费不进 My Fixed | A |
| 分期 | 月供并入 due；删除回滚 | A |
| 固定/订阅/贷款 | `postFixed` 幂等（同月二次不重扣）；扣对所选 saving/eWallet 来源；无来源时「只记录，不扣余额」明示；过账后四状态标（本月已记/已扣款/AA 已生成/已付） | A+M |
| 固定表单简化 | 表单字段=§14.10 全集；无「首期开始月」等复杂字段回潮 | S+M |
| 固定 AA 恰好一次 | 过账→AA 义务实例化/更新恰好一次；删除过账→来源余额+AA 状态回退 | A |
| 居住时长格式 | ≥30 天显示月+日；≥365 天显示年+月+日；无裸天数 | S+M |
| AA 应收/付、还款、结算、撤销 | owed−settled=due；「收到款」去向 saving/ew 入账、cash recordOnly；全额结清→离开未结视图+结算历史+收入投影恰好一次；部分还款显剩余；撤销/删除恢复 未结额/收入投影/目的余额/结算状态 四者；重复确认幂等 | A+F+M |
| AA 历史分页 | 首屏 30 条；Load More 每次+30；切换人/群组/段/tab 分页重置；列表附件仅回形针指示、不展开大图；大图仅详情页 | A+M |
| 编辑历史 | 原→新格式；时间戳 DD/MM/YYYY h:mm AM/PM | A+S |
| 删除回滚 | `reverseTransactionBalanceEffect` 全调用点覆盖 | A |
| 附件 | 上传/查看/清理不丢记录；配额告警触发 | F+M |
| 群组/邀请/授权 | 24DD3 自测全绿：URL 清洗、TTL、防自动接受、原始码不落 D/localStorage/DOM/日志、终态通用文案 | A |
| Telegram：App 手记 AA→TG 总览 | App 创建 AA 后 Telegram 总览/汇总出现该笔且金额正确（受支持工作流） | F+M+P |
| Telegram：固定支出 AA→TG 总览 | `postFixed` 生成的当月 AA 份额出现在 TG 总览 | F+M+P |
| Telegram：结算→TG 汇总 | App 结算确认后 TG 汇总相应清零/减少 | F+M+P |
| Telegram：撤销/删除→TG 汇总 | App 撤销或删除后 TG 侧无陈旧活跃余额 | F+M+P |
| Telegram：重试/防重复 | 双向同步与重试零重复入账（settlement key/`quickEntryId`/`tgSettlementApplied`） | A+F |
| Telegram：partner/群组映射 | `tgPartnerMap` 映射稳定，不重建重复本地人/群组 | A+F |
| 格式 | 全 UI 无 YYYY-MM-DD 与 24 小时残留 | S |
| 语言 | zh/en 全 key 覆盖；无双语并排 | S+M |
| 明/暗 | 每页两模式截图对比 | M+SIM |
| Liquid Glass 回退 | no backdrop-filter / Reduce Transparency / 低端降级三链路 | M |
| 响应式 | SE/15 Pro/Max/iPad 四视口 | M+SIM |
| PWA/Capacitor/iOS | 安装、启动、scheme 深链冷/热启 | SIM+M |
| 离线 | 断网记账→联网同步 | M |
| 加载/错误 | 骨架→内容；失败保留输入 | M |
| 可访问性 | 对比度、Dynamic Type、Reduce Motion | S+M |
| 性能 | 满数据 Activity 滚动 60fps；玻璃层不掉帧 | M |
| 迁移兼容 | 旧 `rm_v3` 包→2.0 读写 roundtrip 无损 | A+F |

---

## 27. Risk Register（风险登记册）

| 风险 | 概率 | 影响 | 预防 | 检测 | 回滚 | 阶段 | Owner |
|---|---|---|---|---|---|---|---|
| 财务计算回归 | 中 | 极高 | 公式冻结+A 档全量数字对照 | qa/fixtures 数值断言 | 回退该阶段 commit | D–J | 实现者+审计档 |
| 迁移损坏 `rm_v3` | 低 | 极高 | Core 期零迁移；store 单一写点 | roundtrip 测试 | `rm_v3_prev`+导出备份 | B–M | store owner |
| 旧本地数据形状意外 | 中 | 高 | `fresh()` 合并语义保留；⑥类审计 | 加载异常遥测 | 兼容分支 | A | 审计 |
| 本地/云分叉（双设备 LWW） | 中 | 高 | 协议不改+UI 显示同步时间 | 手动双设备用例 | `restorePrev` | 持续 | 用户可见 |
| AA/群组重复入账 | 中 | 高 | seenIds/seenLinks 与 `tgSettlementApplied` 语义保留 | 幂等断言 | 撤销链路 | I/J | 域 owner |
| 结算撤销不完全 | 低 | 高 | reversal 链路不重写 | 撤销后余额断言 | 手工修正+报告 | J | 域 owner |
| 卡/债回归 | 中 | 高 | Phase F Extra High 审计 | 卡组 fixture | 回退 | E/F | 审计 |
| 固定过账事故 | 中 | 高 | `lastPaid` 幂等保留 | 同月双过账测试 | 删除该 txn+恢复标记 | I | 域 owner |
| 邀请安全回归 | 低 | 极高 | J 阶段禁改安全层；原样搬运 | 24DD3 全绿 | 立即回退+安全复审 | J/M | 安全审计 |
| 群组授权错显 | 低 | 高 | RLS 假设冻结；UI 不缓存他人数据 | 双账号 SIM 用例 | 回退 | J | 同上 |
| 卡周期规则回归（精确 +30 日历日被误改为月末/次月对应日等） | 低 | 高 | §14.5 规则锁定+周期 QA 六行 | 周期断言 | 回退该 commit | E/F | 审计档 |
| Telegram 契约违约：App AA/固定 AA 未达 TG 总览 | 中 | 高 | §18 六条同步契约行+Worker 接口冻结（改 Worker 前独立接口/审计，且 App 与 Worker 分阶段） | F+P 六项冒烟 | 手动重同步+契约修订 | K（App 侧）/独立 Worker 阶段 | — |
| Telegram 陈旧余额（结算/撤销/删除后 TG 未更新） | 中 | 高 | `tgSettlementApplied`/`aaHiddenSettlementIds` 标记链保留 | 结算→TG 对账用例 | 手动重同步 | K | — |
| Telegram 双向重复入账 | 低 | 高 | 映射键幂等（settlement key/`quickEntryId`/`tgPartnerMap`） | 重试用例 | 删除重复+修正标记 | K | — |
| 性能（满数据/玻璃） | 中 | 中 | 分页+虚拟列表+玻璃白名单 | 帧率检测 | 降级开关 | E/H/L | — |
| 单体抽取误删活体 | 中 | 高 | 死块对照清单；整链退役而非逐函数 | 全页冒烟+fixtures | 回退 | M | 审计 |
| PWA/原生行为差异 | 中 | 中 | §28 边界表；不在 PWA 承诺原生能力 | SIM+浏览器双跑 | — | C/持续 | — |
| 视觉不一致回潮 | 中 | 中 | tokens 单源+§16 清单 | 静态扫描未登记 hex | — | L | 设计审 |
| AI/模板外观 | 中 | 高（产品目标失败） | §16 每阶段强制 | 用户截图验收 | 返工该页 | 全部 | 用户 |
| 范围蔓延 | 高 | 中 | §8 边界+新数据域禁入 Core | 阶段范围审查 | 砍回 | 全部 | 用户 |

---

## 28. PWA / Capacitor / Native Boundaries（边界）

现状：PWA=manifest-only（无 service worker、meta no-store→无离线）；Capacitor=最小壳（App/Browser 插件、`ringgitme` scheme、无 Universal Links、无推送/相机/存储插件）。

| 能力 | PWA | Capacitor 现壳 | 原生增强路径 |
|---|---|---|---|
| 全部财务/资产/共享账本/时间流 | ✅ | ✅（同一 web 包） | — |
| 深链 | `?invite=` ✅ | `ringgitme://invite/` ✅ | Universal Links（需 associated domains + 托管 AASA）→ 邀请链接可用 https |
| 收据上传 | 文件选择 ✅ | 同 | 原生相机扫描（2.2） |
| 通知 | 浏览器通知（受限，iOS PWA 需安装到主屏） | 无插件=无 | `@capacitor/push-notifications` + 本地通知（2.2） |
| 离线 | 需新增 service worker（precache 壳+运行时缓存 CDN；注意现 no-store meta 与 CDN 依赖 Tabler/fonts/supabase-js 需自托管） | 原生包内资源天然离线 | — |
| Live Activity/Dynamic Island/widgets/Share Extension/App Intents | ❌ 不承诺 | ❌ 需原生目标 | 2.2 专项 |
| 触觉 | Vibration API 有限 | 有限 | Haptics 插件（2.2） |
| 安全存储 | localStorage | 同 | Keychain 插件（2.2，迁 `rm_pin_hash` 等） |
| Liquid Glass | `backdrop-filter` 近似 ✅ | 同 | 原生 bar 材质（远期） |

规则：功能开关按能力探测（`isNativeCapacitorIOS2` 模式推广），PWA 界面绝不出现只有原生才能完成的承诺。

---

## 29. Future Game Ledger / 牌局账本（QR 加入）

主重设计之后（2.3+）。核心设计约束：

- **复用一套邀请生命周期**：邀请码 / 深链 / QR 是同一 24D 凭证的三种呈现——QR 内容即 `ringgitme://invite/<code>`（或 Universal Link 版），沿用 `generateInviteCode24DD`→`invite_member` 链路与全部终态/防泄漏规则；不为 QR 另造凭证。
- 数据：复用 `shared_ledgers`（`ledger_kind` 扩展 `game` 值——③类兼容扩展，需 24D owner 确认 kind 枚举策略）、`shared_entries/lines`（每局一 entry，lines 和必须为 0——客户端与 RPC 双侧校验，如 `Winner +100 / Abi −50 / Aya −50`）、累计余额跨局累加、结算走 `record_settlement`+reopen/reverse 现有生命周期。
- 规则：非零和不可保存；牌局记录与日常消费分流（`sourceType:'game_session'`，Activity 默认过滤）；只有确认收款后才生成真实财务记录（收款去向 savings/eWallet，复用群组还款账户逻辑）；双向确认沿用 `mark_line_paid`→`confirm_line_received`；争议=拒确认+备注。
- 界面：建群（type:game）→ 开局 → QR 出示/扫码加入 → 成员确认 → 每局录分（和为零校验实时显示）→ 累计榜 → 优化结算建议（最少转账次数）→ 收款确认 → 历史/撤销。
- 隐私与离线：QR 不含任何个人数据；离线可记局、联网后按 revision 协议提交。

---

## 30. Open Decisions（待用户决策）

| # | 决策 | 建议 | 备选 | 代价/延迟后果 |
|---|---|---|---|---|
| 1 | 五区中 Ledger 与 Activity 的图标与中文名最终定名（账本/往来；动态/记录） | 账本+动态 | 往来+记录 | 低；Phase C 前定即可 |
| 2 | fixed 不占一级 tab（本蓝图方案）是否接受 | 接受（Today 入口+Radar 二级） | 保留第五 tab 给 Radar、Ledger 并入 Activity | 影响 Phase C 全局；开工前必须定 |
| 3 | Today 主数字默认态 | 可用现金 | 净资产 | 低；D 阶段可改 |
| 4 | `Space Grotesk` 品牌数字体去留 | 退役，改 SF Pro tabular-nums（更原生、少一个 CDN 依赖） | 保留仅用于 Money Pulse 主数字 | 低；B 阶段前定 |
| 5 | 双语副题白名单范围 | 仅 eWallet/PayLater/AA 等无自然中文术语 | 全部单语 | 低 |
| 6 | 卡面真实艺术资产补齐（`REAL_ASSETS_TODO.md` 清单需用户提供合法 PNG） | 先用现有 5 张 Maybank+克制回退面上线 | 等资产齐再做 Deck | E 阶段可先行，不阻塞 |
| 7 | 邀请链接的 https 形态（Universal Links）是否纳入 2.0 | 纳入 Delta Intake 审计后决定（需域名+AASA 托管） | 继续仅 `?invite=`+scheme | 影响分享体验；可后补 |
| 8 | 音效默认开关 | 默认关（现状 `soundOn:false`） | 默认开 | 低 |
| 9 | 旧 `rm_supa_url/key` 自定义云配置入口去留 | 隐藏进诊断页（硬编码 SUPA_URL 已是事实） | 移除 | 低 |
| 10 | 2.0 验收的截图评审形式 | 每阶段明+暗双截图包 | 仅关键页 | 影响验收节奏 |

以上均已给出明确建议；不因待决而阻塞 Phase 0–B。

---

## 31. Exact First Implementation Phase（第一实现阶段精确定义）

**Phase 0 — FINAL PHASE 24D DELTA INTAKE**（§23 全文即其规格）。

- 输入：24D 最终验收 commit 号（用户/Codex 提供）。
- 产物：`work/reports/PHASE0_DELTA_INTAKE_REPORT_<date>.md` + 更新版 §18/§20/§26 附表 + 新分支 `wip/ringgitme-2.0-core`。
- 通过标准：无未解释 diff；矩阵/冻结表/QA 表三者与最终 HEAD 一致；蓝图冲突项全部标注消解结果。
- 停机条件：发现未审计的安全/财务行为变更、或 D3C 恢复引入未知 harness 依赖。
- 模型档：实现 High / 审计 Extra High（§25）。

---

## 32. 2.0 Acceptance Definition（验收定义）

全部满足才算 RinggitMe 2.0 验收通过：

1. §18 矩阵零丢失（每行在最终报告有验证记录）；
2. §26 QA 矩阵财务/邀请两域全绿，其余域无未解释红项；
3. 邀请/授权零回归（24DD3 断言全绿 + 双账号 SIM 用例通过）；
4. 宽视角密度达标（§14 各页首屏清单实测满足）;
5. 五区导航（或 §30-2 用户选定变体）全线可用，深链直达正确页；
6. Ringgit Deck 双模式 + 上下文跟随可用；Money Pulse 指标集齐且数值与函数一致；
7. Smart Capture 四要素 ≤5 秒完成一笔；
8. Activity 满数据流畅（60fps 目标）+ 编辑历史统一格式；
9. Commitment Radar 与 Shared Ledger 完整迁移；
10. 明/暗双模式全页完成；Liquid Glass 仅限白名单表面且三级回退可用；
11. §16 反 AI 清单最终全页通过 + 用户截图验收签字；
12. 排版/间距/图标全部 token 化（静态扫描无未登记值）；
13. 可访问性四项（对比度/Dynamic Type/Reduce Motion/Reduce Transparency）通过；
14. PWA 与 Capacitor 双载体回归通过；原生扩展路径（§28）未被破坏；
15. 信用卡周期规则按已验证实现保留：结清→首笔新消费建周期、到期＝起点后**恰好 30 个日历日**（`addDaysISO(start,30)`；可能巧合落在次月同号数，但「次月对应日」不是独立规则）；删除首消费、月末、二月/闰年边界 QA 按精确 +30 日历日结果全绿——全 App 无「月末到期」或「次月对应日」误述；
16. Money Pulse 完整钱况集（§14.1 定义）逐指标与对应函数值一致，My Fixed 恒为自付份额（RM1,312 平分→RM656 用例通过）；
17. 固定支出简化表单（§14.10 字段集）落地，过账/删除/AA 恰好一次/四状态标/时长格式全部通过；
18. 「收到款」流与 AA 历史分页（30+Load More+重置+回形针指示）按 §14.12 验收，撤销四项恢复与重复确认幂等通过；
19. Telegram 六条同步契约 QA 行全绿（App AA→TG、固定 AA→TG、结算→TG、撤销/删除→TG、防重复、身份映射）；
20. 信用卡建卡/编辑表单为 §14.5 简化字段集：Statement Balance/Statement Date/Minimum Payment 不在普通表单，派生值只读，无 CVV/完整卡号；
21. 全部阶段报告+commit 边界+回滚记录齐备。

---

## 33. Evidence Index（证据索引）

- `index.html`：总行数 12,424；script 块边界 20/462/1015/4622/4624/4805/4808/12421；`fresh()` L1278；`SUPA_URL` L1285；同步 L1296–1303；IOS2 OAuth L1306–1361；LOCK L1389；财务函数群 L1506–1560；键盘 L1626；spend modal L2015；settings modal L2030；`renderHome` L2050；`renderCards` L2094；FAB L2225–2346；`render()`/TABS L2365–2404；Shortcut 直连 L2855+；Telegram L3185+；死块活副本 `telegramFiles15` L4505；`postFixed` L6522；分析 L6869；对象账本 18_7 系列 L6982–9560；fixed 20_7A L7356；deck 8 代 L9558–9761;19_0/19B 回归器 L9761–9913；20_x 系列 L9988–10250；23B/23C L10469–10607；24B/24BB/24CC/24CD/24CE/24CH L10645–11000；24DC 身份 L11026+；24DD 邀请 L11462+；24DD3 深链 L12101+；自测 L12235–12283。
- `supabase/migrations/24d/README.md`：架构、H1–H3/M1–M3、D1 RPC 边界、scratch 验证记录（11–12/07/2026）、RLS/DEFINER 模型、005 preflight。
- `supabase/migrations/24d/001` L59–395 建表 13 张；`003` L5–1006 RPC 12 个；`005` L80–893 邀请 6 RPC。
- 其余：`capacitor.config.json`、`package.json`、`manifest.json`、`ios/App/App/Info.plist`（URL scheme）、`assets/*`、`REAL_ASSETS_TODO.md`、`work/reports/` 4 份 iOS 报告。

## 34. Remaining Unknowns（遗留未知）

1. `RINGGITME_FULL_AZ_MVP_RECOVERY_AUDIT_20260712.md` 在审计时点未见于本会话可访问路径（当前 worktree、原始 worktree 已检查位置、仓库已跟踪树）——不主张其全局不存在；列为 Phase 0 证据收集项，若取得则并入 Phase 0 报告。
2. Telegram Worker（`ringgitme-bot-v2`）源码与部署配置不在仓库：其命令面、附件代理安全、`quick_entries` 写入路径需在 Delta Intake 或独立审计中冻结。
3. 24D 之前的全部生产 SQL（旧表/旧 RPC/其 RLS）无仓库副本——生产库真实对象清单未经本审计验证。
4. 共享额度池的确切字段名与计算细节、`personLedgers` vs `personLedgerItems` 关系、`D.uid/D.apply/D.test` 用途——Phase A 定点审计（本审计仅确认存在与调用面）。
5. 8 代 deck/4 代 fixed 行的「运行时最终活代」是静态推断（最后定义覆盖前者），Phase E/I 开工时需运行时确认。
6. `delCard` 删除信用卡时对关联 txns/分期的确切处理未逐行核验（§14.5 已要求先审计再迁移）。
7. Phase 24D-D3C（Scratch harness 恢复）事件在本蓝图任务范围之外，由 Codex 另行处理；本蓝图未采纳任何未经验证的 harness 结论，其最终验收结果只能经 §23 Delta Intake Gate 进入 2.0 基线。
8. 生产 Supabase 是否已部署 24D 001–005：README 明确「未部署生产」，以 Delta Intake 时点实况为准。

---

RINGGITME 2.0 MASTER BLUEPRINT COMPLETE — READY FOR PHASED IMPLEMENTATION
