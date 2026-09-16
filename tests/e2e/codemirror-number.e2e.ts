import { expect, test } from "playwright/test";

test.describe("gpen codemirror number plugins", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demo/code");
  });

  test("renders both editors with a scrub handle", async ({ page }) => {
    await expect(page.locator(".cm-editor")).toHaveCount(2, { timeout: 30_000 });
    await expect(page.locator(".gpen-number-scrubber")).toHaveCount(2, { timeout: 30_000 });
  });

  test("steps the number with arrows on a single line", async ({ page }) => {
    const single = page.locator(".cm-content").first();
    await single.click();
    await page.keyboard.press("End");

    await page.keyboard.press("ArrowUp");
    await expect(single).toContainText("9.99");

    await page.keyboard.press("ArrowUp");
    await expect(single).toContainText("10.00");

    await page.keyboard.press("ArrowDown");
    await expect(single).toContainText("9.99");
  });

  test("needs CapsLock to step inside a multi-line document", async ({ page }) => {
    const content = page.locator(".cm-content").nth(1);
    await content.locator(".cm-line").first().click();
    await page.keyboard.press("End");

    // 不带 CapsLock：方向键只导航光标，不改文档。
    await page.keyboard.press("ArrowUp");
    await expect(content).toContainText("12.5");

    // CapsLock + ↓ 才步进（回到第一行行尾）。
    await page.keyboard.press("End");
    await page.evaluate(() => {
      const target = document.querySelectorAll(".cm-content")[1];
      if (target === undefined) return;
      const event = new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      });
      event.getModifierState = (key: string) => key === "CapsLock";
      target.dispatchEvent(event);
    });
    await expect(content).toContainText("12.4");
  });

  test("scrubs with the ± handle, keeping the typed precision", async ({ page }) => {
    const single = page.locator(".cm-content").first();
    const handle = page.locator(".gpen-number-scrubber").first();
    await handle.scrollIntoViewIfNeeded();

    const box = await handle.boundingBox();
    if (box === null) throw new Error("scrub handle has no layout box");

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 6, box.y + box.height / 2, { steps: 3 });
    await page.mouse.up();

    await expect(single).toContainText("9.99");
  });
});
