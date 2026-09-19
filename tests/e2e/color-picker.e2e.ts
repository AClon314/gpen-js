import { expect, test, type Locator } from "playwright/test";

/**
 * Spectrum Web Components 取色器（`widgets/colors/ColorPicker.svelte`）。
 *
 * SWC 的元素是 Lit 自定义元素：值走 property（`el.color` / `el.value`）、变化走
 * `input` / `change` 自定义事件；内部实现都在 shadow root 里（Playwright 的 CSS
 * 选择器默认穿透 shadow DOM，所以可以直接点内部的 `input[type=range]`）。
 */
test.describe("gpen-color-picker", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demo/colors");
    await expect(page.locator("sp-color-area").first()).toBeVisible();
  });

  const card = (page: import("playwright/test").Page, n: number) =>
    page.locator(".demo-card").nth(n);
  const output = (page: import("playwright/test").Page, n: number) =>
    card(page, n).locator("output");

  /** 读控件内部状态：绑定值由 output 体现，SWC 元素自身的 property 也要一致。 */
  async function state(picker: Locator) {
    return picker.evaluate((host) => {
      const area = host.querySelector("sp-color-area") as HTMLElement & { color?: string };
      const field = host.querySelector("sp-color-field") as HTMLElement & { value?: string };
      const slider = host.querySelector("sp-color-slider") as HTMLElement & { color?: string };
      const preview = host.querySelector(".color-picker__preview");
      return {
        area: String(area.color),
        field: field.value,
        slider: String(slider.color),
        preview: preview === null ? "" : getComputedStyle(preview).backgroundColor,
      };
    });
  }

  test("renders upgraded SWC elements sized through their --mod variables", async ({ page }) => {
    const picker = page.locator("[data-color-picker]").first();
    const rendered = await picker.evaluate((host) => {
      const area = host.querySelector("sp-color-area") as HTMLElement;
      const box = area.getBoundingClientRect();
      return {
        upgraded: area.constructor.name,
        hasShadow: area.shadowRoot !== null,
        width: Math.round(box.width),
        height: Math.round(box.height),
        // 面积图手柄的位移量读这个变量，所以尺寸必须从这里给
        modWidth: getComputedStyle(area).getPropertyValue("--mod-colorarea-width").trim(),
        // sp-theme 注入的 Spectrum token（theme + scale 两个片段都要在）
        spectrumToken: getComputedStyle(area)
          .getPropertyValue("--spectrum-color-area-border-width")
          .trim(),
      };
    });

    expect(rendered.upgraded).toBe("ColorArea");
    expect(rendered.hasShadow).toBe(true);
    expect(rendered.width).toBeGreaterThan(100);
    expect(rendered.width).toBe(rendered.height); // 正方形
    expect(rendered.modWidth).not.toBe("");
    expect(rendered.spectrumToken).not.toBe(""); // 缺 scale 片段时这里会是空串
  });

  test("binds the hex value three ways: area, hue slider and hex field", async ({ page }) => {
    const picker = page.locator("[data-color-picker]").first();
    await expect(output(page, 0)).toHaveText("#3366cc");
    expect(await state(picker)).toMatchObject({ area: "#3366cc", field: "#3366cc" });

    // 1) 色相条：键盘（内部就是原生 input[type=range]）
    await card(page, 0).locator("sp-color-slider input").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(output(page, 0)).not.toHaveText("#3366cc");
    const afterKeys = await state(picker);
    expect(afterKeys.field).toBe(await output(page, 0).textContent());

    // 2) 面积图：点右上角 → 高饱和高亮
    const box = await card(page, 0).locator("sp-color-area").boundingBox();
    if (box === null) throw new Error("area has no layout box");
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.12);
    await expect(output(page, 0)).not.toHaveText(afterKeys.field ?? "");

    // 3) 十六进制字段
    await card(page, 0).locator("sp-color-field input").fill("#22aa66");
    await card(page, 0).locator("sp-color-field input").press("Enter");
    await expect(output(page, 0)).toHaveText("#22aa66");
    expect((await state(picker)).field).toBe("#22aa66");
  });

  test("pushes an external value change into the SWC elements", async ({ page }) => {
    const picker = page.locator("[data-color-picker]").nth(1);
    await card(page, 1).getByRole("button", { name: "设为 #22aa66" }).click();
    await expect(output(page, 1)).toHaveText("#22aa66");
    expect((await state(picker)).field).toBe("#22aa66");
    // 预览色跟着走
    expect((await state(picker)).preview).toBe("rgb(34, 170, 102)");
  });

  test("disabled reaches every SWC element and is reversible", async ({ page }) => {
    const picker = page.locator("[data-color-picker]").nth(2);
    await expect(picker.locator("sp-color-area")).toHaveAttribute("disabled", "");
    await expect(card(page, 2).locator("sp-color-slider input")).toBeDisabled();

    await card(page, 2).getByRole("button").click(); // 启用
    await expect(picker.locator("sp-color-area")).not.toHaveAttribute("disabled");
    await expect(card(page, 2).locator("sp-color-slider input")).toBeEnabled();
  });

  test("keeps the a11y wiring SWC ships with", async ({ page }) => {
    const slider = card(page, 0).getByRole("slider", { name: "图层颜色：色相" });
    await expect(slider).toHaveAttribute("aria-valuetext", /°/);
    await expect(
      card(page, 0).getByRole("textbox", { name: "图层颜色：十六进制值" }),
    ).toBeVisible();
  });
});
