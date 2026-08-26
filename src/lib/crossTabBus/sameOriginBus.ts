import { assertMessageType, isTabBusMessage, TabBusBase, type TabBusSendOptions } from "./base.js";

export type BroadcastChannelFactory = (name: string) => BroadcastChannel;

export function createBroadcastChannel(
  name: string,
  options: {
    channel?: BroadcastChannel;
    channelFactory?: BroadcastChannelFactory;
  } = {},
): BroadcastChannel {
  if (options.channel) return options.channel;
  if (options.channelFactory) return options.channelFactory(name);

  if (!globalThis.BroadcastChannel) {
    throw new Error("BroadcastChannel is unavailable in this runtime");
  }
  return new globalThis.BroadcastChannel(name);
}

export interface SameOriginBusOptions {
  channelName?: string;
  channel?: BroadcastChannel;
  channelFactory?: BroadcastChannelFactory;
}

/**
 * Communicates between same-origin tabs through `BroadcastChannel`.
 *
 * @example
 * ```ts
 * import { SameOrigin } from "./crossTabBus/index.js";
 *
 * const bus = new SameOrigin(location.origin, {
 *   channelName: "gpen:storage",
 * });
 * const unsubscribe = bus.onMessage(({ type, payload }) => {
 *   console.log(type, payload);
 * });
 *
 * await bus.send("storage.changed", { key: "visits", value: 1 });
 * unsubscribe();
 * bus.destroy();
 * ```
 */
export class SameOrigin extends TabBusBase {
  readonly ready = Promise.resolve();
  readonly _channel: BroadcastChannel;

  constructor(targetOrigin: string, options: SameOriginBusOptions = {}) {
    super();

    if (typeof targetOrigin !== "string" || targetOrigin.length === 0) {
      throw new TypeError("Same-origin tab bus requires a non-empty target origin");
    }

    const channelName = options.channelName ?? `SameOrigin-${targetOrigin}`;
    this._channel = createBroadcastChannel(channelName, options);
    this._channel.onmessage = (event) => {
      if (!isTabBusMessage(event.data) || this.destroyed) return;
      this.dispatch(event.data);
    };
  }

  async send(type: string, payload: unknown, _options?: TabBusSendOptions): Promise<void> {
    assertMessageType(type);
    if (this.destroyed) throw new Error("Tab bus has been destroyed");

    // BroadcastChannel uses structured cloning. Transfer lists are useful to
    // the cross-origin transport, but ArrayBuffer payloads remain supported
    // here as ordinary clones.
    this._channel.postMessage({ type, payload });
  }

  destroy(): void {
    if (!this.markDestroyed()) return;
    this._channel.onmessage = null;
    this._channel.close();
  }
}
