/** vue3风格api */

interface EmitOptions {
  /** 不仅仅广播到父组件 @default true */
  bubbles?: boolean;
  /** 使事件穿过影子 DOM 边界 @default true */
  composed?: boolean;
}
/** `emit(this, 'update:var', newValue);`
 *
 * Then in parent component:
 * ```html
 * <my-component
 *   .var=${this.myVar}
 *   \@update:var="${(e) => this.myVar = e.detail}"
 * />
 * ```
 */
export function emit(
  This: HTMLElement,
  eventName: string,
  detail?: any,
  options: EmitOptions = {},
) {
  This.dispatchEvent(
    new CustomEvent(eventName, {
      detail,
      bubbles: true,
      composed: true,
      ...options,
    }),
  );
}
