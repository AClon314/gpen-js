import type { Locator } from "playwright/test";

/**
 * 向目标元素派发一次带 `text/plain` 的合成 `paste` 事件。
 *
 * CodeMirror 读 `event.clipboardData`（`code-editor.e2e.ts`），InputNumber 也走原生
 * paste 处理（`input-number.e2e.ts`）——两处实现一模一样，只有函数名不同
 * （`pasteText` / `paste`）。真实剪贴板 API 需要额外权限，所以用合成事件。
 */
export async function pasteText(target: Locator, text: string) {
  await target.evaluate((element, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    element.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);
}
