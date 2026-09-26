import { expect, type Page } from "playwright/test";

/**
 * 偏好设置面板的公共入口。`preferences.e2e.ts` 与 `eraser.e2e.ts` 以前各抄一份
 * 完全相同的「`Control+Alt+u` → 等面板可见」；集中在 helpers 后，
 * 换快捷键 / 改面板选择器只需改一处。
 *
 * 注意：这里只负责**打开并断言可见**。需要断言幂等（再按一次不开第二个）的用例
 * 仍应自己 `keyboard.press`，因为那正是它要守的行为。
 */
export async function openPreferences(page: Page) {
  await page.keyboard.press("Control+Alt+u");
  await expect(page.locator(".blender-panel-preferences")).toBeVisible();
}
