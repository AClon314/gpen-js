/** 标签页，支持水平与垂直 */
import { html, css, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { emit } from '@/vue3.js';

export interface IcoStr {
  ico?: string;
  str?: string;
}

@customElement('inf-tabs')
export class Tabs extends LitElement {
  static styles = css`
    :host {
    }
  `;

  @property({ type: Array }) icoStrs: IcoStr[] = [];
  @property({ type: String }) showClose: '' | 'current' | 'all' = 'current';

  close(icoStr: IcoStr) {
    emit(this, 'onClose', icoStr);
  }

  renderTab(icoStr: IcoStr) {
    return html`
      <img src="${icoStr.ico}" />
      <sp-button @click=${() => this.close(icoStr)}>x</sp-button>
    `;
  }
  render() {
    return html`
      <nav>${this.icoStrs.map(icoStr => this.renderTab(icoStr))}</nav>
    `;
  }
}
