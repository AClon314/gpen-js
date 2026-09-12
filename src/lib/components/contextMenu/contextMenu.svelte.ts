// 全局右键菜单的注册表、状态和浏览器事件桥接。

export type MenuItem = {
  label?: string | (() => string);
  disabled?: boolean | (() => boolean);
  action?: () => void;
  separator?: boolean;
  order?: number;
  [key: string]: unknown;
};

export type MenuItemProvider = MenuItem[] | (() => MenuItem[]);
export type ContextMenuOptions = string | MenuItemProvider;

type RegisteredProvider = {
  provider: MenuItemProvider;
  sequence: number;
};

const GLOBAL_ID = "*";
const CONTEXT_MENU_ID_ATTRIBUTE = "data-context-menu-id";
const LEGACY_CONTEXT_MENU_ID_ATTRIBUTE = "data-contextmenu-id";
const TOUCH_OPT_OUT_ATTRIBUTE = "data-context-menu-touch-opt-out";
const MENU_MARGIN_PX = 8;

/** UI state consumed by the singleton ContextMenu component. */
export const menuState = $state({
  visible: false,
  x: 0,
  y: 0,
  id: null as string | null,
  items: [] as MenuItem[],
  openVersion: 0,
});

// Registry mutations are deliberately not reactive. refresh() is the explicit
// bridge to the small piece of state that the menu component renders.
const registry = new Map<string, Map<symbol, RegisteredProvider>>();
let anonymousIdCounter = 0;
let registrationSequence = 0;

function anonymousId(): string {
  anonymousIdCounter += 1;
  return `__context_menu_${anonymousIdCounter}`;
}

function resolveProvider(provider: MenuItemProvider): MenuItem[] {
  const items = typeof provider === "function" ? provider() : provider;
  return items ?? [];
}

/**
 * Collect global and named providers in registration order, then sort their
 * items by order. The provider sequence is kept across ids so equal-order
 * global and named items have the same ordering as their registrations.
 */
function collect(id: string): MenuItem[] {
  const providers: RegisteredProvider[] = [];
  const ids = id === GLOBAL_ID ? [GLOBAL_ID] : [GLOBAL_ID, id];

  for (const providerId of ids) {
    const group = registry.get(providerId);
    if (!group) continue;
    providers.push(...group.values());
  }
  providers.sort((left, right) => left.sequence - right.sequence);

  const items: MenuItem[] = [];
  for (const registered of providers) items.push(...resolveProvider(registered.provider));
  return items.sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
}

function refresh() {
  if (!menuState.visible) return;
  const id = menuState.id;
  if (id === null) {
    close();
    return;
  }

  const items = collect(id);
  menuState.items = items;
  if (items.length === 0) close();
}

/** Register a provider and return a token-specific disposer. */
export function registerMenuItems(id: string, provider: MenuItemProvider): () => void {
  const token = Symbol("context-menu-items");
  let group = registry.get(id);
  if (!group) {
    group = new Map();
    registry.set(id, group);
  }
  group.set(token, { provider, sequence: registrationSequence++ });
  refresh();

  return () => {
    const currentGroup = registry.get(id);
    if (!currentGroup || !currentGroup.delete(token)) return;
    if (currentGroup.size === 0) registry.delete(id);
    refresh();
  };
}

/**
 * Svelte action that associates a DOM node with a named or anonymous registry
 * entry. Anonymous providers belong to this action instance and are disposed
 * with it; named entries are intentionally left for external registration.
 */
export function contextMenu(node: HTMLElement, options: ContextMenuOptions) {
  let id: string | null = null;
  let disposeOwn: (() => void) | undefined;

  function apply(nextOptions: ContextMenuOptions) {
    disposeOwn?.();
    disposeOwn = undefined;

    if (typeof nextOptions === "string") {
      id = nextOptions;
    } else {
      id = anonymousId();
      disposeOwn = registerMenuItems(id, nextOptions);
    }

    node.dataset.contextMenuId = id;
  }

  apply(options);

  return {
    update: apply,
    destroy() {
      disposeOwn?.();
      disposeOwn = undefined;
      if (node.dataset.contextMenuId === id) delete node.dataset.contextMenuId;
    },
  };
}

function viewportSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 0, height: 0 };
  const visualViewport = window.visualViewport;
  return {
    width: visualViewport?.width || window.innerWidth,
    height: visualViewport?.height || window.innerHeight,
  };
}

function clampCoordinate(value: number, size: number, viewport: number): number {
  const coordinate = Number.isFinite(value) ? value : MENU_MARGIN_PX;
  if (viewport <= 0) return Math.max(MENU_MARGIN_PX, coordinate);
  const maximum = Math.max(MENU_MARGIN_PX, viewport - Math.max(0, size) - MENU_MARGIN_PX);
  return Math.min(Math.max(MENU_MARGIN_PX, coordinate), maximum);
}

/** Re-clamp the rendered menu after its actual dimensions are known. */
export function clampMenuPosition(width = 0, height = 0) {
  if (!menuState.visible) return;
  const viewport = viewportSize();
  const x = clampCoordinate(menuState.x, width, viewport.width);
  const y = clampCoordinate(menuState.y, height, viewport.height);
  if (menuState.x !== x) menuState.x = x;
  if (menuState.y !== y) menuState.y = y;
}

/** Open a registered menu at client coordinates. Returns false when empty. */
export function open(id: string, x: number, y: number): boolean {
  const items = collect(id);
  if (items.length === 0) {
    close();
    return false;
  }

  const viewport = viewportSize();
  menuState.id = id;
  menuState.items = items;
  menuState.x = clampCoordinate(x, 0, viewport.width);
  menuState.y = clampCoordinate(y, 0, viewport.height);
  menuState.visible = true;
  menuState.openVersion += 1;
  return true;
}

/** Alias for callers that prefer a verb-named API. */
export const openMenu = open;

export function close() {
  if (menuState.visible) menuState.visible = false;
}

function targetElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function contextMenuElement(target: EventTarget | null): HTMLElement | null {
  const element = targetElement(target);
  const candidate = element?.closest(
    `[${CONTEXT_MENU_ID_ATTRIBUTE}], [${LEGACY_CONTEXT_MENU_ID_ATTRIBUTE}]`,
  );
  return candidate instanceof HTMLElement ? candidate : null;
}

function contextMenuId(node: HTMLElement): string | null {
  return (
    node.dataset.contextMenuId ??
    node.dataset.contextmenuId ??
    node.getAttribute(CONTEXT_MENU_ID_ATTRIBUTE) ??
    node.getAttribute(LEGACY_CONTEXT_MENU_ID_ATTRIBUTE)
  );
}

function cancelTouchSession(session: TouchSession | undefined) {
  if (session?.timer !== undefined) clearTimeout(session.timer);
}

interface TouchSession {
  id: string;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  triggered: boolean;
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  let touchSession: TouchSession | undefined;

  function clearTouchSession() {
    cancelTouchSession(touchSession);
    touchSession = undefined;
  }

  document.addEventListener("contextmenu", (event) => {
    const target = contextMenuElement(event.target);
    if (!target) {
      close();
      return;
    }

    const id = contextMenuId(target);
    if (id === null || !open(id, event.clientX, event.clientY)) return;
    event.preventDefault();
  });

  document.addEventListener(
    "touchstart",
    (event) => {
      clearTouchSession();
      const target = contextMenuElement(event.target);
      if (!target || target.hasAttribute(TOUCH_OPT_OUT_ATTRIBUTE)) return;

      const touch = event.touches[0];
      const id = contextMenuId(target);
      if (!touch || id === null) return;

      const session: TouchSession = {
        id,
        x: touch.clientX,
        y: touch.clientY,
        timer: undefined,
        triggered: false,
      };
      touchSession = session;
      session.timer = setTimeout(() => {
        session.timer = undefined;
        if (touchSession !== session) return;
        if (open(session.id, session.x, session.y)) {
          session.triggered = true;
          if (typeof navigator !== "undefined") navigator.vibrate?.(10);
        }
      }, 500);
    },
    { passive: true },
  );

  document.addEventListener(
    "touchmove",
    (event) => {
      const session = touchSession;
      if (!session || session.triggered) return;
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - session.x;
      const dy = touch.clientY - session.y;
      if (dx * dx + dy * dy > 100) clearTouchSession();
    },
    { passive: true },
  );

  document.addEventListener(
    "touchend",
    (event) => {
      const triggered = touchSession?.triggered ?? false;
      clearTouchSession();
      // A long-press menu should not be followed by the synthetic click that
      // browsers normally dispatch for the same touch.
      if (triggered) event.preventDefault();
    },
    { passive: false },
  );
  document.addEventListener("touchcancel", clearTouchSession, { passive: true });

  window.addEventListener("click", (event) => {
    const root = document.querySelector("[data-context-menu-root]");
    if (root && event.target instanceof Node && root.contains(event.target)) return;
    close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
  window.addEventListener("scroll", close, true);
  window.addEventListener("wheel", close, { passive: true });
  window.addEventListener("resize", close);
  window.visualViewport?.addEventListener("resize", close, { passive: true });
  window.visualViewport?.addEventListener("scroll", close, { passive: true });
}
