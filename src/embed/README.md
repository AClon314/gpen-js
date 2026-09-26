# 多目标构建（userscript / browser-ext / npm / vscode）与自动化测试　可行性方案

> 状态：**已实施**（embed 核心 + userscript / browser-ext / vscode 三个壳，各自仓库；统筹脚本 `gpen/scripts/targets.mjs`）。
> 本文保留调研结论、证据、风险与暂缓项；实施细节见各仓库 README 与 `TODO.md`（多目标构建一节）。
> 调研日期：2026-09-13；版本与 peerDependencies 均已实际查询。

## 0. TL;DR

- 目标形态不同，但**只有一个核心**：把 gpen 应用打成框架无关的 **embed bundle**（单文件 JS + 单文件 CSS），
  五类宿主都是薄壳：userscript 头、扩展 manifest+content script、webview HTML、npm exports。
- **userscript 不用 vite-plugin-monkey，自建一个普通 Vite 构建**（已 clone 源码核对，见 §4.2）：它的 dynamic-import 路径会把入口
  打成 **SystemJS** 并内联 SystemJS runtime（`System.register(..., function(_export,_context){...})` 就是你说的
  require() 风格模块注册器）；我们无需要它，只写一份 ~60 行 Vite config + metadata banner。
- **扩展用 WXT**：`wxt@0.21.4`（peer `vite ^8.0.0-0`）默认就是 **Chrome→MV3 / Firefox→MV2 / Safari→MV2**，
  正好等于需求里的 manifest 版本组合。
- **embed 化在技术上已经就绪**（已核对源码）：`src/lib/**` 不依赖 `$app`、不依赖 paraglide、没有动态 `import()`；
  Svelte 5 注入组件 `<style>` 时会看 `anchor.getRootNode()`，命中 ShadowRoot 就注入 ShadowRoot
  （`node_modules/svelte/src/internal/client/dom/css.js:13`），所以「shadow DOM 隔离 + 组件样式自动进 shadow」成立。
- 剩下的是**宿主差异清单**（§5，12 条）与**测试矩阵**（§6）：Linux CI 上可自动化 Chrome MV3 扩展、
  userscript（GM shim）、embed、npm 产物、VS Code Web；Firefox MV2 用「web-ext lint + Gecko 注入跑 content bundle」，
  真·临时安装可作为可选 job；Safari 只能构建 + 静态校验。

## 1. 现状盘点

| 项 | 现状 | 位置 |
| --- | --- | --- |
| 应用构建 | SvelteKit + adapter-static，`bun run build` → `build/`（index.html + `_app/immutable/*`，JS 740K / CSS 188K，多 chunk） | `vite.config.ts` |
| 版本 | `__GPEN_VERSION__` 由 `define` 从 `package.json` 注入 | `vite.config.ts`、`src/gpen-env.d.ts` |
| 存储适配 | `createRuntimeStorage()` 自动探测：GM → VS Code → `browser.storage.local` → 网站（IndexedDB/OPFS） | `src/lib/bindings/storage/index.ts` |
| 跨 tab | `createTabBus`（同源 BroadcastChannel / 跨源 Penpal） | `src/lib/crossTabBus/` |
| VS Code 宿主 | 扩展侧 storage bridge 已实现（kv→Memento，blob→workspace.fs，`gpen.storage.request/response`） | `gpen-vscode-ext/src/extension.ts` |
| 扩展宿主 | 已有 WXT 壳，但 content 里跑的是 zig 版 `sidepanel.js`（非 gpen-js） | `gpen-browser-ext/` |
| CI | 根仓库 `scripts/ci.sh`（protocol → js → zig），只覆盖 protocol/js/zig；ext 子模块是私有仓库，CI 不 clone | `scripts/ci.sh`、`.github/workflows/ci.yml` |
| 测试 | `bun test`（16 文件 105 例）+ Playwright e2e（`tests/e2e/*.e2e.ts`，webserver 起 4173/4174） | `tests/`、`playwright.config.ts` |

**结论**：宿主的「数据面」（存储/协议/消息）已经按多目标设计好了，缺的是「构建面」（打包 + 分发 + 测试）。

## 2. 目标矩阵

| 目标 | 产物 | 打包工具（版本已核） | 宿主环境 | Linux CI 可测 |
| --- | --- | --- | --- | --- |
| embed（内部核心） | `dist/embed/gpen-embed.js`(IIFE+ESM) + `.css` + CSS 字符串出口（`?inline`） | `@sveltejs/vite-plugin-svelte@7` + Tailwind v4 + Vite 8 lib mode | 任意页面 / ShadowRoot | ✅ |
| userscript | `dist/userscript/gpen.user.js`（单文件 classic script，含 metadata block）+ `.meta.js` | **纯 Vite 自建**（IIFE + metadata banner，不用 vite-plugin-monkey） | Tampermonkey/Violentmonkey/ScriptCat | ✅（GM shim 注入真产物） |
| browser-ext Chrome | `dist/extension/chrome-mv3/` | `wxt@0.21.4`（默认 MV3） | 内容脚本 + shadow UI | ✅ Playwright `--load-extension` |
| browser-ext Firefox | `dist/extension/firefox-mv2/` | `wxt@0.21.4`（Firefox 默认 MV2） | 同上 | ⚠️ 部分（lint + Gecko 注入；真装为可选） |
| browser-ext Safari | `dist/extension/safari-mv2/` | `wxt@0.21.4`（Safari 默认 MV2） | 需 macOS 转换 + Xcode | ❌ 只构建 + 静态校验 |
| npm | `dist/npm/**`（ESM + `.d.ts` + exports map） | `vite build --mode lib` 或 `tsc`（建议 rollup 只做 js、tsc 出 d.ts） | 第三方前端工程 | ✅ `npm pack` + 导入/类型冒烟 + publint/attw |
| vscode | `dist/vscode/webview/*` + `.vsix` | 现有扩展仓库 + webview bundle；`@vscode/vsce@3.9.2` / `ovsx@1.2.0` | Webview（Electron / vscode.dev） | ✅ `@vscode/test-web@0.0.81`；桌面版可选 xvfb |

## 3. 总体架构：一个 embed 核心 + 五个薄壳

```
gpen-js/src/（现有应用）
        │  ① vite.embed.config.ts（lib mode, inlineDynamicImports, 单文件）
        ▼
dist/embed/gpen-embed.{js,css}          ← 唯一「真正的应用」，可独立在网页里跑
        ├──────────────► ② userscript 壳：metadata + `?inline` CSS 注入 shadow
        ├──────────────► ③ WXT content 壳：createShadowRootUi + browser.storage
        ├──────────────► ④ vscode webview 壳：acquireVsCodeApi → storage bridge
        └──────────────► ⑤ npm 壳：exports 子路径（storage/crossTabBus/gestures/embed…）

website 目标 = 现有 SvelteKit build（不动；后续可切到 embed 以统一）
```

embed 契约（新文件 `src/embed/index.ts`）：

```ts
export interface GpenEmbedOptions {
  root?: Document | ShadowRoot | HTMLElement; // 默认自建 shadow host 挂到 documentElement
  storage?: StorageOptions;                   // 透传给 createRuntimeStorage
  matches?: string[] | ((url: URL) => boolean);
}
export function mountGpen(options?: GpenEmbedOptions): GpenHandle; // 幂等：已挂载则返回旧 handle
export function unmountGpen(): void;
```

要点：

- **Shadow host 固定契约**：`<div id="gpen-host" data-gpen-overlay-host style="position:absolute;top:0;left:0;width:0;height:0">`
  挂在 `document.documentElement` 末尾（旧扩展挂在 `document.body`，见 `gpen-browser-ext/sidepanel.js:57`）。
  理由：不在 `guessWebLayer()` 的扫描范围内（它只扫 body 直接子元素），也不受宿主
  `body { position:relative / transform / margin }` 影响。
- **CSS 双出口**：`dist/embed/gpen-embed.css`（宿主 `content_scripts.css` 用）+ 源码级 `import css from './embed.css?inline'`
  （userscript/JS 注入 shadow 用）。
- **样式隔离已验证**：Svelte 5 的 `append_styles` 会判断 `anchor.getRootNode()` 是否为 ShadowRoot；
  Tailwind preflight / dockview.css / 组件样式都会跟着进 shadow，不污染宿主页。
- 现有 `:global(html)`, `:global(body)`（`GpenWorkspace.svelte:495`）在 shadow 下自动失效——对宿主页更安全，
  但意味着 website 目标与注入目标的 body 边距行为不同（见 R1）。

## 4. 逐目标方案

### 4.1 embed（中间产物，优先级最高）

- `targets/embed/vite.embed.config.ts`：`@sveltejs/vite-plugin-svelte`（复用 SvelteKit 配置里的
  `compilerOptions.runes/customElement`）+ `tailwindcss()` + `define __GPEN_VERSION__`；
  `build.lib = { entry: src/embed/index.ts, formats: ['es','iife'], name: 'Gpen' }`，
  `rollupOptions.output.inlineDynamicImports = true`（当前源码无动态 import，留作保险）。
- 产物旁挂一个 `targets/embed/harness.html`（dev/preview 用），Playwright 直接测它。
- 体积预算：按现有 build 估算核心 ~400–500K min（~150K gzip）；CI 里加阈值守卫（超了就 fail）。

### 4.2 userscript（自建，不用 vite-plugin-monkey）

已 clone 核对（`/tmp/vite-plugin-monkey`，8.1.1）：

- 有 dynamic `import()` / TLA 时，它把入口交给 Rollup 打成 **`format: 'systemjs'`**，并把 SystemJS runtime
  （`dist/system.min.js` + `dist/extras/named-register.min.js`）内联或经 `@require` 注入
  （`src/node/plugins/buildBundle.ts:174-243`、`src/node/utils/systemjs.ts`）。产物里会出现
  `System.register("./entry.js", [...deps], function (_export, _context) { return { setters: [...], execute: ... } })`
  —— 这就是你说的「require() 那种打包方式」（模块注册器 + 额外 runtime）。
- 它这么做的动机是支持 dynamic import（引擎不允许用户在 userscript 里跑真 ESM，见下）；我们**没有** dynamic import，
  走的是 Vite IIFE 分支（`buildBundle.ts:253-300`），但整条管线仍要跑 acorn-walk 扫 `@grant`、virtualHtml、
  fixWorker、css 注入等十几个插件，依赖含 `systemjs`/`acorn-walk`/`htmlparser2`/`postcss-url`/`cross-spawn`/`open`。
- 它的 GM 客户端（`$` = `vite-plugin-monkey/dist/client`）只服务「从模块里 import GM API」这种写法；
  我们的 `storage/monkey.ts` 是运行时读 `globalThis.GM_*`，**不需要客户端**，只需要正确的 `@grant`。

**引擎限制（关键，不是工具选择问题）**：Violentmonkey 维护者 tophf 在
[violentmonkey#2528](https://github.com/violentmonkey/violentmonkey/issues/2528) 明确说明：浏览器只在 DOM
`<script type="module">` 里支持模块，内容脚本/用户脚本不支持；引擎只能在关掉所有 GM 能力、脚本可被网页劫持的
`@unwrap`（page 注入）模式下才可能开模块。所以：

- **产物必须是自包含的 classic script**（单文件、无顶层 `import`/`export`、无 runtime loader）；
- 「ESM 静态 import」体现在**源码 + 构建期**：源码用标准 ESM 静态 import，Rollup/Vite 在构建期全部解析内联、tree-shake。
  已实测：用 Vite 8 lib IIFE 把 `dockview + moveable + penpal + flatbuffers + svelte` 打成一个文件（588K），
  产物里 `__commonJS` / `__require` / `require(` / `System.register` / `import(` 命中数全为 **0**；
  现有 SvelteKit 产物 `build/_app/immutable/**` 同样零命中 → 我们的依赖集不需要 CJS 互操作垫片。
- 将来若真需要 dynamic import，优先改代码（去掉懒加载），而不是加 loader。

方案：`targets/userscript/` 就是个普通 Vite 构建，产物 = banner + IIFE：

```ts
// targets/userscript/vite.config.ts（草图）
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

const banner = `// ==UserScript==
// @name         GPen
// @namespace    https://github.com/AClon314/gpen
// @version      ${pkg.version}
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @noframes
// @updateURL    <待定>/gpen.meta.js
// @downloadURL  <待定>/gpen.user.js
// ==/UserScript==`;

export default defineConfig({
  define: { __GPEN_VERSION__: JSON.stringify(pkg.version) },
  plugins: [tailwindcss(), svelte({ compilerOptions: { runes, customElement } })],
  build: {
    lib: { entry: 'targets/userscript/main.ts', formats: ['iife'], name: '__gpen__', fileName: () => 'gpen.user.js' },
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,               // 资源全量 data URI，保证单文件
    rollupOptions: { output: { banner } },         // lib+IIFE 天然单 chunk（不需要 inlineDynamicImports）
  },
});
```

```ts
// targets/userscript/main.ts
import css from '../../src/embed/embed.css?inline';
import { mountGpen } from '../../src/embed/index';
mountGpen({ css }); // embed 建 shadow host 并把 <style> 塞进 shadow
```

- **决策（2026-09-13）：不做 `@unwrap` 兼容。** monkey target 固定用沙箱 + `@grant GM_*`（GM KV）。
  原因：GM KV 是唯一同时满足「跨站共享 + 免授权 + 页面不可读」的存储；实测 SAA broker 虽能跨站共享 IDB/OPFS，
  但需要**每个顶层站各授权一次**、且授权后数据对宿主页可读，两个代价都不值得为 @unwrap 付。
  `@unwrap` 的收益（页面世界原生执行、无跨域 realm 语义）不足以抵消；ESM 运行时它也给不了（见 R13）。
- `@grant` **必须手写**：适配器是 `globalThis.GM_setValue` 这种属性访问，不在标识符位置，插件/静态扫描都收不到；
  写错会静默退化成 localStorage（不报错）——测试里要断言“真 GM 存储被调用”。
- `?style`（插件的 Shadow DOM CSS 导入）用原生 `?inline` + 自己 append 即可，能力等价。
- dev 流程：`vite build --watch` + 手动拖一次 `.user.js`（或额外产一个 3 行的 `serve.user.js` 让引擎每帧重定向到本地文件），
  不为了自动打开安装页引入插件。
- `@noframes` 建议保留：否则每个 iframe 都会注入一份悬浮球。

### 4.3 browser extension（WXT）

- 目录 `targets/extension/`（`wxt.config.ts` + `entrypoints/gpen.content.ts`），WXT 项目根放这里，
  依赖用 gpen-js 根 node_modules（bun 向上解析），命令：
  `bunx wxt build -b chrome` / `-b firefox` / `-b safari`，输出 `dist/extension/{chrome-mv3,firefox-mv2,safari-mv2}`。
- content 入口：`createShadowRootUi(ctx, { name:'gpen', cssInjectionMode:'ui', onMount: mountGpen, onRemove: unmountGpen })`，
  WXT 自己管理 host 插入/销毁；`browser.storage.local` 由现有 `storage/browser.ts` 接管（`storage` 权限）。
- manifest：`permissions:['storage']`、`host_permissions:['<all_urls>']`；Firefox 需 `browser_specific_settings.gecko.id`；
  Safari 只出目录，转换必须在 macOS（`xcrun safari-web-extension-converter`），列为不测目标。
- 分发：`bunx wxt zip [-b firefox]` + `wxt submit`（Chrome Web Store / AMO），密钥进 CI secrets，作为 release 阶段。

### 4.4 npm

- 现状 `package.json` 的 `exports` 直接指向 `src/lib/*.ts`（只有 `./storage`、`./upDownloader`、`./storage/vscode`），
  `private: true`，没有 `files`/`types`——只够 `file:` 本地消费，不能发布。
- 目标：`exports` 指向 `dist/npm/**`，`types` 同步；建议子路径：`.`、`./storage`、`./storage/vscode`、
  `./upDownloader`、`./crossTabBus`、`./gestures`、`./canvas`、`./embed`；`sideEffects:false`；
  `files:["dist"]`。
- 产物构建：Vite lib（不进 node_modules 依赖）或 `tsc --emitDeclarationOnly` 出 d.ts；两者都跑。
- 质量门：`publint` + `@arethetypeswrong/cli` + `npm pack` 后在临时工程里 `import` 冒烟（纯 Node/bun + 类型检查）。
- 命名/许可待拍板：根 README 说公开可复用的是 **`gpen-ui-js`（Apache-2.0）**，而当前包名是 `gpen-js`（AGPL 体系）。
  建议：npm 目标只发 `gpen-ui-js`（storage/crossTabBus/gestures/components/embed），应用壳不发。

### 4.5 vscode

- webview 侧：`targets/vscode/webview.ts`（薄壳，nonce + `acquireVsCodeApi` 只调一次并缓存，再 mountGpen），
  产物放扩展 `dist/webview/`，扩展用 `webview.asWebviewUri` + CSP `script-src 'nonce-…'` 加载。
- 扩展侧：`gpen-vscode-ext` 已有 storage bridge（Memento + workspace.fs），只需把 webview HTML 换成真实产物。
- 打包/发布：`vsce package`（`browser` 字段走 web extension 形态，便于 `@vscode/test-web`）、`ovsx publish`。

## 5. 跨目标差异与风险清单（实现前必须过一遍）

| # | 风险 | 证据 | 处理方向 |
| --- | --- | --- | --- |
| R1 | `:global(html),:global(body){margin:0…}` 在 shadow 下失效 | `GpenWorkspace.svelte:495` | 接受（注入目标本就不该改宿主页）；文档标注 website/注入行为差异 |
| R2 | ~~`guessWebLayer()` 会选中自己的 overlay~~ → **已缓解，不用改** | `isHardExcluded` 已硬排除 `.gpen-overlay, [data-version], [data-instance]`（`canvas/webLayer.ts:37`）；实测 `/` 页点击悬浮球后 candidates = `[main, div#svelte-announcer]`，`surface` 里只移动了 `MAIN`，overlay 未被选中。注入目标下 overlay 在 shadow 内，更是扫不到 | 保持：给新加的 embed host 也带上 `data-*` 标记 |
| R3 | dockview popout 用 `location.origin+pathname+#popout-id` 作为 `popoutUrl` | `GpenWorkspace.svelte:168-176,339` | 注入目标禁用 popout（或降级为 floating group） |
| R4 | 严格 CSP 站点可能拦截注入的 inline `<style>` | 生成 shadow 内 `<style>`；扩展 `content_scripts.css` 不受页面 CSP 限制 | 首选 manifest css / `adoptedStyleSheets`；在 CSP 严格站点（如 GitHub）加一条 e2e |
| R5 | GM 沙箱语义：`@grant` 非 none 时 `window` 是代理；`visualViewport`、DOM 手术是否透传 | `storage/monkey.ts` 读全局；`infiniteCanvas.ts` 操作宿主 DOM | 用真 Tampermonkey/Violentmonkey 手测一次；必要时 `unsafeWindow` 取 page window |
| R6 | 存储落点不同：GM 全局 / 扩展 content script 走页面 origin 的 OPFS+IDB / 扩展 origin 不参与 | `storage/{monkey,browser,website}.ts` | 文档化每目标「kv 在哪、blob 在哪」，扩展可考虑升级为 background OPFS |
| R7 | 跨 tab 语义：BroadcastChannel 是「页面 origin」维度，扩展/用户脚本下不等于「脚本全局」 | `crossTabBus/*` | v1 接受；扩展跨站点同步后续用 `storage.onChanged` |
| R8 | 版本单一来源（manifest / `@version` / vsix / `__GPEN_VERSION__`） | `vite.config.ts` define | 统一读 `gpen-js/package.json`，CI 加一致性检查 |
| R9 | 体积预算：userscript 单文件会内联 CSS+JS | 现 build ~740K JS（依赖探查 588K） | CI 阈值；必要时 `?inline` 复用、按需裁 demo |
| R10 | paraglide/i18n 不在 embed 内（仅 layout/app.html 用） | `rg paraglide src/lib` 无命中 | embed 不做 i18n；后续需要再设计消息包 |
| R11 | 未来 WASM：MV3 CSP 需 `wasm-unsafe-eval`；userscript 需要 `@resource`/`GM_addElement` | `gpen-browser-ext/wxt.config.ts` 已有 CSP 先例 | 延后，先在方案里留位 |
| R12 | 不可注入页面（chrome://、Web Store、部分 iframe/about:*） | 浏览器限制 | 黑名单放配置里，测试不覆盖 |
| R14 | 把 iframe storage broker 当「跨站共享/跨站传输」用 | 实测 Chrome 154：**未授权**时同一 broker origin 在两个顶层站下是两份存储（IDB/OPFS 均 empty，BroadcastChannel 互相听不到）；**每个顶层站各自 SAA（storage-access）授权后**，IDB/OPFS 变成共享（A 站读到 B 站写的值），但 **BroadcastChannel 仍分区** | 跨站共享可行，但需逐站用户授权 + 把存储当信箱（轮询/事件）；跨站实时中继仍需顶层 hub 或服务端；且授权后宿主页可驱使 broker → 数据对宿主页可见 |
| R13 | userscript **不能**输出真 ESM（顶层 `import`） | [violentmonkey#2528](https://github.com/violentmonkey/violentmonkey/issues/2528) 维护者：内容脚本/用户脚本不支持模块 | 产物固定为单文件 IIFE（构建期完成 ESM 静态解析）；如需 dynamic import 先改代码 |

## 6. 自动化测试流程设计

分层（下层快、上层真；每层都跑「同一份产物」）：

```
L0 单元/静态     bun test（纯逻辑）+ tsc/typecheck + 产物静态校验（manifest/userscript/npm）
L1 embed e2e     Playwright：harness.html 里 mount/unmount、shadow 隔离、打开工作区、存储往返
L2 每壳 e2e      chrome-mv3（真扩展）/ userscript（GM shim）/ firefox-mv2（Gecko 注入）/ vscode-web
L3 分发校验      web-ext lint、publint、attw、wxt zip、vsce package --no-dependencies
```

具体做法：

- **L1 embed**：`playwright project: embed`，`webServer` 指向 `vite preview` 的 embed harness；
  断言：`#gpen-host` 存在且 shadowRoot 内含 `.gpen-overlay`、`document.head` **没有**被注入 gpen 样式、
  打开工作区后宿主按钮仍可点（穿透回归）、`storage` 往返（reload 后悬浮球位置保持）。
- **L2 chrome-mv3**：Playwright `chromium.launchPersistentContext('', { channel:'chromium', args:['--disable-extensions-except=…','--load-extension=…'] })`。
  必须用 Playwright 自带 Chromium：Google Chrome/Edge 已移除侧载 flag（官方文档明示），
  而现有 `playwright.config.ts` 优先 `/usr/bin/google-chrome`，扩展项目要单独覆盖 `launchOptions`。
  测试点：扩展被加载 → 打开测试页 → shadow 里出现悬浮球 → 打开工作区 → 改 `uiScale` 后 reload 仍生效（`browser.storage.local`）。
- **L2 userscript**：`page.addInitScript` 注入 GM shim（`GM_getValue/setValue/deleteValue/listValues` 用 localStorage 实现）
  → `page.addScriptTag({ content: builtUserJs })` → 同样断言。另加**产物静态断言**：metadata 里有
  `@match *://*/*`、`@grant GM_setValue`、`@version` 与 package.json 一致、文件是单文件无 `import`。
  - 可选的真引擎 job：Violentmonkey 在 GitHub Release 发签名包（v2.49.0：`Violentmonkey-mv3-v2.49.0.zip`，~678K），
    解压后可用 Playwright bundled Chromium `--load-extension` 侧载 → 断言 GM 存储真被调用（覆盖 R5 沙箱语义）。
    **安装路径已踩坑**：现代 Chromium（实测 151）把顶层导航到 `text/javascript`/`text/plain`
    直接当下载（`goto: Download is starting`），VM 的 webRequest 安装拦截不触发；真引擎 job 需要换
    安装通道（VM dashboard 编辑器粘贴 / 预置 VM 存储 / Firefox + `web-ext run`），或改用较老的 Chromium。
    Tampermonkey 只有 Chrome Web Store，不做。
- **L2 firefox-mv2**：
  - 必跑：`web-ext lint --source-dir dist/extension/firefox-mv2`（manifest/API 兼容性）+ 在 Playwright 的
    **Firefox** 里注入同一份 content bundle（带 `browser.storage` shim）跑同一组断言——覆盖 Gecko 引擎差异。
  - **为什么 Firefox 不能用 Playwright 真装扩展（已实测，2026-09）**：Playwright 官方只支持 Chromium
    （`launchPersistentContext` + `--load-extension`）；`playwright-core@1.62.1` 类型里没有任何安装扩展的 API。
    本机对 Playwright Firefox 153 试过三条路全部失败：① `about:debugging#/runtime/this-firefox` **导航超时**（打不开）；
    ② profile 预置 `<profile>/extensions/<id>.xpi`（AMO 已签名 XPI + `xpinstall.signatures.required=false` +
    `extensions.autoDisableScopes=0`）没加载；③ `<firefox-appdir>/distribution/policies.json` 的
    `force_installed` 也没加载。上游 issue [microsoft/playwright#7297](https://github.com/microsoft/playwright/issues/7297)
    有 453 👍，虽标记 completed，评论区至今仍在给 workaround。
    所以「真装扩展」只剩 WebDriver 一条正规路：geckodriver `install_addon(dir, temporary=True)`
    （走 Firefox 的 `installTemporaryAddon`，不需要签名），或社区插件 `playwright-webextext`（同一机制接到 Playwright）。
    两者都只作为**可选 job**（nightly / workflow_dispatch）。
  - **Safari 不属于 Playwright**：Playwright 的 WebKit ≠ Safari（没有 Safari 的扩展 API 与打包流程）；
    Safari 扩展开测只能 macOS + `safaridriver`（或 Xcode 手工），Linux CI 上不可能。
  - 另注：Playwright v1.55 起 **去掉了 Chromium MV2 扩展支持**（release notes）；我们只出 Chrome MV3，不受影响。
- **L2 vscode**：`@vscode/test-web --browserType=chromium --extensionDevelopmentPath=gpen-vscode-ext`
  在浏览器里跑 VS Code Web + 扩展测试（官方支持，Linux CI 可跑）；webview 里断言 mount + `gpen.storage.request` 往返。
  另加「无 VS Code」快速路径：普通页面里注入 `acquireVsCodeApi` shim，验证 bridge 协议编解码。
- **L3 分发产物**：npm 包 `publint`/`attw` + `npm pack` 后临时工程 `import` 冒烟；扩展 `wxt zip` 产物存在且
  manifest version 一致；VSIX `vsce ls --tree` 检查必含 webview 资源；userscript 体积阈值。
- **无法自动化**：Safari（macOS+Xcode 手动）、真 Tampermonkey 安装（可选手测清单）、商店审核。
  这些用「构建成功 + 静态校验 + 手测 checklist」作为证据，不谎称已验证。

## 7. CI 接入

- `scripts/ci.sh` 增两个 stage（保持「一处一份脚本，本地与 CI 同源」的传统）：
  - `targets`：`bun i` → `bun run targets:build`（embed → npm → userscript → extension×3 + vsix 校验）→ 产物静态校验 + 版本一致性；
  - `e2e`：`bunx playwright install --with-deps chromium firefox` → `bun run test:e2e`（L1）+ `bun run test:e2e:targets`（L2）。
- `.github/workflows/ci.yml` 增加 `targets` / `e2e-targets` job（`needs: js`），缓存 bun store + Playwright 浏览器；
  `actions/upload-artifact` 上传 `dist/**`；Safari/真 Firefox/Selenium 放在 `workflow_dispatch` 或 nightly。
- 红线：CI 不 clone 私有 ext 子模块（现状如此）→ 这也意味着**目标构建必须能在 gpen-js 内完成**，
  见 §9 的第一个待拍板项。

## 8. 里程碑建议

| 里程碑 | 内容 | 验收 |
| --- | --- | --- |
| M1 | embed 入口 + `targets/embed` 构建 + harness + L1 e2e | `dist/embed/*` 可从任意页面 shadow 挂载，e2e 绿 |
| M2 | npm 产物 + exports/types + publint/attw + 包冒烟 | `npm pack` 产物可被外部工程 import（含类型） |
| M3 | WXT 扩展（chrome mv3 / firefox mv2 / safari）+ L2 chrome e2e + web-ext lint | 三份目录产物 + Chrome e2e 绿 |
| M4 | userscript（自建 Vite，IIFE + metadata）+ GM shim e2e + metadata 断言 | `.user.js` 单文件可注入并访问 GM 存储 |
| M5 | vscode webview 接入 + `@vscode/test-web` 冒烟 + vsix | webview 里 storage 往返绿 |
| M6 | CI 合并（targets + e2e stage、artifact、版本一致性守卫） | `scripts/ci.sh all` 本地全绿 |

## 9. 待拍板

1. **壳代码放哪**：gpen-js 内新增 `targets/`（公共 CI 能全量构建，推荐），还是继续放私有 `gpen-*-ext` 子模块
   （CI 需要额外 secrets/子模块权限）？现有 `gpen-browser-ext` 的 WXT 壳是改造复用它，还是在 gpen-js 内新起一套？
2. **npm 包名与许可**：发 `gpen-ui-js`（Apache-2.0，根 README 的口径）还是别的名字？包里要不要含 `embed`？（建议含。）
3. **userscript 分发**：`@updateURL`/`@downloadURL` 用 GitHub Release asset 还是 GreasyFork/自建站点？
   另：是否接受「单文件 IIFE（构建期静态 ESM 内联）」作为交付形态（§4.2 / R13 的引擎限制）？
4. **注入策略**：默认全站注入悬浮球（`*://*/*`），还是白名单/手动触发？
5. **Firefox/Safari 投入**：Firefox 真装扩展的 Selenium job 要不要做（成本高、易抖）？Safari 是否接受「只构建 + macOS 手测」？
6. **测试边界**：是否接受「Playwright 注入 content bundle」作为 MV2 的主证据（真装为可选）？L2 的断言清单要不要再加（例如 CSP 严格站点、iframe 页面）？
