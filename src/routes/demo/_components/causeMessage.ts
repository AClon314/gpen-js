/**
 * 演示页共用的异常收尾：把未知异常压成可展示文案。
 *
 * 调用点仍要自己 `console.debug` 留痕 —— oxlint 的 `catch/no-bare-return` 只认
 * catch 块内**字面**的 `console.*`，把日志藏进本函数会让裸 `return;` 变成告警。
 */
export function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
