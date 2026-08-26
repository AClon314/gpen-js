import { expect, test, type Frame, type Page } from "playwright/test";

const modulePath = "/src/lib/crossTabBus/index.ts";
const protocol = process.env.httpsCert && process.env.httpsKey ? "https" : "http";
const originA = `${protocol}://127.0.0.1:4173`;
const originB = `${protocol}://127.0.0.1:4174`;

type E2eController = {
  ready(): Promise<void>;
  send(type: string, payload: unknown): Promise<void>;
  messages: unknown[];
  destroy(): void;
};

type E2eMessage = {
  type: string;
  payload: unknown;
};

type E2eWindow = Window & {
  __gpenE2eBus?: E2eController;
};

async function installSameOriginBus(page: Page, channel: string): Promise<void> {
  await page.evaluate(
    async ({ modulePath: path, channel: name }) => {
      const { SameOrigin } = await import(path);
      const messages: unknown[] = [];
      const bus = new SameOrigin(window.location.origin, { channelName: name });
      bus.onMessage((message: E2eMessage) => messages.push(message));
      (window as E2eWindow).__gpenE2eBus = {
        ready: () => bus.ready,
        send: (type, payload) => bus.send(type, payload),
        messages,
        destroy: () => bus.destroy(),
      };
    },
    { modulePath, channel },
  );
}

async function installCrossOriginBus(
  pageOrFrame: Page | Frame,
  remoteWindow: "parent" | "iframe",
  targetOrigin: string,
  channel: string,
): Promise<void> {
  await pageOrFrame.evaluate(
    async ({ modulePath: path, remoteWindow: remote, targetOrigin: origin, channel: name }) => {
      const { CrossOriginBus } = await import(path);
      const messages: unknown[] = [];
      const target =
        remote === "parent" ? window.parent : document.querySelector("iframe")?.contentWindow;
      if (!target) throw new Error("Cross-origin test window is unavailable");

      const bus = new CrossOriginBus({
        remoteWindow: target,
        targetOrigin: origin,
        channel: name,
      });
      bus.onMessage((message: E2eMessage) => messages.push(message));
      (window as E2eWindow).__gpenE2eBus = {
        ready: () => bus.ready,
        send: (type, payload) => bus.send(type, payload),
        messages,
        destroy: () => bus.destroy(),
      };
    },
    { modulePath, remoteWindow, targetOrigin, channel },
  );
}

async function waitForBus(pageOrFrame: Page | Frame): Promise<void> {
  await pageOrFrame.evaluate(async () => {
    const bus = (window as E2eWindow).__gpenE2eBus;
    if (!bus) throw new Error("E2E bus was not installed");
    await bus.ready();
  });
}

async function readMessages(pageOrFrame: Page | Frame): Promise<unknown[]> {
  return pageOrFrame.evaluate(() => (window as E2eWindow).__gpenE2eBus?.messages ?? []);
}

test.describe("crossTabBus in Chromium", () => {
  test("uses the real BroadcastChannel between same-origin pages", async ({ browser }) => {
    const context = await browser.newContext();
    const sender = await context.newPage();
    const receiver = await context.newPage();
    const channel = `e2e-same-origin-${Date.now()}`;

    await Promise.all([sender.goto("/"), receiver.goto("/")]);
    await Promise.all([
      installSameOriginBus(sender, channel),
      installSameOriginBus(receiver, channel),
    ]);
    await Promise.all([waitForBus(sender), waitForBus(receiver)]);

    await sender.evaluate(() => {
      void (window as E2eWindow).__gpenE2eBus?.send("storage.changed", {
        key: "visits",
        value: 1,
      });
    });
    await expect
      .poll(() => readMessages(receiver))
      .toEqual([{ type: "storage.changed", payload: { key: "visits", value: 1 } }]);
    expect(await readMessages(sender)).toEqual([]);

    await context.close();
  });

  test("uses real cross-origin WindowMessenger communication", async ({ page }) => {
    const channel = `e2e-cross-origin-${Date.now()}`;
    await page.goto("/");
    await page.evaluate((url) => {
      const iframe = document.createElement("iframe");
      iframe.id = "cross-origin-peer";
      iframe.src = url;
      document.body.append(iframe);
    }, `${originB}/?e2e=peer`);

    await expect
      .poll(() => page.frames().some((frame) => frame.url().startsWith(originB)))
      .toBe(true);
    const peer = page.frames().find((frame) => frame.url().startsWith(originB));
    if (!peer) throw new Error("Cross-origin iframe did not load");
    await peer.waitForLoadState("domcontentloaded");

    await installCrossOriginBus(peer, "parent", originA, channel);
    await installCrossOriginBus(page, "iframe", originB, channel);
    await Promise.all([waitForBus(page), waitForBus(peer)]);

    await page.evaluate(() => {
      void (window as E2eWindow).__gpenE2eBus?.send("storage.changed", {
        key: "note",
        value: "from-parent",
      });
    });
    await expect
      .poll(() => readMessages(peer))
      .toEqual([{ type: "storage.changed", payload: { key: "note", value: "from-parent" } }]);

    await peer.evaluate(() => {
      void (window as E2eWindow).__gpenE2eBus?.send("storage.changed", {
        key: "note",
        value: "from-iframe",
      });
    });
    await expect
      .poll(() => readMessages(page))
      .toEqual([{ type: "storage.changed", payload: { key: "note", value: "from-iframe" } }]);
  });

  test("uses the OPFS Blob broker in a cross-origin iframe", async ({ page }) => {
    await page.goto("/");
    const supported = await page.evaluate(
      () => typeof navigator.storage?.getDirectory === "function",
    );
    test.skip(!supported, "OPFS is unavailable in this browser");

    const result = await page.evaluate(
      async ({ modulePath: path, targetDomain: domain, id }) => {
        const { createOpfsTabBusBlobBackend } = await import(path);
        const blob = createOpfsTabBusBlobBackend({
          targetDomain: domain,
          loadTimeoutMs: 5_000,
        });
        try {
          await blob.set(id, new Blob(["brokered"]));
          return {
            name: blob.name,
            text: await (await blob.get(id))?.text(),
          };
        } finally {
          await blob.delete(id).catch(() => undefined);
          await blob.close();
        }
      },
      {
        modulePath: "/src/lib/bindings/storage/index.ts",
        targetDomain: originB,
        id: `e2e-opfs-${Date.now()}`,
      },
    );

    expect(result.name).toBe(`opfs+tabbus:${originB}`);
    expect(result.text).toBe("brokered");
  });
});
