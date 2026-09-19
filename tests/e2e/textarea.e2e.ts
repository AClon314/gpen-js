import { expect, test, type Locator, type Page } from "playwright/test";

/** The editor's content DOM (CM 的 role=textbox + aria-label 就是它的无障碍名). */
function editor(page: Page, name: string): Locator {
  return page.getByRole("textbox", { name });
}

/** 清空后按真实按键逐字输入（CM 只认真实按键 / beforeinput）。 */
async function replaceText(page: Page, target: Locator, text: string) {
  await target.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  if (text !== "") await page.keyboard.type(text);
}

/** 在编辑器里派发一次带 text/plain 的粘贴事件（CM 读 event.clipboardData）。 */
async function pasteText(target: Locator, text: string) {
  await target.evaluate((element, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    element.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);
}

/** 读表单镜像 textarea 的值：既是文档文本，也顺带断言镜像与文档同步。 */
function editorValue(target: Locator): Promise<string> {
  return target.evaluate((element) => {
    const mirror = element.closest(".text-editor")?.querySelector("textarea");
    return mirror instanceof HTMLTextAreaElement ? mirror.value : "（找不到镜像）";
  });
}

test.describe("gpen-text-editor", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demo/textarea");
    // 冷启动竞态：第一次导航可能撞上 Vite 还在优化依赖（SvelteKit 的动态入口 ?v= 哈希失配 → 404），
    // 页面空白；重载一次兜底，与组件本身无关。
    if ((await page.locator(".cm-content").count()) === 0) await page.reload();
    // 编辑器在 onMount 里创建，先确认挂好了再操作（5 个示例编辑器）。
    await expect(page.locator(".cm-content")).toHaveCount(5, { timeout: 15_000 });
  });

  test("writes the document through bind:value, keeping line breaks", async ({ page }) => {
    const note = editor(page, "笔记");
    const output = page.locator(".card output").first();

    await replaceText(page, note, "第一行");
    await page.keyboard.press("Enter");
    await page.keyboard.type("第二行");
    expect(await editorValue(note)).toBe("第一行\n第二行");
    await expect(output).toHaveText("第一行 第二行");
  });

  test("applies external values in place, keeping the undo history", async ({ page }) => {
    const note = editor(page, "笔记");
    const output = page.locator(".card output").first();

    await replaceText(page, note, "自己写的");
    await expect(output).toHaveText("自己写的");

    // 外部改值：整篇替换（不是重建 EditorView）。
    await page.getByRole("button", { name: "外部改值" }).click();
    await expect(note).toHaveText("外部写入的内容");
    await expect(output).toHaveText("外部写入的内容");

    // undo 历史没有丢：Ctrl+Z 撤掉外部那次替换，回到自己刚写的内容。
    await note.click();
    await page.keyboard.press("ControlOrMeta+z");
    expect(await editorValue(note)).toBe("自己写的");
    await expect(output).toHaveText("自己写的");
  });

  test("renders the placeholder while the document is empty", async ({ page }) => {
    await expect(page.locator(".cm-placeholder")).toHaveText("写点什么…");
  });

  test("mirrors the document into FormData and blocks an empty required field", async ({
    page,
  }) => {
    const form = page.locator("form[data-textarea-form]");
    const note = editor(page, "表单备注");

    const read = () =>
      form.evaluate((element) => {
        const data = new FormData(element as HTMLFormElement);
        return {
          valid: (element as HTMLFormElement).checkValidity(),
          entries: Object.fromEntries(data.entries()) as Record<string, string>,
        };
      });

    // 空值 + required：校验失败，FormData 里有一项空字符串。
    await expect.poll(read).toEqual({ valid: false, entries: { note: "" } });

    // 原生校验拦住提交：onsubmit 根本没跑。
    await page.getByRole("button", { name: "提交" }).click();
    await expect(form.locator("output")).toHaveText("尚未提交");

    await replaceText(page, note, "一段备注");
    await expect.poll(read).toEqual({ valid: true, entries: { note: "一段备注" } });

    await page.getByRole("button", { name: "提交" }).click();
    await expect(form.locator("output")).toHaveText('提交成功：note="一段备注"');
  });

  test("drops disabled from FormData while readonly still submits", async ({ page }) => {
    const form = page.locator("form[data-textarea-form]");
    const note = editor(page, "表单备注");

    await replaceText(page, note, "只读内容");

    // disabled：退出约束校验与 FormData（提交能通过）。
    await page.getByLabel("禁用编辑器").check();
    await expect(note).toHaveAttribute("aria-disabled", "true");
    await expect(note).toHaveAttribute("contenteditable", "false");
    await page.getByRole("button", { name: "提交" }).click();
    await expect(form.locator("output")).toHaveText("提交成功：FormData 为空");

    // readonly：仍提交，但键盘输入改不动它。
    await page.getByLabel("禁用编辑器").uncheck();
    await page.getByLabel("只读编辑器").check();
    await expect(note).toHaveAttribute("contenteditable", "true");
    await replaceText(page, note, "改不动的");
    await expect(note).toHaveText("只读内容");
    await page.getByRole("button", { name: "提交" }).click();
    await expect(form.locator("output")).toHaveText('提交成功：note="只读内容"');
  });

  test("rejects typing and pasting past maxlength", async ({ page }) => {
    const note = editor(page, "表单备注");

    // 键入：第 21 个字符起被 CM 的 changeFilter 拒绝。
    await replaceText(page, note, "abcdefghijklmnopqrstuvwxyz");
    await expect(note).toHaveText("abcdefghijklmnopqrst");

    // 粘贴一整段超长文本：整次事务被拒，文档保持原样。
    await replaceText(page, note, "");
    await pasteText(note, "abcdefghijklmnopqrstuvwxyz");
    await expect(note).toHaveText("");

    // 长度以内的粘贴照常生效。
    await pasteText(note, "abcde");
    await expect(note).toHaveText("abcde");
  });

  test("runs the injected extensions", async ({ page }) => {
    const numeric = editor(page, "数值扩展");

    await numeric.click();
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowUp");
    await expect(numeric).toHaveText("9.99");
  });
});
