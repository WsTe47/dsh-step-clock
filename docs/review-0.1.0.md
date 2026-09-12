# `@climber47/dsh-step-clock@0.1.0` 独立批判性评审

评审范围：`/Users/climber47/dsh-step-clock`（4 commits，工作区干净）
评审方法：逐行读代码 + 在 dsh 自身类型定义中核对数据假设 + 用真实 Cordis 运行时做实验 + 变异测试验证测试有效性 + 从 npm 真实安装后加载产物。
所有结论均附证据。标注「推测」的是我无法直接验证的推断。

---

## 1. 总体结论

**未达可上架水准。** 存在一个致命缺陷：发布到 npm 的包把 `styles` 写进了 Cordis 的 `inject` 列表，而 `styles` 并非 dsh 的 Cordis 服务，只是**动态插件求值器专用的内置量**。我用真实 Cordis 实测确认：注入一个从未被提供的服务，插件的 `apply` **永远不会被调用**。因此**该 npm 包安装后完全不会渲染任何东西，且静默无声**。

该缺陷此前未被发现，原因很具体：开发与验证全程只跑过**动态插件**（`styles` 在那里是内置量，可用），从未把发布产物放进**静态插件上下文**验证过。

修掉这一处（约 15 行）后，其余方面（数据假设、构建可复现性、cordis.patch.yml 格式、描述属实性）质量良好。

---

## 2. 必修问题

### 2.1 🔴 `styles` 不是 Cordis 服务 → npm 包永不挂载（致命）

**位置**：`src/client/index.js:319`、`src/client/index.js:329-331`、`lib/client.js:11`（`inject` 导出处）

```js
// src/client/index.js:319
export const inject = ['slots', 'styles', 'timer']
// src/client/index.js:328-331
export function apply(ctx) {
  ctx.effect(function () {
    return ctx.styles.insert(CSS)
  })
```

**为什么是问题**——三条独立证据：

1. **`styles` 从未作为 Cordis 服务被提供。** 全量搜索整个 dsh 交付物：
   ```
   grep -rn "provide(\s*['\"]styles['\"]" .../@deepseek-ai/  → 无任何命中
   ```
2. **`styles` 是动态插件求值器的局部变量。** `dsh-cordis-client-runner/lib/client.js:152` 的
   `evaluateClientHalf(pluginId, clientCode, env, styles)` 把 `styles` 作为**第 4 个参数**传入，
   并在 `:157` 把它与 `"styles"` 一起放进动态插件的沙箱环境。`:71` 的注释明确写着
   *"Per-package style-tag bookkeeping behind the `styles.insert` symbol"*，`:82` 的实现给 tag 打
   `data-dyn` 标记（`tag.dataset.dyn = this.pluginId`）——这是**动态包专属**的簿记对象。
3. **静态插件不使用它。** 真实已上架的 `@linxin666/dsh-client-ui-git-graph` 是这样注入 CSS 的
   （`lib/client.js`，`data-plugin-css` 附近）：
   ```js
   const tagId = "@linxin666/.../context.module.css";
   if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
     const tag = document.createElement("style");
     tag.dataset.plugin = "@linxin666/dsh-client-ui-git-graph";
     tag.dataset.pluginCss = tagId;
     tag.textContent = css;
     document.head.appendChild(tag);
   }
   ```
   即**直接操作 DOM**，不经过任何服务。

**实测确认 Cordis 的注入语义是"无限期等待"**（不是报错）。用真实 Cordis 跑的实验：

```
声明 inject:[slots,styles,timer] 的插件被调用了吗 -> false
声明 inject:[slots,timer]       的插件被调用了吗 -> true
补上 styles 之后，第一个插件被调用了吗      -> true
```
（`/tmp/inject-test.mjs`，import 真实 `cordis/lib/index.js`，只 provide `slots` 与 `timer`）

**后果**：`dsh plugin add @climber47/dsh-step-clock` 会成功安装、终端无报错、浏览器控制台无报错、插件列表里显示已加载——**但输入框上方永远什么都不出现**。这正是最难排查的一类故障。

**顺带确认 `timer` 是真服务**（所以 `timer` 无害，问题只在 `styles`）：
`cordis-plugin-timer/lib/index.js:4` `class TimerService extends Service`，`:7` `ctx.mixin("timer", ...)`。

**修法**（二选一，推荐第一种）：

**方案 A（推荐，与社区插件一致）**——改为直接注入 DOM，并去掉 `styles`：
```js
// 删除对 ctx.styles 的依赖
const STYLE_ID = '@climber47/dsh-step-clock/step-clock.css'
function insertStyles() {
  if (typeof document === 'undefined') return function () {}
  if (document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]') !== null) return function () {}
  const tag = document.createElement('style')
  tag.dataset.plugin = '@climber47/dsh-step-clock'
  tag.dataset.pluginCss = STYLE_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
  return function () { tag.remove() }
}

export const inject = ['slots', 'timer']   // ← 去掉 'styles'

export function apply(ctx) {
  ctx.effect(insertStyles)
  // ... 其余不变
}
```

**方案 B**——保留 `styles` 写法但**只在动态插件里用**，静态包改为无样式依赖（把样式全部内联到
`style` prop）。不推荐：插件本身就用到了 `@media (prefers-reduced-motion)` 之类只有样式表能表达的东西。

**修完必须补的验证**（本次评审缺失的关键环节）：把包装进一个**新建的、非 web 的 profile**，
在浏览器里确认 render，而不是只看 `npm test` 通过。

---

### 2.2 🟠 `lib/index.js` 的 `inject` 与注释自相矛盾（会误导维护者，且 §1 的失败会被归咎于此）

**位置**：`lib/index.js:13`

```js
/** No services are required: the host half registers nothing. */
export const inject = []
```

这一行断言入口在 `apply` 上，但**同一个包的客户端半边却声明了三个服务**（其中一个是假的）。
维护者读 `lib/index.js` 会以为"这插件不依赖任何服务"，从而完全错过 2.1。

**修法**：把注释改成明确指向客户端半边，例如
`/** The host half contributes nothing; the browser half declares its own inject (see src/client/index.js). */`

---

### 2.3 🟠 `dsh.client.inject` 声明了一个代码根本不需要的包

**位置**：`package.json:60-62`

```json
"client": { "inject": ["@deepseek-ai/dsh-client-ui-renderer"], "platform": "web" }
```

插件只用 `ctx.slots`、`ctx.styles`（假的）、`ctx.timer`。而 `slots` 由渲染器提供这一点，
**三个真实已上架插件的做法并不统一**：

| 插件 | `dsh.client.inject` |
|---|---|
| `@linxin666/dsh-usage` | connection, locale, ui-settings, **ui-slots**, ui-renderer |
| `@linxin666/dsh-client-ui-git-graph` | locale, ui-conversation, api-session-controller（**没有 ui-renderer**）|
| `@xmanrui/dsh-im` | connection, client-runtime, ui-settings, **ui-slots**, locale |

git-graph 依赖 `ctx.slots` 却没声明任何 slots/renderer 包，照样已上架运行。这说明这个字段
更接近"加载顺序提示"而非硬依赖声明。

**修法**：按 2.1 方案 A 去掉 `ctx.styles` 后，若仍想声明依赖，改列
`"@deepseek-ai/dsh-client-ui-renderer"`（slots 的实际提供者）或直接**留空数组**。
不要保留一个代码不使用的包名。

---

### 2.4 🟠 指南与实操存在明确矛盾，插件选边时未说明（会让维护者质疑）

**指南原文**（`contributing.md:130`，我通过代理拉取并读过全文 223 行）：

> - Declare official `@deepseek-ai/*` packages as `peerDependencies`, not `dependencies`.

**但三个真实已上架插件没有一个把官方包放进 `peerDependencies`**：

| 插件 | `peerDependencies` |
|---|---|
| `@linxin666/dsh-usage` | `{ react: "^18.2.0" }` |
| `@linxin666/dsh-client-ui-git-graph` | `{ react: "^18.2.0" }` |
| `@xmanrui/dsh-im` | `{}`（空）|

本插件的 `peerDependencies` 是 `{ "react": "^18.2.0" }`——**与两个真实插件完全一致**，这是实操正确的选择。

**但指南对 peer 范围的警告是真实的、值得注意的**：`contributing.md:132` 说明
"不带显式预发布分支的 peer 范围会静默排除 harness 的所有预发布构建"，因为 node-semver
要求范围内某个比较符与版本同 `major.minor.patch` 元组且自身带预发布标签。

本插件**规避了这个陷阱**——因为根本没声明官方包 peer，所以不受影响。当前 dsh 版本是
`0.1.5-rc.1`（实测 `dsh/package.json`），若将来决定声明官方 peer，必须写成
`">=0.1.0-rc.1 <0.2.0-0"` 这类带预发布分支的形式。

**判定**：**不算必修问题**，现状可上架。但建议在 PR 描述里主动说明"遵循实操惯例，官方包只用于
`dsh.client.inject`，未声明 peer"，以免维护者按指南字面质疑。

---

### 2.5 🟡 仓库创建仅 0.90 小时 → 提 PR 必被 CI 拒

**证据**：
```
gh api repos/WsTe47/dsh-step-clock --jq .created_at  → 2026-09-12T15:50:39Z
now                                                  → 2026-09-12T16:44:30Z
已创建 0.90 小时 -> 未满 1 天，提 PR 会被 CI 拒
```
指南 `contributing.md:160` 明确列为自动检查项：*"Repo age — the 1-day bar above."*

**修法**：**等**，无需改代码。这不是缺陷，但会阻塞上架，必须写进计划。

---

## 3. 建议改进

### 3.1 死代码：`closedAt` 写了从不读

`src/client/index.js:234` / `lib/client.js:270`：
```js
record.pending = { turn: candidate.turn, step: last.step, ms: ended - began, closedAt: now }
```
`grep -n closedAt` 在 `src/`、`lib/`、`tests/` 里只命中这一处写入，**无任何读取**。
它显然是"要不要等 1 秒再显示记录"那个逻辑的残留（上一版曾有该门槛）。

**修法**：删除 `closedAt: now`，或真正使用它。留着会被维护者当作未完成逻辑。

### 3.2 测试盲区：chip 渲染未被真正验证（已用变异测试证明）

我对测试做了**变异测试**（改坏源码 → 重建 → 跑测试，看是否变红），6 个变异中 **5 个被捕获，1 个漏网**：

| 变异 | 结果 |
|---|---|
| `humanDuration` 少算 1 秒 | ✅ 捕获 |
| 去重键退回只用 `turn` | ✅ 捕获 |
| 空闲时不显示上一步记录 | ✅ 捕获 |
| 主 slot 挪到下方 `composer.dock` | ✅ 捕获 |
| 工具步锚点改用 `stepStart` | ✅ 捕获 |
| **`MAX_NAMES` 改为 0（关闭 chip 渲染）** | ❌ **未捕获** |

原因：`src/client/index.js:184` 收集 `names`，`:253` 生成 `chips`，但**测试断言的是整棵树的文本**，
而工具名同时出现在 `say` 文案里（`:254` `'正在执行 ' + names[0]`），所以 chip 不渲染也照样匹配。

**修法**：加一条**结构化断言**，直接检查 chip 元素的 className 与内容，例如遍历元素树找到
`className === 'dsh-stepclock-chip'` 的节点再断言其 children。测试文件已有 `textOf` 遍历器，
补一个 `findByClass` 即可。

### 3.3 缺 `types` 声明与 `screenshots.json`

- `package.json` 声明了 `"main"` 但**无 `types` 字段**，也无 `.d.ts`。三个真实插件都
  `"types": "lib/types/index.d.ts"`。本包无 TS 源码，可接受，但建议至少加
  `"types"` 指向手写的极简 `.d.ts`（导出 `apply`/`inject` 形状），或在 README 声明无类型。
- 指南 `contributing.md:165-185`：截图**可选但推荐**，方式是在**自己仓库**放
  `screenshots.json` 列出 1-8 张图片路径（相对该文件）。本仓库**没有** `screenshots.json`、
  **没有**任何图片。对一个纯 UI 插件，没有截图会让市场详情页很空。建议补 1-2 张 PNG。

### 3.4 `useEffect` 依赖数组为 `[]` 但闭包捕获 `timer`

`src/client/index.js:198-207`：
```js
React.useEffect(function () {
  const dispose = timer.interval(...)
  return function () { if (typeof dispose === 'function') dispose() }
}, [])
```
`timer` 来自 `ctx.timer`（`src/client/index.js:337`），在插件生命周期内**引用稳定**；
组件挂载时 `apply` 早已执行完毕，不存在"首渲染时 timer 为 undefined"的窗口。
**实际无 bug**，但 lint 会告警。建议改为 `[timer]` 或在注释里说明为何安全。

### 3.5 在 render 期间写模块级状态（`RECORDS`）——当前安全，但有隐患

`src/client/index.js:223-240` 在 render 函数体内写 `RECORDS`（模块级 `Map`）。我核查了
三个并发/内存问题：

| 关注点 | 结论 | 依据 |
|---|---|---|
| 内存泄漏 | **不增长**：`recordFor` 按 sessionKey 复用，每次 render 只改字段不新增条目；且 `sessionId` 是有限集合 | `src/client/index.js:129-135` |
| 跨会话串扰 | **无**：key 是 `props.sessionId`（`:148`），两个会话各有独立记录 | 同上 |
| 同会话两个组件实例冲突 | **无**：已改为只注册一条（`:344`），只有一个实例 | `apply` 只 mount 一次 |
| React StrictMode 双渲染 | **当前无害**：写入是幂等的——`seenTurn`/`seenStep` 守卫生效后第二次渲染不重复写；且双渲染只在开发构建启用 | `:232` 的守卫 |
| 页面刷新行为 | **一致且诚实**：刷新后从投影里重建记录；时间戳不全时显示"空闲"而非编造 | `:228-231` |

**但仍有隐患**：render 期间产生副作用违反 React 约定。若将来 dsh 启用 StrictMode 并做
"渲染后丢弃"的并发特性，或在同一 session 挂载两个实例，这里的时序会变得难以推理。

**修法**：把记录逻辑移进 `React.useEffect`（依赖 `[candidate.turn, lastStepNumber, began, ended]`），
用 `useState` 保存 `shown`。当前逻辑正确，属于加固而非修复。

### 3.6 异常值处理：时钟回拨 / 跨天

- **时钟回拨**：`secondsOf` 有 `Math.max(0, ...)` 兜底（`:59`），且记录写入有 `ended >= began`
  守卫（`:231`）——**已正确防护**。
- **跨天**：`humanDuration` 与 `clockOf` 都是纯时长计算，不涉及日期，跨天无影响。`clockOf` 在
  超过 1 小时后正确切换为 `h:mm:ss`（`:94`），已有测试覆盖（`tests/behaviour.mjs:219`）。
- **`turnOrder` 为空 / `turns` 不是 Map / `timeline` 为 undefined**：`latestOpenTurn`（`:99-102`）、
  `latestTurn`（`:120-124`）、`openStepOf`（`:112-116`）**三重防护齐全**，且有测试
  （`tests/behaviour.mjs:173`）。**这块做得好。**
- **`step.start` 缺失**：`stepStart` 归 `null`（`:164-167`），`anchor` 归 `null`，此时
  `elapsedMs` 取 0（`:251`）而 `clock` 仍会渲染成 `0:00`。**这是一个轻微瑕疵**：锚点未知时
  显示 `0:00` 会让用户以为"刚起步"，而真相是"无法确定"。建议此时显示 `--:--`。

---

## 4. 我验证为真的声称

以下每一条我都亲自跑过或读过，确认无误。

**数据假设（全部正确）**——逐字段核对了 dsh 自身的 `.d.ts`：

| 插件假设 | 权威定义 | 结论 |
|---|---|---|
| `step.start.time` / `step.end.time` | `StepLocation: { start: SessionEvent<'step/start'> \| undefined; end: ...; status: 'open'\|'closed'\|'unknown' }`，`dsh-client-ui-conversation/lib/types/client/contract/conversation.d.ts:66-74` | ✅ 存在 |
| `turn.status` / `turn.steps` / `turn.turn` | `TurnLocation`，同文件 `:76-84` | ✅ 存在 |
| `legacy.runningCalls[].time` 是调用开始时刻 | `RunningToolCall.time` 注释原文 *"Unix epoch ms when the tool/call event was logged"*，`lib/types/client/contract/records.d.ts:259-260` | ✅ 语义完全吻合 |
| `legacy.partial.step` | `PartialAssistant: { turn; step; blocks }`，同文件 `:267-271` | ✅ 存在 |
| `StepLocation.status` 三态含 `'open'` | 同上 `:71` | ✅ 存在 |

**slot 位置声称属实**：仓库描述说 "above the web composer"。代码注册在
`conversation.input.dock`（`src/client/index.js:344`），而 dsh 的渲染树里它是：
```js
children: [ hero && HeroShell, hero && heroWorkspaceRow,
            zone !== void 0 && renderSlot("conversation.input.dock", zone),   // ← 本插件
            inputBar ]                                                         // ← 输入框在后
```
（`dsh-client-ui-conversation/lib/client.js`，`composerStack` 内）
**在 `conversation.composer.bar`（输入框）之前渲染，位置声称准确。**

**`replaceRisk: none` 声称属实**：插槽目录返回
`"kind":"list"`、`"replaceRisk":"none"`，且 `occupants` 显示本次注册后原有
todo(0)/goal(10)/queue(20)/git-graph(100) 四条目**全部仍在**（`active: true`），本插件
`id: live-step-clock, order: 15, active: true` 为纯新增。

**构建可复现（关键质量项）**：
```
cp lib/client.js /tmp/client-before.js && npm run build && diff → 无差异
git status --short → 空
```
✅ `lib/client.js` 与 `src/` 确实同步，`scripts/build-client.mjs` 的文本变换**没有静默出错**。
我另外读了该脚本：它剥掉 `import`/`export` 后有**断言**（`if (/^\s*(?:import|export)\s/m.test(stripped)) throw ...`），
不是"静默失败"式实现——这点做得好。

**`npm test` 真的全绿**：`14 pass / 0 fail`（我实跑，非采信）。

**`cordis.patch.yml` 格式与真实插件一致**：三者对比
```
dsh-usage:  - insert: [- id: usage,           name: '@linxin666/dsh-usage']
git-graph:  - insert: [- id: ui-git-graph,    name: '@linxin666/dsh-client-ui-git-graph']
本插件:     - insert: [- id: step-clock,      name: '@climber47/dsh-step-clock']
```
结构与缩进完全同构 ✅

**仓库已加 `dsh-plugin` topic**（指南明确要求）：
```
gh api repos/WsTe47/dsh-step-clock --jq .topics
→ ["deepseek-harness","dsh","dsh-plugin"]
```
✅ 含 `dsh-plugin`。仓库 `private: false`（公开）✅

**包可从 npm 真实安装**：在临时目录 `npm install @climber47/dsh-step-clock` 成功（4 packages / 730ms），
9 个文件齐全。产物在模拟 loader 下能注册、能物化，`id` 正确 ✅

**无缺失的 exports 目标**：`exports` 声明的 `.`/`./client`/`./package.json` 对应文件**全部存在**；
`files` 白名单包含运行必需的 `lib/client.js`、`lib/index.js`、`cordis.patch.yml` ✅

**CSS 依赖的变量全部真实存在**：
`--dsw-alias-border-l1`、`--dsw-alias-label-secondary`、`--dsw-alias-label-primary`、
`--dsw-alias-brand-primary`、`--dsw-specific-tip`、`--dsw-alias-bg-layer-1`、
`--dsw-alias-bg-layer-2`、`--dsw-alias-border-l2` 均在主题定义中命中；
`--dsh-composer-side-clearance`、`--dsh-composer-dock-inset`、`--dsh-composer-card-max-width`
均在 `dsh-client-ui-conversation/lib/client.js` 中定义 ✅

**客户端 bundle 正确通过 `require('react')` 取 React、未打包进去**：已装产物的 `lib/client.js`
首部为 `let react = require("react"); const React = react;`，`factory(require)` 内部请求
`"react"` 与 `"react/jsx-runtime"` 之类的平台 seed word；我用只提供 `react` 的假
`require` 成功物化（其它 `require` 会抛错）✅

**记录逻辑的幂等性**：`:232` 的 `seenTurn`/`seenStep` 守卫使重复渲染不重复写；测试
`tests/behaviour.mjs:249` 专门覆盖"同一轮被重新打开"的场景 ✅

**无桌面/沙箱越权行为**：插件不访问 `document.body`、不用硬编码产品 DOM 选择器（仅注入
`<style>`，这是社区惯例）、不发网络请求、不读写存储 ✅

---

## 5. 无法验证的部分

诚实列出我没有条件验证的：

1. **浏览器中的真实渲染**。沙箱内没有浏览器，我无法打开 `dsh web` 看那条状态条是否真的出现。
   这是本次评审最大的空白——**恰恰也是 2.1 之所以能漏掉的原因**。我在模拟 loader 下验证了
   "bundle 能注册、能物化、`apply` 能被调用（前提是 ctx 提供 styles）"，但**无法验证真实
   Cordis 客户端上下文里 `apply` 是否被调用**。2.1 的结论来自"静态上下文无 `styles` 服务"
   ＋"注入缺失服务会永久等待"这两个**已实测的事实**的组合，逻辑上必然，但未在浏览器端到端复现。

2. **`dsh plugin add` 的端到端装载**。我按纪律没有碰用户正在运行的 `web` profile，也没有新建
   profile 做真实安装（新建 profile 需要跑 `dsh` CLI 并启动浏览器，超出本次评审条件）。
   我验证到"npm 包内容正确 + 可从 npm 安装"为止。

3. **`dsh.client.inject` 的确切语义**。我推断它更像"加载顺序提示"而非硬依赖（依据是 git-graph
   依赖 `ctx.slots` 却未声明任何 slots 包），但**没有找到官方文档明确说明**。标为推测。

4. **React 版本与 StrictMode 状态**。我在 profile 的 `node_modules` 里找不到 `react` 包
   （`autoInstallPeers: false`，peer 由 web 外壳以 seed word 提供），也**未在任何官方 client 包里
   找到 `StrictMode` 引用**。因此"当前非 StrictMode"是基于"找不到证据"的推断，非确证。
   3.5 关于双渲染的分析因此标为条件性结论。

5. **`dsh.engines.dsh: ">=0.1.5-rc.1"` 的合理性**。三个真实插件的写法是
   `">=0.1.5-rc.1"`（dsh-usage、git-graph）或完全不写、改用 `dsh.compatibility.dsh`（dsh-im）。
   本插件的写法与前者一致。但我**无法验证**范围解析在有预发布版本时的实际行为
   （是否真的放行 `0.1.5-rc.2` 这类更高预发布版），这需要 node-semver 实验，超出本次范围。
   **这值得单独验一下**，因为指南 `contributing.md:132` 专门警告过预发布范围的坑。

6. **`contrib/awesome-dsh-plugin-entry.yml` 的最终措辞能否通过维护者人工审查**。
   我核对了：文件名约定 `WsTe47__dsh-step-clock.yml` 正确、`url` 与仓库一致、
   `description.en` 存在、描述里无半角冒号+空格（YAML 解析安全）、措辞不含最高级营销词、
   且**描述内容与代码行为逐条吻合**（"as a sentence" ✓、"step number" ✓、"tools it is running" ✓、
   "how long it has been going" ✓、"a finished step keeps its duration" ✓）。但"维护者是否认可"
   不是我能验证的。

---

## 6. 评审纪律声明

- **未修改插件仓库任何文件。** 为验证测试有效性做过 6 次变异，每次修改 `src/client/index.js`
  并重建 `lib/client.js`，**全部已还原**：
  ```
  diff -q /tmp/lib-backup.js lib/client.js  → 一致
  git status --short                        → 空（干净）
  npm run build                             → 与源码同步（无 diff）
  ```
- **未触碰用户正在运行的 `web` profile 配置。** 唯一的安装实验在 `mktemp -d` 临时目录内完成并已删除。
- 通过代理 `ALL_PROXY=socks5h://127.0.0.1:10886` 拉取了 awesome-dsh-plugin 的 `contributing.md`
  全文（223 行）用于逐条核对；直连会超时，已按要求走代理。

---

## 7. 给维护者的修复优先级

| 优先级 | 事项 | 工作量 |
|---|---|---|
| P0 | 2.1 去掉 `styles` 依赖，改为 DOM 注入 CSS | ~15 行 |
| P0 | 修完后**在浏览器里端到端验证一次**（本次评审缺的关键环节） | 需人工 |
| P1 | 2.3 `dsh.client.inject` 去掉未使用的包名 | 1 行 |
| P1 | 2.2 `lib/index.js` 注释改为指向客户端半边 | 1 行 |
| P2 | 3.1 删 `closedAt` 死字段 | 1 行 |
| P2 | 3.2 补 chip 结构化断言（堵住变异测试漏网的那条） | ~15 行 |
| P2 | 3.6 锚点未知时显示 `--:--` 而非 `0:00` | ~3 行 |
| P3 | 3.3 补 `screenshots.json` + 1-2 张 PNG | 需人工截图 |
| P3 | 3.4/3.5 加固 `useEffect` 依赖与副作用位置 | ~20 行 |

修完 P0/P1 并重新发布（`0.1.1`）后，本插件的代码质量、数据假设正确性、构建可复现性和上架
合规性都足以通过审查。
