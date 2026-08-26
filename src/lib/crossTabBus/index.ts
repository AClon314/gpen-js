export { createTabBus } from "./createTabBus.js";
export type { CreateTabBusOptions } from "./createTabBus.js";

export {
  isTabBusMessage,
  type ITabBus,
  type TabBusListener,
  type TabBusMessage,
  type TabBusSendOptions,
  type TabBusTransport,
} from "./base.js";

/** Same-origin tab communication backed by `BroadcastChannel`. */
export { SameOrigin } from "./sameOriginBus.js";
export type { BroadcastChannelFactory } from "./sameOriginBus.js";
export type { SameOriginBusOptions } from "./sameOriginBus.js";

/** Cross-origin tab communication backed by Penpal. */
export { CrossOriginBus, createCrossOriginStatelessRelay } from "./crossOriginBus.js";
export type {
  CrossOriginBusOptions,
  CrossOriginConnection,
  CrossOriginRemote,
  CrossOriginWindow,
  CrossOriginStatelessRelay,
  CrossOriginStatelessRelayOptions,
} from "./crossOriginBus.js";
