import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";

import { numberScrubber } from "#lib/inputs/codemirror/numberScrubber";
import { numberStepper } from "#lib/inputs/codemirror/numberStepper";

/** 手搓 EditorView 的共用主题；高度由调用点按 demo 场景给。 */
function demoTheme(height: string): Extension {
  return EditorView.theme({
    "&": {
      height,
      border: "1px solid var(--gpen-panel-border)",
      borderRadius: "var(--gpen-radius)",
      background: "var(--gpen-panel-background)",
      color: "var(--gpen-panel-foreground)",
      fontSize: "var(--gpen-font-size)",
    },
    "&.cm-focused": {
      outline: "none",
      borderColor: "var(--gpen-panel-accent)",
      boxShadow: "0 0 0 1px rgb(79 70 229 / 0.18)",
    },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily: "var(--gpen-font-mono)",
      lineHeight: "var(--gpen-line-height)",
    },
    ".cm-content": { padding: "0.4lh 0" },
    ".cm-line": { padding: "0 1ch" },
  });
}

function baseExtensions(extra: Extension): Extension {
  return [history(), drawSelection(), keymap.of([...defaultKeymap, ...historyKeymap]), extra];
}

/**
 * 上半节的演示：两个直接挂数值插件的手搓 EditorView（单行 / 多行）。
 * 返回销毁函数，调用点在 onMount 的清理里执行。
 */
export function mountNumberPluginEditors(
  singleHost: HTMLElement,
  multiHost: HTMLElement,
): () => void {
  const single = new EditorView({
    state: EditorState.create({
      doc: "9.98",
      extensions: baseExtensions([
        numberStepper({ lower: 0, upper: 100, decimals: 2 }),
        numberScrubber({ lower: 0, upper: 100 }),
        demoTheme("3lh"),
      ]),
    }),
    parent: singleHost,
  });
  const multi = new EditorView({
    state: EditorState.create({
      doc: "长度 12.5\n宽度 8.0",
      extensions: baseExtensions([numberStepper(), numberScrubber(), demoTheme("6lh")]),
    }),
    parent: multiHost,
  });
  const views = [single, multi];
  single.focus();

  return () => {
    for (const view of views) view.destroy();
  };
}

/**
 * 下半节 CodeEditor 卡片用的注入扩展。一次性建好数组：`extensions` 每次传新数组都会让
 * 配置 compartment 重配，实例复用更省事（numberStepper 本身无状态，重配也不会丢什么）。
 */
export const stepperExtensions = [numberStepper({ lower: 0, upper: 100, decimals: 2 })];
