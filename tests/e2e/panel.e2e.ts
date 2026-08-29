import { expect, test } from "playwright/test";

test.describe("gpen-panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demo/panel");
  });

  test("collapses into an icon button and restores through its property", async ({ page }) => {
    const panel = page.locator("gpen-panel").first();
    const collapseButton = panel.getByRole("button", { name: "收起 画笔工具" });

    await expect(collapseButton).toBeVisible();
    await collapseButton.press("Enter");
    await expect(panel).toHaveAttribute("collapsed", "");
    await expect(panel.getByRole("button", { name: "展开 画笔工具" })).toBeVisible();
    await expect(panel.locator("section")).toHaveCount(0);
    await expect(page.getByText("画笔工具 → collapsed")).toBeVisible();

    await page.evaluate(() => {
      const panel = document.querySelector("gpen-panel") as HTMLElement & { collapsed: boolean };
      panel.collapsed = false;
    });
    await expect(panel).not.toHaveAttribute("collapsed");
    await expect(panel.getByRole("button", { name: "收起 画笔工具" })).toBeVisible();
    await expect(panel.locator("section")).toHaveCount(1);
  });

  test("supports an initially collapsed panel", async ({ page }) => {
    const panel = page.locator("gpen-panel").nth(1);

    await expect(panel).toHaveAttribute("collapsed", "");
    await expect(panel.getByRole("button", { name: "展开 图层" })).toBeVisible();
    await panel.getByRole("button", { name: "展开 图层" }).click();
    await expect(panel).not.toHaveAttribute("collapsed");
    await expect(panel.getByRole("button", { name: "收起 图层" })).toBeVisible();
  });
});
