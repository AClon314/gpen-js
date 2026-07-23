/** save & load */

import { ReactiveController, ReactiveControllerHost } from 'lit';

/**  */
export class ProxyController<T extends object> implements ReactiveController {
  private host: ReactiveControllerHost;

  public proxy: T;

  constructor(host: ReactiveControllerHost, initialState: T) {
    this.host = host;
    // 创建 Proxy
    this.proxy = new Proxy(initialState, {
      set: (obj, prop, value) => {
        const prevValue = (obj as any)[prop];
        (obj as any)[prop] = value;

        if (prevValue !== value) {
          // 触发宿主（组件）的更新
          this.host.requestUpdate();
        }
        return true;
      },
    });
    // 将控制器添加到宿主
    host.addController(this);
  }

  // 即使这里没用到生命周期，也可以留空
  // hostConnected() {}
}
