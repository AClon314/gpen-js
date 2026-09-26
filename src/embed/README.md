# embed —— 框架无关的挂载核心

把 `GpenOverlay` + `ContextMenu` 挂进一个 ShadowRoot，给 userscript / 浏览器扩展 / VS Code webview /
npm 消费者复用。**它不是一个单文件工具**，单文件只是其中一种交付形态（IIFE）。

## 为什么不能直接复用 SvelteKit 的 `build/`

`bun run build`（`vite.config.ts` + adapter-static）产出的是**网站应用外壳**，不是库：

- `build/index.html` 用绝对路径 `/_app/…` 的 `<link rel=modulepreload>` + 一段内联 `import()` 启动
  SvelteKit router（`kit.init` / `kit.start`），挂载整棵路由树（`+layout.svelte` 里
  `mount(GpenOverlay, { target: document.body })`），还带 paraglide locale、`storage-broker` 路由；
- CSS 是 15 个 document 级 `<link rel=stylesheet>`，多 chunk ESM + hash 文件名。

各 target 若直接吃 `build/`：

| target         | 能否直接用 `build/` | 卡点                                                                   |
| -------------- | ------------------- | ---------------------------------------------------------------------- |
| website        | ✅ 它本身就是       | —                                                                      |
| npm            | ❌                  | 没有可导出 API；router / 绝对路径 / document 假设                      |
| userscript     | ❌                  | 引擎不支持 ESM/顶层 `import`；`build/` 是多文件 ESM                    |
| browser-ext    | ❌                  | content script 必须单文件，且需延迟求值（MAIN world `customElements`） |
| vscode webview | ❌                  | 需要 `mountGpen()`，不是整页 app                                       |

所以 embed 是必需的：它提供**挂载 API**、**ShadowRoot 隔离 + CSS 字符串注入**，并把
`$app` / routes / paraglide 这些外壳剥掉。

## 文件

| 文件                       | 职责                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/embed/index.ts`       | 入口：`mountGpen` / `unmountGpen` / `isGpenMounted` + host/shadow 契约                                               |
| `vite.embed.config.ts`     | lib 构建（ESM + IIFE）+ `inlineCss` 插件；并导出 `gpenDefine` / `gpenSvelteCompilerOptions` 给 `vite.config.ts` 复用 |
| `tests/embed/embed.e2e.ts` | Playwright：shadow 隔离、幂等、宿主页穿透、存储往返                                                                  |
| `playwright.config.ts`     | `projects: [e2e, embed]`；embed 项目注入 IIFE，`GPEN_EMBED_ONLY=1` 时不启 dev server                                 |

## 契约

- **Host**：`<div id="gpen-host" data-gpen-overlay-host style="position:absolute;top:0;left:0;width:0;height:0;overflow:visible">`，
  挂在 `document.documentElement` 末尾——不在 `guessWebLayer()` 的扫描范围内（只扫 body 直接子元素），
  也不受宿主 `body { position/transform/margin }` 影响。也可传 `mountGpen({ host })` 自备宿主。
- **Shadow**：样式以 `<style data-gpen-embed-style>` 注入 shadow，不污染宿主页。Svelte 5 的
  `append_styles` 会按 `anchor.getRootNode()` 把组件样式注入 ShadowRoot；Tailwind / dockview /
  组件样式由构建期整份 CSS asset 内联成字符串（见下）。
- **幂等**：重复 `mountGpen()` 返回同一个 handle；`unmountGpen()` 摘掉 host 与事件，未挂载时是 no-op。
- **CSS 内联**：`inlineCss` 插件把构建产出的整个 `.css` asset（app.css + dockview + 各 Svelte 组件样式）
  塞回 JS 的字符串常量。**不能用 `?inline` 替代**：`?inline` 只覆盖源码里显式 import 的 `app.css`，
  同一 asset 里的其余样式无法逐个 `?inline`。

## 构建与测试

```sh
bun run build:embed   # → dist/embed/gpen-embed.js (ESM，含分包) + gpen-embed.iife.js (单文件)
bun run test:embed    # Playwright project=embed，直接注入 IIFE，无需 dev server
```

ESM 那份因为 Spectrum 的 dynamic import 已切 chunk（`sp-overlay-*.js` 等），消费方按整个
`dist/embed/` 目录使用；只有 IIFE 是单文件。

## 消费者

`package.json` 的 `./embed` 子路径：`types` → `src/embed/index.ts`，`default` → `dist/embed/gpen-embed.js`。

- **userscript**（`gpen-userscript`）：Vite 把 `gpen-js/embed` 再打成 classic IIFE `.user.js`。
- **browser-ext**（`gpen-browser-ext`）：content script 在 MAIN world 里 `await import('gpen-js/embed')`
  （必须 dynamic import，见该仓库 `content.ts` 头注释）。
- **vscode**（`gpen-vscode-ext`）：webview `main.ts` 里 `import { mountGpen } from 'gpen-js/embed'`。
- **npm**：作为 `gpen-ui-js` 的可复用入口之一（发布流程暂缓）。

跨仓库编排见 `../scripts/targets.mjs`（gpen-js 根仓库）。

## 已知边界

- Shadow 下 `:global(html), :global(body)` 失效（`GpenWorkspace.svelte`）——注入目标本就不该改宿主页。
- 严格 CSP 站点可能拦 shadow 内 inline `<style>`（首选改 `adoptedStyleSheets` 或 manifest css）。
- dockview popout 用 `location.origin+pathname` 作 popoutUrl，注入目标应禁用/降级。
- 真 Firefox 扩展安装、真 Tampermonkey/Violentmonkey、Safari、商店发布均未做；完整暂缓清单见根
  `TODO.md`「多目标构建」与 gpen-js `TODO.md`。
