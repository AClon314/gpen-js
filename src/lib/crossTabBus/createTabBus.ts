import { CrossOriginBus } from "./crossOriginBus.js";
import type { CrossOriginBusOptions } from "./crossOriginBus.js";
import { SameOrigin } from "./sameOriginBus.js";
import type { SameOriginBusOptions } from "./sameOriginBus.js";
import type { ITabBus, TabBusTransport } from "./base.js";

/** Options for creating a same-origin or cross-origin tab bus. */
export interface CreateTabBusOptions {
  /** Logical channel namespace. It must be the same for all participants. */
  channelName?: string;
  /** Origin used for the same-origin channel name or Penpal allow-list. */
  targetOrigin?: string;
  /** Cross-origin transport override; otherwise inferred from its endpoint. */
  transport?: TabBusTransport;
  /** Options passed to the same-origin BroadcastChannel transport. */
  sameOrigin?: Omit<SameOriginBusOptions, "channelName">;
  /** Options passed to the cross-origin Penpal transport. */
  crossOrigin?: Omit<CrossOriginBusOptions, "targetOrigin" | "channel">;
}

function hasCrossOriginEndpoint(options: CreateTabBusOptions): boolean {
  const crossOrigin = options.crossOrigin;
  return Boolean(
    crossOrigin?.connection ||
    crossOrigin?.messenger ||
    crossOrigin?.remote ||
    crossOrigin?.remoteWindow ||
    crossOrigin?.port,
  );
}

function createTransport(
  options: CreateTabBusOptions,
  targetOrigin: string,
  channelName: string | undefined,
): ITabBus {
  const transport =
    options.transport ?? (hasCrossOriginEndpoint(options) ? "cross-origin" : "same-origin");
  if (transport === "cross-origin") {
    return new CrossOriginBus({
      ...options.crossOrigin,
      targetOrigin,
      ...(channelName === undefined ? {} : { channel: channelName }),
    });
  }

  return new SameOrigin(targetOrigin, {
    ...options.sameOrigin,
    ...(channelName === undefined ? {} : { channelName }),
  });
}

/**
 * Creates a tab bus. Same-origin pages use BroadcastChannel by default;
 * connection endpoints opt into the Penpal transport.
 */
export function createTabBus(options: CreateTabBusOptions): ITabBus {
  const targetOrigin = options.targetOrigin ?? globalThis.location?.origin ?? "gpen";
  const channelName = options.channelName;
  return createTransport(options, targetOrigin, channelName);
}
