/** 网页上的悬浮球入口 */
import '@interactjs/actions';
import '@interactjs/auto-start';
import '@interactjs/modifiers';
import interact from '@interactjs/interact';
import '@spectrum-web-components/button/sp-button.js';
import { html, LitElement } from 'lit';
import { css } from '@lit/reactive-element/css-tag.js';
import { customElement, property } from 'lit/decorators.js';

type DragMoveEvent = {
  dx: number;
  dy: number;
};

/** 悬浮球, 鼠标5个键位(点击，拖拽) */
@customElement('floating-ball')
export class FloatingBall extends LitElement {
  private xPercent = 0;

  private yPercent = 0;

  private interactable?: { unset(): void };

  static styles = css`
    :host {
      position: fixed;
      z-index: 1000;
    }
    sp-button.gpen {
      height: 1rem;
    }
  `;

  @property({ type: String }) header = 'Hey there';

  @property({ type: Number }) counter = 5;

  override firstUpdated() {
    this.interactable = interact(this).draggable({
      modifiers: [
        interact.modifiers.restrictRect({
          restriction: () => ({
            left: 0,
            top: 0,
            right: window.innerWidth,
            bottom: window.innerHeight,
          }),
        }),
      ],
      listeners: {
        move: (event: DragMoveEvent) => {
          this.xPercent += (event.dx / window.innerWidth) * 100;
          this.yPercent += (event.dy / window.innerHeight) * 100;
          this.style.transform = `translate(${this.xPercent}vw, ${this.yPercent}vh)`;
        },
      },
    });
  }

  override disconnectedCallback() {
    this.interactable?.unset();
    this.interactable = undefined;
    super.disconnectedCallback?.();
  }

  showEditor() {
    this.counter += 1;
  }

  render() {
    return html`<sp-button class="gpen" @click=${this.showEditor}>
      Gpen
    </sp-button>`;
  }
}
