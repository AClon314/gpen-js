import { expect, test, type Locator } from "playwright/test";

async function caretAt(field: Locator, start: number, end = start) {
  await field.evaluate(
    (element, range) => {
      const input = element as HTMLInputElement;
      input.focus();
      input.setSelectionRange(range.start, range.end);
    },
    { start, end },
  );
}

test.describe("gpen-input-number", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demo/widgets");
  });

  test("steps by the configured step when an arrow points past the text edge", async ({ page }) => {
    const field = page.getByLabel("强度");

    await caretAt(field, 0);
    await field.press("ArrowLeft");
    await expect(field).toHaveValue("41");
    await expect(field).toHaveJSProperty("selectionStart", 0);

    await caretAt(field, 2);
    await field.press("ArrowRight");
    await expect(field).toHaveValue("42");

    await caretAt(field, 0);
    await field.press("ArrowLeft");
    await field.press("ArrowLeft");
    await expect(field).toHaveValue("40");
  });

  test("leaves the caret and the selection alone away from the edges", async ({ page }) => {
    const field = page.getByLabel("强度");

    await caretAt(field, 1);
    await field.press("ArrowLeft");
    await expect(field).toHaveValue("42");
    await expect(field).toHaveJSProperty("selectionStart", 0);

    await caretAt(field, 0, 2);
    await field.press("ArrowLeft");
    await expect(field).toHaveValue("42");

    await caretAt(field, 0);
    await field.press("Shift+ArrowLeft");
    await field.press("Control+ArrowLeft");
    await expect(field).toHaveValue("42");
  });

  test("steps the leading digit in place from the left edge", async ({ page }) => {
    const intensity = page.getByLabel("强度");

    await intensity.fill("90");
    await caretAt(intensity, 0);
    await intensity.press("ArrowUp");
    await expect(intensity).toHaveValue("100");
    await expect(intensity).toHaveJSProperty("selectionStart", 0);

    // ↑ 从 90 进位到 100（首位从 9 变 10）；↓ 从 109 退回 99（首位为 1 时降一级）。
    await intensity.press("ArrowDown");
    await expect(intensity).toHaveValue("90");
    await expect(intensity).toHaveJSProperty("selectionStart", 0);

    const opacity = page.getByLabel("不透明度", { exact: true });
    await opacity.fill("109");
    await caretAt(opacity, 0);
    await opacity.press("ArrowDown");
    await expect(opacity).toHaveValue("99");

    // 非 1 开头的首位按自身位权步进。
    await opacity.fill("234");
    await caretAt(opacity, 0);
    await opacity.press("ArrowUp");
    await expect(opacity).toHaveValue("334");
    await expect(opacity).toHaveJSProperty("selectionStart", 0);
    await opacity.press("ArrowDown");
    await expect(opacity).toHaveValue("234");
  });

  test("toggles the sign from the left of the minus", async ({ page }) => {
    const field = page.getByLabel("不透明度", { exact: true });

    await field.fill("-5");
    await caretAt(field, 0);
    await field.press("ArrowUp");
    await expect(field).toHaveValue("+5");
    await expect(field).toHaveJSProperty("selectionStart", 0);
  });

  test("cycles -5 → +5 → -5 with the - key, keeping the plus", async ({ page }) => {
    const field = page.getByLabel("不透明度", { exact: true });

    await field.fill("-5");
    await caretAt(field, 0);
    await field.press("-");
    await expect(field).toHaveValue("+5");

    await field.press("-");
    await expect(field).toHaveValue("-5");
  });

  test("switches the sign with the - and + keys at the front", async ({ page }) => {
    const field = page.getByLabel("不透明度", { exact: true });

    await field.fill("5");
    await caretAt(field, 0);
    await field.press("-");
    await expect(field).toHaveValue("-5");
    await expect(field).toHaveJSProperty("selectionStart", 1);

    await field.press("+");
    await expect(field).toHaveValue("+5");
  });

  test("steps from 1.0 down into the fractional wheel", async ({ page }) => {
    const field = page.getByLabel("小数位轮");

    await field.fill("1.0");
    await caretAt(field, 0);
    await field.press("ArrowDown");
    await expect(field).toHaveValue("0.9");
    await expect(field).toHaveJSProperty("selectionStart", 2);

    await field.press("ArrowUp");
    await expect(field).toHaveValue("1");
    await expect(field).toHaveJSProperty("selectionStart", 0);
  });

  test("keeps the field's decimal width when a step produces a zero", async ({ page }) => {
    const field = page.getByLabel("不透明度", { exact: true });

    await field.fill("23.49");
    await caretAt(field, 5);
    await field.press("ArrowUp");
    await expect(field).toHaveValue("23.50");
    await expect(field).toHaveJSProperty("selectionStart", 5);
  });

  test("walks the fractional wheel from the first non-zero digit", async ({ page }) => {
    const field = page.getByLabel("小数位轮");

    await field.fill("0.009");
    await caretAt(field, 2);
    await field.press("ArrowUp");
    await expect(field).toHaveValue("0.01");

    await field.press("ArrowDown");
    await expect(field).toHaveValue("0.009");
    await expect(field).toHaveJSProperty("selectionStart", 2);
  });

  test("steps on wheel only after the field is activated", async ({ page }) => {
    const field = page.getByLabel("强度");

    // 悬浮但未聚焦：滚轮不步进，留给页面滚动。
    await field.hover();
    await field.dispatchEvent("wheel", { deltaY: -100 });
    await expect(field).toHaveValue("42");

    // 激活（聚焦）后才步进。
    await caretAt(field, 2);
    await field.dispatchEvent("wheel", { deltaY: -100 });
    await expect(field).toHaveValue("43");
    await field.dispatchEvent("wheel", { deltaY: 100 });
    await expect(field).toHaveValue("42");
  });

  test("clamps to min/max and keeps the caret at the edge", async ({ page }) => {
    const field = page.getByLabel("强度");

    await field.fill("0");
    await caretAt(field, 1);
    await field.press("ArrowLeft");
    await expect(field).toHaveValue("0");

    await field.fill("100");
    await caretAt(field, 3);
    await field.press("ArrowRight");
    await expect(field).toHaveValue("100");
  });

  test("treats min/max as soft bounds", async ({ page }) => {
    const field = page.getByLabel("强度");

    // 打字不受边界限制。
    await field.fill("150");
    await field.evaluate((element) => (element as HTMLInputElement).blur());
    await expect(field).toHaveValue("150");

    // 已超界时步进不再被钳制。
    await caretAt(field, 0);
    await field.press("ArrowDown");
    await expect(field).toHaveValue("140");

    // 界内步进到边界时停住。
    await field.fill("99");
    await caretAt(field, 2);
    await field.press("ArrowRight");
    await expect(field).toHaveValue("100");
    await field.press("ArrowRight");
    await expect(field).toHaveValue("100");
  });

  test("Shift no longer multiplies the step", async ({ page }) => {
    const field = page.getByLabel("不透明度", { exact: true });

    await field.fill("23.45");
    await caretAt(field, 0);
    await field.press("Shift+ArrowUp");
    await expect(field).toHaveValue("33.45");
  });

  test("uses the configured step and broadcasts the change", async ({ page }) => {
    const field = page.getByLabel("不透明度", { exact: true });

    await caretAt(field, 0);
    await field.press("ArrowLeft");
    await expect(field).toHaveValue("23.44");
    await expect(field.locator("xpath=ancestor::article").locator("output")).toHaveText("23.44");
  });

  test("ignores empty and non-numeric text", async ({ page }) => {
    const field = page.getByLabel("不透明度（非法文本演示）");

    await field.fill("abc");
    await caretAt(field, 0);
    await field.press("ArrowLeft");
    await expect(field).toHaveValue("abc");

    await field.fill("");
    await caretAt(field, 0);
    await field.press("ArrowLeft");
    await expect(field).toHaveValue("");
  });

  test("resets with Delete only while hovering, not while focused", async ({ page }) => {
    const field = page.getByLabel("强度");

    // 悬浮但未聚焦：Delete 重置为默认值 42。
    await field.fill("77");
    await field.evaluate((element) => (element as HTMLInputElement).blur());
    await field.hover();
    await page.keyboard.press("Delete");
    await expect(field).toHaveValue("42");

    // 聚焦中：Delete 是原生向后删除，不重置。
    await field.fill("123");
    await caretAt(field, 1);
    await field.hover();
    await field.press("Delete");
    await expect(field).toHaveValue("13");
  });
});

test.describe("gpen-input-slider", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demo/widgets");
  });

  test("scrubs continuously on drag without entering edit mode", async ({ page }) => {
    const slider = page.locator(".input-slider");
    const field = page.getByLabel("滑条数值");

    await slider.scrollIntoViewIfNeeded();
    const box = await slider.boundingBox();
    if (box === null) throw new Error("slider has no layout box");

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 18, box.y + box.height / 2);
    await page.mouse.up();

    await expect(field).toHaveValue("10.01");
    await expect(field).not.toBeFocused();
  });

  test("focuses for editing on a tap", async ({ page }) => {
    const slider = page.locator(".input-slider");
    const field = page.getByLabel("滑条数值");

    await slider.scrollIntoViewIfNeeded();
    const box = await slider.boundingBox();
    if (box === null) throw new Error("slider has no layout box");

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(field).toBeFocused();
  });

  test("keeps the user-typed decimal width through a scrub", async ({ page }) => {
    const slider = page.locator(".input-slider");
    const field = page.getByLabel("滑条数值");

    await field.fill("18.0");
    await field.evaluate((element) => (element as HTMLInputElement).blur());

    await slider.scrollIntoViewIfNeeded();
    const box = await slider.boundingBox();
    if (box === null) throw new Error("slider has no layout box");

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 6, box.y + box.height / 2);
    await page.mouse.up();

    // 拖拽精度 0.1（沿用 18.0 的位数），而不是 step 的 0.01。
    await expect(field).toHaveValue("18.1");
  });
});
