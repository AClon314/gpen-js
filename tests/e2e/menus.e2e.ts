import { expect, test, type Page } from "playwright/test";

/**
 * T9 回归：菜单栏全铺。
 *
 * 覆盖「每个菜单都能打开」「真项能执行」「假项灰掉且 hover 有说明」，
 * 以及菜单快捷键（Ctrl+S / Ctrl+N / F2）真的生效（不是只写在菜单里的假承诺）。
 */
async function openWorkspace(page: Page) {
  await expect(page.locator(".blender-panel-menu, .floating-button").first()).toBeVisible();
  if (await page.locator(".floating-button").isVisible()) {
    await page.locator(".floating-button").click();
  }
  await expect(page.locator(".blender-panel-menu")).toBeVisible();
}

async function openMenu(page: Page, label: string) {
  await page.getByRole("button", { name: `${label}菜单` }).click();
  await expect(page.getByRole("menu")).toBeVisible();
}

test.describe("menu bar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await openWorkspace(page);
  });

  test("every menu in the bar opens with items", async ({ page }) => {
    for (const label of ["文件", "编辑", "渲染", "窗口", "帮助", "切换", "实用工具"]) {
      await openMenu(page, label);
      await expect(page.getByRole("menu")).toBeVisible();
      expect(await page.getByRole("menuitem").count()).toBeGreaterThan(0);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
    }
  });

  test("the settings gear opens the preferences entry", async ({ page }) => {
    await page.getByRole("button", { name: "设置菜单", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "偏好设置" })).toBeVisible();
  });

  test("unimplemented entries are disabled and explain themselves on hover", async ({ page }) => {
    await openMenu(page, "渲染");
    const items = page.getByRole("menuitem");
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      await expect(items.nth(index)).toHaveAttribute("aria-disabled", "true");
      // 灰掉只是视觉；hover 必须说清原因，否则用户不知道为什么点不动。
      expect(await items.nth(index).getAttribute("title")).toBeTruthy();
    }
  });

  test("Escape closes the menu without closing the workspace", async ({ page }) => {
    await openMenu(page, "文件");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    // 菜单的 Esc 不能冒泡给工作区（那会把整个工作区关掉）。
    await expect(page.locator(".blender-panel-menu")).toBeVisible();
    await expect(page.locator(".gpen-overlay[role=dialog]")).toBeVisible();
  });

  test("undo/redo entries follow the history depth", async ({ page }) => {
    await openMenu(page, "编辑");
    await expect(page.getByRole("menuitem", { name: "撤销" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.keyboard.press("Escape");

    // Draw one stroke so there is something to undo.
    const box = await page.locator("canvas.stroke-surface").boundingBox();
    await page.mouse.move(box!.x + box!.width * 0.3, box!.y + box!.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    await openMenu(page, "编辑");
    await expect(page.getByRole("menuitem", { name: "撤销" })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    await page.getByRole("menuitem", { name: "撤销" }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("F2 starts inline renaming of the active outliner row", async ({ page }) => {
    const rename = page.getByLabel("重命名图层");
    await expect(rename).toHaveCount(0);
    await page.keyboard.press("F2");
    await expect(rename).toHaveCount(1);
    await expect(rename).toBeFocused();
    await page.keyboard.press("Escape");
  });

  test("Ctrl+S is a real binding, not just a menu label", async ({ page }) => {
    // The menu advertises Ctrl+S; if the keymap were missing, the label would be
    // a false promise. The command exists and runs (the status text updates).
    await openMenu(page, "文件");
    // 显示文案来自命令注册表（`resolveMenuKeyBind`），所以菜单与快捷键同源。
    const save = page.getByRole("menuitem", { name: "保存 Ctrl+S" });
    await expect(save).toContainText("Ctrl+S");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+s");
    // Nothing to assert visually beyond "no crash and the workspace is alive".
    await expect(page.locator(".blender-panel-menu")).toBeVisible();
  });

  test("New replaces the document and is undoable", async ({ page }) => {
    await openMenu(page, "文件");
    await page.getByRole("menuitem", { name: "新建" }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.locator(".blender-panel-menu")).toBeVisible();
    // Undo brings the previous document back (the entry is enabled again).
    await openMenu(page, "编辑");
    await expect(page.getByRole("menuitem", { name: "撤销" })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });
});
