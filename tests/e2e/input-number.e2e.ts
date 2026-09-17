import { expect, test, type Locator } from "playwright/test";

/** Drag the slider by `pixels` starting at `ratio` (0 = minus end, 1 = plus end). */
async function dragSlider(field: Locator, ratio: number, pixels: number) {
  const slider = field.locator("xpath=ancestor::*[@data-input-slider]");
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  if (box === null) throw new Error("slider has no layout box");
  const y = box.y + box.height / 2;
  const x = box.x + box.width * ratio;
  await field.evaluate((element) => (element as HTMLInputElement).blur());
  await slider.page().mouse.move(x, y);
  await slider.page().mouse.down();
  // 分几步走：pointer capture 是在确认拖拽（>4px）之后才申请的，一步跨出控件
  // 会丢掉后面的 move（那一瞬间还没有捕获）。
  await slider.page().mouse.move(x + pixels, y, { steps: 8 });
  await slider.page().mouse.up();
}

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

  test("steps discretely on drag without entering edit mode", async ({ page }) => {
    const field = page.getByLabel("滑条数值");

    // 中央 1/3 = props.step（0.01）；18px / 6px = 3 步：9.98 → 10.01。
    await dragSlider(field, 0.5, 18);

    await expect(field).toHaveValue("10.01");
    await expect(field).not.toBeFocused();
  });

  test("uses the zone under the pointer: precision / step / integer place", async ({ page }) => {
    const field = page.getByLabel("滑条数值");

    // 靠近 + 的 1/3：用户输入的最大精度（18.0 是 0.1，不是 step 的 0.01）。
    await field.fill("18.0");
    await dragSlider(field, 0.92, 6);
    await expect(field).toHaveValue("18.1");

    // 中央 1/3：配置 step 0.01。
    await dragSlider(field, 0.5, 6);
    await expect(field).toHaveValue("18.11");

    // 靠近 − 的 1/3：智能整数位，递减自动退回智能小数位（1.12 → 0.12 → 0.02 → 0.01 → 0.009）。
    await field.fill("1.12");
    await dragSlider(field, 0.08, -24);
    await expect(field).toHaveValue("0.009");

    // 鼠标也一样：分区在 pointerdown 时锁定。从靠 + 的 1/3 一路拖回靠 − 的 1/3，
    // 规则始终是「用户最大精度」（18.0 → 6.4 每步 0.1），不会被新分区抢走。
    const slider = field.locator("xpath=ancestor::*[@data-input-slider]");
    await field.fill("18.0");
    await dragSlider(field, 0.92, -700);
    await expect(slider).toHaveAttribute("data-step-rule", "precision");
    await expect(field).toHaveValue("6.4");
  });

  test("focuses for editing on a tap", async ({ page }) => {
    const field = page.getByLabel("滑条数值");
    const slider = page.locator(".input-slider").filter({ has: field });

    await slider.scrollIntoViewIfNeeded();
    const box = await slider.boundingBox();
    if (box === null) throw new Error("slider has no layout box");

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(field).toBeFocused();
  });
});

test.describe("gpen-input-slider (touch)", () => {
  /** A touch page with the slider narrowed so one drag crosses the zone borders. */
  async function touchFixture(browser: import("playwright/test").Browser) {
    const context = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width: 900, height: 900 },
    });
    const page = await context.newPage();
    await page.goto("/demo/widgets");
    const field = page.getByLabel("滑条数值");
    const slider = field.locator("xpath=ancestor::*[@data-input-slider]");
    await slider.scrollIntoViewIfNeeded();
    // 压窄到 240px：一段 80px，几十像素的位移就能跨过分区（两侧 ± 按钮各约 26px，
    // 所以落点取 40 / 200，避开按钮本身）。
    await page.addStyleTag({ content: "div[data-input-slider] { width: 240px !important; }" });
    await field.fill("9.98");
    await field.evaluate((element) => (element as HTMLInputElement).blur());
    const box = await slider.boundingBox();
    if (box === null) throw new Error("slider has no layout box");
    const y = box.y + box.height / 2;
    const cdp = await context.newCDPSession(page);
    /**
     * Dispatch a touch gesture. `dispatch` takes the full point set (multi-finger);
     * `touch` is the one-finger shortcut and keeps `id: 1` stable for the whole
     * gesture, like a real browser does.
     */
    const dispatch = (
      type: "touchStart" | "touchMove" | "touchEnd",
      points: { x: number; id: number }[],
    ) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : points.map((point) => ({ ...point, y })),
      });
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number) =>
      dispatch(type, type === "touchEnd" ? [] : [{ x, id: 1 }]);
    return { context, page, field, slider, box, y, touch, dispatch };
  }

  test("locks the zone rule at touch-down while the finger crosses zones", async ({ browser }) => {
    const { context, field, slider, box, touch } = await touchFixture(browser);

    // 落在靠 − 的 1/3：智能整数位（9.98 ↑ → 10.98，是 +1 而不是 step 的 +0.01）。
    await touch("touchStart", box.x + 40);
    await expect(slider).toHaveAttribute("data-step-rule", "digit");
    await touch("touchMove", box.x + 46);
    await expect(field).toHaveValue("10.98");

    // 拖进靠 + 的 1/3：规则仍是落点那一段，不改成「用户最大精度」。
    await touch("touchMove", box.x + 200);
    await expect(slider).toHaveAttribute("data-step-rule", "digit");
    await touch("touchEnd", 0);

    // touch 不做指针锁，也不抢焦点（拖拽 ≠ 点击编辑）。
    await expect(field).not.toBeFocused();
    expect(await context.pages()[0].evaluate(() => document.pointerLockElement)).toBeNull();
    await context.close();
  });

  test("keeps the plus-zone precision when the finger drags back over the minus zone", async ({
    browser,
  }) => {
    const { context, field, slider, box, touch } = await touchFixture(browser);

    // 落在靠 + 的 1/3：用户最大精度（0.01），所以向左 6px 是 9.97。
    await touch("touchStart", box.x + 200);
    await expect(slider).toHaveAttribute("data-step-rule", "precision");
    await touch("touchMove", box.x + 194);
    await expect(field).toHaveValue("9.97");

    // 跨到靠 − 的 1/3，规则不换成智能整数位。
    await touch("touchMove", box.x + 30);
    await expect(slider).toHaveAttribute("data-step-rule", "precision");
    await touch("touchEnd", 0);
    await context.close();
  });

  test("ignores a second finger that lands while the first one drags", async ({ browser }) => {
    const { context, field, slider, box, touch, dispatch } = await touchFixture(browser);

    await touch("touchStart", box.x + 40);
    await expect(slider).toHaveAttribute("data-step-rule", "digit");

    // 第二根手指落在靠 + 的 1/3：不得顶掉第一根手指的锚点与规则。
    await dispatch("touchStart", [
      { x: box.x + 40, id: 1 },
      { x: box.x + 200, id: 2 },
    ]);
    await expect(slider).toHaveAttribute("data-step-rule", "digit");
    await expect(field).toHaveValue("9.98");

    // 第一根手指继续走：仍是智能整数位（9.98 ↑ → 10.98）。
    await dispatch("touchMove", [
      { x: box.x + 46, id: 1 },
      { x: box.x + 200, id: 2 },
    ]);
    await expect(field).toHaveValue("10.98");

    await dispatch("touchEnd", []);
    await context.close();
  });
});

test.describe("gpen-input-slider (vertical)", () => {
  test("sizes the +/- and unit rows to two token lines, value takes the rest", async ({ page }) => {
    await page.goto("/demo/widgets");
    const slider = page.locator(".vertical-card .input-slider");
    await slider.scrollIntoViewIfNeeded();

    const metrics = await slider.evaluate((element) => {
      const widget = element.querySelector(".input-widget");
      if (widget === null) throw new Error("widget missing");
      const style = getComputedStyle(widget);
      const height = (selector: string) =>
        element.querySelector(selector)?.getBoundingClientRect().height ?? 0;
      return {
        // line-height 是 token（无单位）算出来的绝对值，行高 = 2lh
        line: 2 * Number.parseFloat(style.lineHeight),
        rows: [height(".input-step--up"), height(".input-unit"), height(".input-step--down")],
        field: height("input"),
        widget: widget.getBoundingClientRect().height,
        card: (element.closest(".vertical-card") as HTMLElement).getBoundingClientRect().height,
      };
    });

    expect(metrics.rows).toHaveLength(3); // + / unit / −
    for (const row of metrics.rows) expect(row).toBeCloseTo(metrics.line, 1);
    expect(metrics.field).toBeGreaterThan(metrics.line); // 多出来的高度全给 value
    expect(metrics.widget).toBeLessThanOrEqual(metrics.card);
  });
});
