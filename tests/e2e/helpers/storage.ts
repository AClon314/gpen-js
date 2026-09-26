import type { Page } from "playwright/test";

/**
 * 运行时 KV 存储的读取（网页里 = IndexedDB `gpen-storage` 的 `kv` store）。
 *
 * `workspace-state.e2e.ts`、`stroke.e2e.ts`、`preferences.e2e.ts`、`eraser.e2e.ts`
 * 以前各抄一份「open → transaction.get → close」的 IndexedDB 样板；差异只在
 * store key（`root` / `gpen-root`）和随后取出的字段。这里只收拢样板，
 * 字段含义的解释留在各自 spec。
 */

/**
 * 读 KV 里 `key` 对应的记录；`gpen-storage` 里没有 `kv` store、
 * 或该 key 还不存在时返回 `undefined`。
 */
export async function readKvRecord(page: Page, key: string): Promise<unknown> {
  return page.evaluate(async (recordKey) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("gpen-storage");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!db.objectStoreNames.contains("kv")) {
      db.close();
      return undefined;
    }
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction("kv", "readonly").objectStore("kv").get(recordKey);
      request.onsuccess = () => resolve(request.result as unknown);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value;
  }, key);
}

/**
 * `gpen-root` KV blob 里 `gpen-main` 的字节数（首次落盘前是 0）。
 *
 * `preferences.e2e.ts` 的 `documentSize` 与 `eraser.e2e.ts` 的
 * `readToolbarStateFromStorage` 实现完全一致（后者名字叫 toolbar，实际读的也是这个
 * 尺寸，用来观察改画笔 / 橡皮参数后文档变大）。
 */
export async function readMainDocumentSize(page: Page): Promise<number> {
  const value = (await readKvRecord(page, "gpen-root")) as
    | Record<string, Record<string, { size?: number }>>
    | undefined;
  return value?.gpen?.["gpen-main"]?.size ?? 0;
}
