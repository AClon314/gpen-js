import { CallOptions, connect, PortMessenger, WindowMessenger } from "penpal";
import type { Connection, Messenger, Methods, RemoteProxy } from "penpal";

import { createBroadcastChannel, type BroadcastChannelFactory } from "./sameOriginBus.js";
import {
  assertMessageType,
  isTabBusMessage,
  TabBusBase,
  type TabBusMessage,
  type TabBusSendOptions,
} from "./base.js";

export type CrossOriginWindow = ConstructorParameters<typeof WindowMessenger>[0]["remoteWindow"];

export interface CrossOriginRemote {
  receive(message: TabBusMessage, options?: CallOptions): void | Promise<void>;
}

type CrossOriginMethods = Methods & CrossOriginRemote;

export type CrossOriginConnection = Pick<Connection<CrossOriginMethods>, "destroy"> & {
  promise: PromiseLike<CrossOriginRemote | RemoteProxy<CrossOriginMethods>>;
};

export interface CrossOriginBusOptions {
  /** Penpal's allowed origin when using a WindowMessenger. */
  targetOrigin?: string;
  /** Shared Penpal channel. Use the same value on both sides of a connection. */
  channel?: string;
  remoteWindow?: CrossOriginWindow;
  port?: MessagePort;
  messenger?: Messenger;
  /** Useful for host adapters and tests that already own a Penpal connection. */
  connection?: CrossOriginConnection;
  remote?: CrossOriginRemote | PromiseLike<CrossOriginRemote>;
  timeout?: number;
  log?: (...args: unknown[]) => void;
}

function createMessenger(options: CrossOriginBusOptions): Messenger {
  const endpoints = [options.messenger, options.remoteWindow, options.port].filter(
    (endpoint) => endpoint !== undefined,
  ).length;
  if (endpoints > 1) {
    throw new TypeError("Cross-origin bus accepts only one transport endpoint");
  }
  if (options.messenger) return options.messenger;

  if (options.remoteWindow) {
    if (!options.targetOrigin) {
      throw new TypeError("targetOrigin is required when using a remote window");
    }
    return new WindowMessenger({
      remoteWindow: options.remoteWindow,
      allowedOrigins: [options.targetOrigin],
    });
  }
  if (options.port) return new PortMessenger({ port: options.port });

  throw new Error(
    "Cross-origin bus requires a remote window, MessagePort, Penpal messenger, or connection",
  );
}

function createConnection(
  options: CrossOriginBusOptions,
  receive: (message: unknown) => void,
): CrossOriginConnection {
  if (options.connection) return options.connection;
  if (options.remote) {
    return {
      promise: Promise.resolve(options.remote),
      destroy() {},
    };
  }

  const messenger = createMessenger(options);
  return connectWithReceive(messenger, options, receive);
}

function connectWithReceive(
  messenger: Messenger,
  options: Pick<CrossOriginBusOptions, "channel" | "timeout" | "log">,
  receive: (message: unknown) => void | Promise<void>,
): CrossOriginConnection {
  return connect<CrossOriginMethods>({
    messenger,
    channel: options.channel,
    timeout: options.timeout,
    log: options.log,
    methods: {
      receive(message: unknown) {
        return receive(message);
      },
    },
  });
}

/**
 * A Penpal-backed bus for one remote window, `MessagePort`, or custom
 * messenger. The bus does not echo messages to its own listeners.
 *
 * @example
 * ```ts
 * import { CrossOriginBus } from "./crossTabBus/index.js";
 *
 * const channel = new MessageChannel();
 * const sender = new CrossOriginBus({ port: channel.port1 });
 * const receiver = new CrossOriginBus({ port: channel.port2 });
 *
 * await Promise.all([sender.ready, receiver.ready]);
 * const unsubscribe = receiver.onMessage(({ type, payload }) => {
 *   console.log(type, payload);
 * });
 * await sender.send("storage.changed", { key: "visits", value: 1 });
 *
 * unsubscribe();
 * sender.destroy();
 * receiver.destroy();
 * ```
 */
export class CrossOriginBus extends TabBusBase {
  readonly ready: Promise<void>;
  readonly _connection: CrossOriginConnection;
  _sendTail: Promise<void> = Promise.resolve();
  _remote: CrossOriginRemote | undefined;

  constructor(options: CrossOriginBusOptions) {
    super();

    this._connection = createConnection(options, (message) => this._receive(message));
    this.ready = Promise.resolve(this._connection.promise).then((remote) => {
      if (!remote || typeof remote.receive !== "function") {
        throw new TypeError("Penpal endpoint does not expose a receive method");
      }
      this._remote = remote;
    });
    // A bus may be used only for incoming notifications. Keep a connection
    // failure observable through `ready` without creating an unhandled rejection.
    void this.ready.catch(() => undefined);
  }

  async send(type: string, payload: unknown, options?: TabBusSendOptions): Promise<void> {
    assertMessageType(type);
    const operation = this._sendTail.then(async () => {
      if (this.destroyed) throw new Error("Tab bus has been destroyed");
      await this.ready;
      if (!this._remote) throw new Error("Cross-origin tab bus is not connected");
      const message = { type, payload };
      if (options?.transferables?.length) {
        await this._remote.receive(
          message,
          new CallOptions({ transferables: [...options.transferables] }),
        );
        return;
      }
      await this._remote.receive(message);
    });
    this._sendTail = operation.catch(() => undefined);
    return operation;
  }

  destroy(): void {
    if (!this.markDestroyed()) return;
    this._remote = undefined;
    this._connection.destroy();
  }

  _receive(value: unknown): void {
    if (this.destroyed || !isTabBusMessage(value)) return;
    this.dispatch(value);
  }
}

export interface CrossOriginStatelessRelayOptions {
  remoteWindow: CrossOriginWindow;
  targetOrigin: string;
  channel: string;
  broadcastChannel?: BroadcastChannel;
  broadcastChannelFactory?: BroadcastChannelFactory;
  timeout?: number;
}

export interface CrossOriginStatelessRelay {
  destroy(): void;
}

/**
 * Bridges one cross-origin Penpal connection to a same-origin BroadcastChannel.
 * Run this in a small same-origin iframe shared by the participating pages.
 * BroadcastChannel is intentionally stateless: late subscribers only observe
 * future messages, so storage listeners should reload their persisted state.
 */
export function createCrossOriginStatelessRelay(
  options: CrossOriginStatelessRelayOptions,
): CrossOriginStatelessRelay {
  const peer = new CrossOriginBus({
    remoteWindow: options.remoteWindow,
    targetOrigin: options.targetOrigin,
    channel: options.channel,
    timeout: options.timeout,
  });
  const channel = createBroadcastChannel(options.channel, {
    channel: options.broadcastChannel,
    channelFactory: options.broadcastChannelFactory,
  });
  const unsubscribe = peer.onMessage((message) => {
    channel.postMessage(message);
  });
  const onMessage = (event: MessageEvent) => {
    if (!isTabBusMessage(event.data)) return;
    void peer.send(event.data.type, event.data.payload).catch(() => undefined);
  };
  channel.onmessage = onMessage;

  return {
    destroy() {
      unsubscribe();
      peer.destroy();
      channel.onmessage = null;
      channel.close();
    },
  };
}
