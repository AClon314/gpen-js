export {
  /** Creates a tab bus. Same-origin pages use BroadcastChannel by default; */
  createTabBus,
} from "./createTabBus.js";
export type {
  /** Options for creating a same-origin or cross-origin tab bus. */
  CreateTabBusOptions,
} from "./createTabBus.js";

export {
  /** 是否是合法的 tab bus 消息（type + payload）。 */
  isTabBusMessage,
  /** Common lifecycle and messaging API implemented by every tab bus. */
  type ITabBus,
  /** Callback invoked when a tab bus receives a message. */
  type TabBusListener,
  /** A message delivered through a tab bus. */
  type TabBusMessage,
  /** Options that affect how a message is sent. */
  type TabBusSendOptions,
  /** Selects the transport used by the tab-bus factory. */
  type TabBusTransport,
} from "./base.js";

/** Same-origin tab communication backed by `BroadcastChannel`. */
export {
  /** Communicates between same-origin tabs through `BroadcastChannel`. */
  SameOrigin,
} from "./sameOriginBus.js";
export type {
  /** 可注入的 BroadcastChannel 构造器（测试 / 降级）。 */
  BroadcastChannelFactory,
} from "./sameOriginBus.js";
export type {
  /** 同源 bus 选项（channel 名，或注入 channel / 工厂）。 */
  SameOriginBusOptions,
} from "./sameOriginBus.js";

/** Cross-origin tab communication backed by Penpal. */
export {
  /** A Penpal-backed bus for one remote window, `MessagePort`, or custom */
  CrossOriginBus,
  /** Bridges one cross-origin Penpal connection to a same-origin BroadcastChannel. */
  createCrossOriginStatelessRelay,
} from "./crossOriginBus.js";
export type {
  /** 跨域 bus 选项（目标 origin、channel、messenger / 连接、超时）。 */
  CrossOriginBusOptions,
  /** penpal 连接的 `destroy` + 远端代理 Promise。 */
  CrossOriginConnection,
  /** 对端暴露的 `receive` 方法。 */
  CrossOriginRemote,
  /** 跨域对端窗口（penpal WindowMessenger 接受的形状）。 */
  CrossOriginWindow,
  /** 跨域连接与同源 BroadcastChannel 之间的中继（destroy）。 */
  CrossOriginStatelessRelay,
  /** 无状态中继选项（对端窗口、targetOrigin、channel、BroadcastChannel）。 */
  CrossOriginStatelessRelayOptions,
} from "./crossOriginBus.js";
