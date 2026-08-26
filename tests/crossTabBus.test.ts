import { describe, expect, test } from "bun:test";

import { CrossOriginBus, SameOrigin, createTabBus } from "../src/lib/crossTabBus/index.ts";

class FakeBroadcastChannel extends EventTarget implements BroadcastChannel {
  private static readonly channels = new Map<string, Set<FakeBroadcastChannel>>();
  private readonly peers: Set<FakeBroadcastChannel>;
  readonly name: string;
  onmessage: BroadcastChannel["onmessage"] = null;
  onmessageerror: BroadcastChannel["onmessageerror"] = null;
  private closed = false;

  constructor(name: string) {
    super();
    this.name = name;
    this.peers = FakeBroadcastChannel.channels.get(name) ?? new Set();
    this.peers.add(this);
    FakeBroadcastChannel.channels.set(name, this.peers);
  }

  postMessage(message: unknown): void {
    if (this.closed) throw new Error("channel is closed");
    for (const peer of this.peers) {
      if (peer === this || peer.closed) continue;
      const clone = structuredClone(message);
      queueMicrotask(() => peer.onmessage?.(new MessageEvent("message", { data: clone })));
    }
  }

  close(): void {
    this.closed = true;
    this.peers.delete(this);
    if (this.peers.size === 0) FakeBroadcastChannel.channels.delete(this.name);
  }
}

describe("cross-tab bus", () => {
  test("sends same-origin messages and supports unsubscribe", async () => {
    const options = { channelFactory: (name: string) => new FakeBroadcastChannel(name) };
    const sender = new SameOrigin("https://gpen.test", options);
    const receiver = new SameOrigin("https://gpen.test", options);
    const messages: unknown[] = [];
    const unsubscribe = receiver.onMessage((message) => messages.push(message));

    await sender.send("storage.changed", { path: ["visits"] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(messages).toEqual([{ type: "storage.changed", payload: { path: ["visits"] } }]);

    unsubscribe();
    await sender.send("storage.changed", { path: ["note"] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(messages).toHaveLength(1);

    sender.destroy();
    receiver.destroy();
    await expect(sender.send("after.destroy", null)).rejects.toThrow("destroyed");
  });

  test("passes structured-cloneable objects, Blob, and ArrayBuffer", async () => {
    const options = { channelFactory: (name: string) => new FakeBroadcastChannel(name) };
    const sender = new SameOrigin("https://gpen.test", options);
    const receiver = new SameOrigin("https://gpen.test", options);
    const received = new Promise<any>((resolve) => receiver.onMessage(resolve));
    const buffer = new Uint8Array([1, 2, 3]).buffer;

    await sender.send("payload", {
      object: { nested: true },
      blob: new Blob(["hello"], { type: "text/plain" }),
      buffer,
    });

    const message = await received;
    expect(message.payload.object).toEqual({ nested: true });
    expect(message.payload.blob).toBeInstanceOf(Blob);
    expect(await message.payload.blob.text()).toBe("hello");
    expect([...new Uint8Array(message.payload.buffer)]).toEqual([1, 2, 3]);
    expect(buffer.byteLength).toBe(3);

    sender.destroy();
    receiver.destroy();
  });

  test("carries ArrayBuffer payloads through BroadcastChannel cloning", async () => {
    const options = { channelFactory: (name: string) => new FakeBroadcastChannel(name) };
    const bus = new SameOrigin("https://gpen.test", options);
    const buffer = new ArrayBuffer(3);

    await expect(bus.send("payload", buffer, { transferables: [buffer] })).resolves.toBeUndefined();
    expect(buffer.byteLength).toBe(3);
    bus.destroy();
  });

  test("factory chooses same-origin transport and allows an explicit channel", () => {
    const bus = createTabBus({
      targetOrigin: "https://gpen.test",
      channelName: "storage:test",
      sameOrigin: { channelFactory: (name) => new FakeBroadcastChannel(name) },
    });

    expect(bus).toBeInstanceOf(SameOrigin);
    bus.destroy();
  });

  test("defaults to BroadcastChannel mode", () => {
    const bus = createTabBus({
      targetOrigin: "https://gpen.test",
      channelName: "storage:default-mode",
      sameOrigin: { channelFactory: (name) => new FakeBroadcastChannel(name) },
    });

    expect(bus).toBeInstanceOf(SameOrigin);
    bus.destroy();
  });

  test("connects two buses over Penpal MessagePorts", async () => {
    const ports = new MessageChannel();
    const left = new CrossOriginBus({ port: ports.port1, channel: "storage:pair" });
    const right = new CrossOriginBus({ port: ports.port2, channel: "storage:pair" });
    const received = new Promise<unknown>((resolve) => {
      right.onMessage(resolve);
    });

    await Promise.all([left.ready, right.ready]);
    await left.send("storage.changed", { key: "visits", value: 1 });
    expect(await received).toEqual({
      type: "storage.changed",
      payload: { key: "visits", value: 1 },
    });

    left.destroy();
    right.destroy();
  });

  test("transfers ArrayBuffer over the Penpal transport", async () => {
    const ports = new MessageChannel();
    const left = new CrossOriginBus({ port: ports.port1, channel: "storage:transfer" });
    const right = new CrossOriginBus({ port: ports.port2, channel: "storage:transfer" });
    const received = new Promise<any>((resolve) => right.onMessage(resolve));
    const buffer = new Uint8Array([4, 5, 6]).buffer;

    await Promise.all([left.ready, right.ready]);
    await left.send("binary", { buffer }, { transferables: [buffer] });

    expect(buffer.byteLength).toBe(0);
    expect([...new Uint8Array((await received).payload.buffer)]).toEqual([4, 5, 6]);

    left.destroy();
    right.destroy();
  });
});
