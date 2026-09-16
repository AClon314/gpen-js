/**
 * 构建期被 vite.embed.config.ts 的 inlineCss 插件替换成真实的 CSS 文本（JSON 字符串）。
 * 开发/未构建时保持占位符（不影响 SvelteKit dev，因为只有 embed 构建会用到它）。
 */
export const gpenEmbedCss = "__GPEN_EMBED_CSS__";
