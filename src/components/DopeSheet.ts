/** Layer图层-动画摄影表 */
import { html, css, LitElement } from 'lit';
import { property } from 'lit/decorators.js';

export class DopeSheet extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 25px;
      color: var(--dope-sheet-text-color, #000);
    }
  `;

  @property({ type: String }) header = 'Hey there';

  @property({ type: Number }) counter = 5;

  __increment() {
    this.counter += 1;
  }

  render() {
    return html`
      <nav>${this.header} Nr. ${this.counter}!</nav>
      <sp-button @click=${this.__increment}>increment</sp-button>
    `;
  }
}

window.customElements.define('dope-sheet', DopeSheet);
