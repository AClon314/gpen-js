/**
 * CodeMirror 6 extension: a 2ch-wide `±` handle that scrubs the number at the
 * cursor by dragging. Shares its pixel→value math with `InputSlider`
 * (`scrubValue` / `scrubSensitivity` from `../numericScrub`).
 *
 * The handle is an inline widget at the end of the document. During a drag it
 * replaces the target token in place; `eq()` returns `true` so CodeMirror keeps
 * the same DOM node (and its `document`-level drag listeners) alive while the
 * document changes.
 */
import type { Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

import { decimalPlacesInText } from "../numericCaret.js";
import { scrubValue } from "../numericScrub.js";

/** A contiguous decimal number (same shape as the stepper's token). */
const NUMBER_SOURCE = "[+-]?(?:\\d+\\.?\\d*|\\.\\d+)";

interface NumberToken {
  from: number;
  to: number;
  text: string;
}

/** Number the primary caret sits in, falling back to the first number in the doc. */
export function scrubTarget(view: EditorView): NumberToken | undefined {
  const position = view.state.selection.main.head;
  const line = view.state.doc.lineAt(position);
  const offset = position - line.from;
  const linePattern = new RegExp(NUMBER_SOURCE, "g");
  let match: RegExpExecArray | null;
  while ((match = linePattern.exec(line.text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (offset >= start && offset <= end && Number.isFinite(Number(match[0]))) {
      return { from: line.from + start, to: line.from + end, text: match[0] };
    }
  }

  const documentPattern = new RegExp(NUMBER_SOURCE);
  const first = documentPattern.exec(view.state.doc.toString());
  if (first !== null && Number.isFinite(Number(first[0]))) {
    return { from: first.index, to: first.index + first[0].length, text: first[0] };
  }
  return undefined;
}

const scrubTheme = EditorView.baseTheme({
  ".gpen-number-scrubber": {
    display: "inline-block",
    boxSizing: "border-box",
    width: "2ch",
    height: "1lh",
    lineHeight: "1lh",
    marginInlineStart: "0.5ch",
    verticalAlign: "middle",
    textAlign: "center",
    border: "1px solid currentColor",
    borderRadius: "var(--gpen-radius, 3px)",
    color: "var(--gpen-panel-muted, #64748b)",
    cursor: "ew-resize",
    userSelect: "none",
    touchAction: "none",
    opacity: "0.55",
  },
  ".gpen-number-scrubber:hover": { opacity: "1" },
});

/** Stops the drag listeners when CodeMirror drops the widget's DOM. */
const widgetControllers = new WeakMap<HTMLElement, AbortController>();

class ScrubWidget extends WidgetType {
  constructor(
    readonly lower: number | undefined,
    readonly upper: number | undefined,
  ) {
    super();
  }

  // Keep the DOM node across doc updates so an in-flight drag survives.
  eq(): boolean {
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("span");
    element.className = "gpen-number-scrubber";
    element.textContent = "±";
    element.setAttribute("role", "slider");
    element.setAttribute("aria-label", "拖拽调整数值");

    const controller = new AbortController();
    widgetControllers.set(element, controller);

    element.addEventListener(
      "pointerdown",
      (event: PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const target = scrubTarget(view);
        if (target === undefined) return;

        const startX = event.clientX;
        const startValue = Number(target.text);
        const decimals = decimalPlacesInText(target.text);
        let length = target.text.length;

        const onMove = (moveEvent: PointerEvent) => {
          const next = scrubValue(
            startValue,
            moveEvent.clientX - startX,
            decimals,
            startValue,
            this.lower,
            this.upper,
          );
          const text = next.toFixed(decimals);
          view.dispatch({ changes: { from: target.from, to: target.from + length, insert: text } });
          length = text.length;
        };
        const onEnd = () => {
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onEnd);
          document.removeEventListener("pointercancel", onEnd);
        };

        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onEnd);
        document.addEventListener("pointercancel", onEnd);
      },
      { signal: controller.signal },
    );

    return element;
  }

  ignoreEvent(): boolean {
    return true;
  }

  destroy(dom: HTMLElement): void {
    widgetControllers.get(dom)?.abort();
    widgetControllers.delete(dom);
  }
}

export interface NumberScrubberOptions {
  /** Soft lower bound for scrubbing (typed values are never clamped). */
  lower?: number;
  /** Soft upper bound for scrubbing. */
  upper?: number;
}

function buildDecorations(view: EditorView, options: NumberScrubberOptions): DecorationSet {
  const widget = Decoration.widget({
    widget: new ScrubWidget(options.lower, options.upper),
    side: 1,
  });
  // Sit at the end of the line the caret is on, next to the number being scrubbed.
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  return Decoration.set([widget.range(line.to)], true);
}

/** Build the drag-scrub extension. */
export function numberScrubber(options: NumberScrubberOptions = {}): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, options);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet) {
          this.decorations = buildDecorations(update.view, options);
        }
      }
    },
    { decorations: (value) => value.decorations },
  );

  return [scrubTheme, plugin];
}
