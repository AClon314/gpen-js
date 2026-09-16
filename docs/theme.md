# 主题（`--gpen-*` token）

## 两层：静态 CSS 兜底 + JS 控制

```text
src/lib/themes/
├── day-night.css     # 静态 token：:root/:host 白天 + prefers-color-scheme: dark 夜间
├── theme.ts          # 纯函数：GPEN_TOKENS / readGpenTokens / applyGpenTokens / clearGpenTokens
└── theme.svelte.ts   # 响应式封装：initTheme / themeTokens / setThemeToken(s) / resetTheme
```

- **静态 CSS 是首屏兜底**：`day-night.css` 定义全部 `--gpen-*`，无 JS 时也正常渲染；
  夜间用 `@media (prefers-color-scheme: dark)` 覆盖。
- **JS 接管后是 source of truth**：`initTheme()` 先 `readGpenTokens()` 把当前生效的静态值读进
  `$state`，之后 `setThemeToken` / `setThemeTokens` 直接往目标元素写内联样式（`style.setProperty`）；
  `resetTheme()` 清掉内联样式，退回静态 CSS。

目标元素默认 `document.documentElement`；embed 传自己的 ShadowHost，读写的就是 `:host` 的那份。

```ts
import { initTheme, setThemeToken, themeTokens } from "#lib/themes/theme.svelte";

initTheme(); // onMount 里读一次（+layout 已调用）
setThemeToken("--gpen-panel-accent", "#e11d48"); // 之后 JS 说了算
themeTokens()["--gpen-panel-accent"];            // 响应式读取
```

> `theme.svelte.ts` 带 runes，**不进 `#lib` 桶**（否则非 Svelte 上下文 import `#lib` 会炸），
> 需要的地方直接 `import "#lib/themes/theme.svelte"`。`theme.ts` 是纯函数，从 `#lib` 导出。

## 约定

- token 只在这里定义一次；组件用 `var(--gpen-*)` 消费，需要局部变体时**覆盖变量本身**，不要新增
  “传具体值”的 props。
- 新增 token 要同时加进 `GPEN_TOKENS`（否则 JS 读不到 / 管不了）。
- 长度单位见 `AGENTS.md`：横向 `ch`、纵向 `lh`，字号/边框/圆角等保留 px。
