/**
 * CodeMirror 6 extension: step the number under the cursor with the arrow keys.
 *
 * Reuses the same pure stepper as `InputNumber` (`stepAtCaret` from
 * `../numericCaret`) — the extension only adds the CodeMirror wiring (finding
 * the numeric token, dispatching a transaction). No stepping logic is
 * duplicated.
 *
 * Trigger rules (from the task spec):
 * - a single-line document: ↑/↓ step; ←/→ keep their native cursor movement;
 * - a multi-line document: only `CapsLock` + any arrow steps (↑/→ forward,
 *   ↓/← backward), so plain arrows still navigate the text.
 */
import { EditorSelection, Prec, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { roundTo, softClampTo, stepAtCaret } from "../numericCaret.js";

/** A contiguous decimal number (sign, optional fraction, bare `.5` / `5.`). */
const NUMBER_SOURCE = "[+-]?(?:\\d+\\.?\\d*|\\.\\d+)";

interface NumberToken {
  from: number;
  to: number;
  text: string;
}

/** Numeric token the caret sits in (or touches at either end). */
export function numberTokenAt(view: EditorView, position: number): NumberToken | undefined {
  const line = view.state.doc.lineAt(position);
  const offset = position - line.from;
  const pattern = new RegExp(NUMBER_SOURCE, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line.text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (offset >= start && offset <= end && Number.isFinite(Number(match[0]))) {
      return { from: line.from + start, to: line.from + end, text: match[0] };
    }
  }
  return undefined;
}

function formatStep(value: number, decimals: number | undefined): string {
  return decimals === undefined ? String(value) : value.toFixed(decimals);
}

export interface NumberStepperOptions {
  /** Soft lower bound for arrow steps (typed values are never clamped). */
  lower?: number;
  /** Soft upper bound for arrow steps. */
  upper?: number;
  /** Decimal width arrow steps are rounded to (usually the `step`'s decimals). */
  decimals?: number;
}

/**
 * Build the arrow-stepping extension. Wrap in `extensions: [...]` like any
 * other CodeMirror extension.
 */
export function numberStepper(options: NumberStepperOptions = {}): Extension {
  const { lower, upper, decimals } = options;

  return Prec.high(
    EditorView.domEventHandlers({
      keydown(event, view) {
        const key = event.key;
        const horizontal = key === "ArrowLeft" || key === "ArrowRight";
        const vertical = key === "ArrowUp" || key === "ArrowDown";
        if (!horizontal && !vertical) return false;

        if (view.state.doc.lines > 1) {
          // Multi-line: plain arrows must keep navigating; CapsLock opts in.
          if (!event.getModifierState("CapsLock")) return false;
        } else if (horizontal) {
          // Single line: only ↑/↓ step.
          return false;
        }

        const selection = view.state.selection.main;
        const token = numberTokenAt(view, selection.head);
        if (token === undefined) return false;

        const caret = Math.min(token.text.length, Math.max(0, selection.head - token.from));
        const direction = key === "ArrowDown" || key === "ArrowLeft" ? -1 : 1;
        const stepped = stepAtCaret(token.text, caret, direction);
        const raw = Number(stepped.text);
        if (!Number.isFinite(raw)) return false;

        const rounded = roundTo(raw, decimals);
        const origin = Number(token.text);
        const next = softClampTo(rounded, origin, lower, upper);
        const text = Object.is(next, raw) ? stepped.text : formatStep(next, decimals);

        view.dispatch({
          changes: { from: token.from, to: token.to, insert: text },
          selection: EditorSelection.cursor(token.from + Math.min(stepped.caret, text.length)),
          scrollIntoView: true,
        });
        return true;
      },
    }),
  );
}
