import type { JsonValue } from "../types.js";

type StripState = {
  quote: boolean;
  escaped: boolean;
  lineComment: boolean;
  blockComment: boolean;
};

/** 消费注释内的一个字符；返回要输出的文本与下一个索引。 */
function consumeCommentCharacter(
  value: string,
  index: number,
  state: StripState,
): { text: string; nextIndex: number } {
  const character = value[index];
  if (state.lineComment) {
    if (character === "\n") {
      state.lineComment = false;
      return { text: character, nextIndex: index };
    }
    return { text: "", nextIndex: index };
  }
  if (character === "*" && value[index + 1] === "/") {
    state.blockComment = false;
    return { text: "", nextIndex: index + 1 };
  }
  return { text: "", nextIndex: index };
}

/** 更新引号内的转义状态（注释外的普通字符）。 */
function updateQuoteState(state: StripState, character: string): void {
  if (character === '"' && !state.escaped) state.quote = !state.quote;
  state.escaped = character === "\\" && !state.escaped;
}

/** 消费一个字符，返回要输出的文本与下一个索引（跳过注释起止符）。 */
function consumeJsonCharacter(
  value: string,
  index: number,
  state: StripState,
): { text: string; nextIndex: number } {
  if (state.lineComment || state.blockComment) {
    return consumeCommentCharacter(value, index, state);
  }
  const character = value[index];
  const next = value[index + 1];
  if (!state.quote && character === "/" && next === "/") {
    state.lineComment = true;
    return { text: "", nextIndex: index + 1 };
  }
  if (!state.quote && character === "/" && next === "*") {
    state.blockComment = true;
    return { text: "", nextIndex: index + 1 };
  }
  updateQuoteState(state, character);
  return { text: character, nextIndex: index };
}

/** 去掉 JSONC 的行 / 块注释与尾随逗号。 */
export function stripJsonComments(value: string): string {
  const state: StripState = {
    quote: false,
    escaped: false,
    lineComment: false,
    blockComment: false,
  };
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const step = consumeJsonCharacter(value, index, state);
    result += step.text;
    index = step.nextIndex;
  }
  return result.replace(/,\s*([}\]])/g, "$1");
}

/** 解析 `.gpen/state.jsonc`（空内容 → 空对象）。 */
export function parseState(data: Uint8Array | undefined): JsonValue {
  if (!data) return {};
  const text = new TextDecoder()
    .decode(data)
    .replace(/^\uFEFF/, "")
    .trim();
  if (!text) return {};
  return JSON.parse(stripJsonComments(text)) as JsonValue;
}

/** 把状态编码成带缩进的 UTF-8 JSON。 */
export function encodeState(value: JsonValue): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}
