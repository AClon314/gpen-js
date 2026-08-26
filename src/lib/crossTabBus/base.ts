/** A message delivered through a tab bus. */
export interface TabBusMessage<TPayload = unknown> {
  readonly type: string;
  readonly payload: TPayload;
}

/** Callback invoked when a tab bus receives a message. */
export type TabBusListener<TPayload = unknown> = (message: TabBusMessage<TPayload>) => void;

/** Options that affect how a message is sent. */
export interface TabBusSendOptions {
  /** Transfer these objects instead of structured-cloning them. */
  transferables?: readonly Transferable[];
}

/** Common lifecycle and messaging API implemented by every tab bus. */
export interface ITabBus<TPayload = unknown> {
  send(type: string, payload: TPayload, options?: TabBusSendOptions): Promise<void>;
  onMessage(callback: TabBusListener<TPayload>): () => void;
  destroy(): void;
  /** Connection-based transports expose their handshake here. */
  readonly ready?: Promise<void>;
}

/** Selects the transport used by the tab-bus factory. */
export type TabBusTransport = "same-origin" | "cross-origin";

export function assertMessageType(type: unknown): asserts type is string {
  if (typeof type !== "string" || type.length === 0) {
    throw new TypeError("Tab bus message type must be a non-empty string");
  }
}

export function isTabBusMessage<TPayload = unknown>(
  value: unknown,
): value is TabBusMessage<TPayload> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    (value as { type: string }).type.length > 0 &&
    Object.prototype.hasOwnProperty.call(value, "payload")
  );
}

export abstract class TabBusBase<TPayload = unknown> implements ITabBus<TPayload> {
  protected readonly listeners = new Set<TabBusListener<TPayload>>();
  protected destroyed = false;

  abstract send(type: string, payload: TPayload, options?: TabBusSendOptions): Promise<void>;

  abstract destroy(): void;

  onMessage(callback: TabBusListener<TPayload>): () => void {
    if (typeof callback !== "function") {
      throw new TypeError("Tab bus listener must be a function");
    }
    if (this.destroyed) return () => undefined;

    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  protected dispatch(message: TabBusMessage<TPayload>): void {
    for (const listener of this.listeners) listener(message);
  }

  protected markDestroyed(): boolean {
    if (this.destroyed) return false;
    this.destroyed = true;
    this.listeners.clear();
    return true;
  }
}
