import { expect, test, type Locator, type Page } from "playwright/test";

/**
 * T2 回归：Outliner 渲染真实图层树（不再是静态占位），并且选中 / 折叠 / 键盘导航 /
 * 内联重命名都走 `src/lib/layers/tree/` 的纯函数行为层。
 */
async function openOutliner(page: Page): Promise<Locator> {
  await page.goto("/");
  await page.locator(".floating-button").click();
  const outliner = page.locator(".blender-panel-outliner");
  await expect(outliner).toBeVisible();
  return outliner;
}

function treeItems(outliner: Locator): Locator {
  return outliner.locator('[role="treeitem"]');
}

test.describe("outliner tree", () => {
  test("renders the document tree with aria levels and supports selection/navigation", async ({
    page,
  }) => {
    const outliner = await openOutliner(page);
    const items = treeItems(outliner);

    // 默认文档：Root 组 + 网页图层（子节点默认展开）。
    await expect(items).toHaveCount(2);
    const root = items.nth(0);
    const layer = items.nth(1);
    await expect(root).toHaveAttribute("aria-level", "1");
    await expect(root).toHaveAttribute("aria-expanded", "true");
    await expect(layer).toHaveAttribute("aria-level", "2");
    await expect(layer).toHaveAttribute("aria-selected", "false");

    // 单击 = 选中 + active（active 是文档的 active node）。
    await layer.click();
    await expect(layer).toHaveAttribute("aria-selected", "true");
    await expect(layer).toHaveClass(/active/);

    // roving tabindex：Home 到首行，↓ 到子行，← 回父行。
    await page.keyboard.press("Home");
    await expect(root).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(layer).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(root).toBeFocused();

    // ←/→ 在组行上是折叠 / 展开，折叠的子树不进 DOM。
    await page.keyboard.press("ArrowLeft");
    await expect(root).toHaveAttribute("aria-expanded", "false");
    await expect(items).toHaveCount(1);
    await page.keyboard.press("ArrowRight");
    await expect(root).toHaveAttribute("aria-expanded", "true");
    await expect(items).toHaveCount(2);

    // 鼠标箭头同样折叠。
    await outliner.getByRole("button", { name: "折叠 Root" }).click();
    await expect(items).toHaveCount(1);
  });

  /**
   * 拖拽的细活（几何 + op 生成）由 `tests/tree.test.ts` 覆盖；这里只冒烟验证 DOM 事件接线
   * 没有断：dragstart → dragover 解析出落点 → drop 不弄坏树。
   */
  test("wires drag & drop through the drop-target resolver", async ({ page }) => {
    const outliner = await openOutliner(page);
    const items = treeItems(outliner);
    const root = items.nth(0);
    const layer = items.nth(1);

    const box = await root.boundingBox();
    expect(box).not.toBeNull();

    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await layer.dispatchEvent("dragstart", { dataTransfer });
    await root.dispatchEvent("dragover", {
      dataTransfer,
      clientX: box!.x + box!.width - 4,
      clientY: box!.y + box!.height / 2,
    });
    // 行中间 50% → 入组（on）。
    await expect(root).toHaveAttribute("data-drop", "on");

    await root.dispatchEvent("drop", { dataTransfer });
    // 该图层本就是 Root 的最后一个子节点：applyDrop 不产出 op，树不变。
    await expect(root).not.toHaveAttribute("data-drop");
    await expect(items).toHaveCount(2);
    await layer.dispatchEvent("dragend", { dataTransfer });
  });

  test("renames a row inline with F2 and writes it back to the document", async ({ page }) => {
    const outliner = await openOutliner(page);
    const layer = treeItems(outliner).nth(1);
    await layer.click();
    await page.keyboard.press("F2");

    const input = outliner.locator("input.outliner-rename");
    await expect(input).toBeVisible();
    await input.fill("Renamed Layer");
    await input.press("Enter");

    await expect(input).toBeHidden();
    await expect(treeItems(outliner).nth(1)).toContainText("Renamed Layer");
  });
});
