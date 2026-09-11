/**
 * 自定义 oxlint 规则集（plugin: catch）
 *
 * rules:
 *  - must-return-or-throw: error 级。
 *     `.catch` 的闭包为 `=> { }` / `function () { }`（块体），或 try/catch 的
 *     catch 块内，必须显式含 `return` / `throw`；`resolve()` / `reject()` 这类
 *     Promise 结算调用（new Promise executor）也视为有效出口（它们终止控制流、
 *     不静默吞错误）。
 *  - no-bare-return: warn 级（不影响退出码）。
 *     catch 块内出现裸 `return;`（返回 undefined、刻意忽略错误）时提示要小心；
 *     若该 catch 块内已有 `console.*` 诊断日志（视为已留痕），则不再提示。
 *
 * 说明：`.catch((e) => value)` 表达式体返回 undefined 的检测需要类型信息，由
 * type-aware 的 @typescript-eslint 规则「no-void-catch-return」负责。
 */

// —— 模块级共享工具函数（不依赖 context） ——

function isFunctionNode(n) {
  return (
    n.type === "FunctionDeclaration" ||
    n.type === "FunctionExpression" ||
    n.type === "ArrowFunctionExpression"
  );
}

function isCatchCall(node) {
  const callee = node.callee;
  if (!callee || callee.type !== "MemberExpression" || callee.computed) {
    return false;
  }
  const prop = callee.property;
  return !!prop && prop.type === "Identifier" && prop.name === "catch";
}

const SETTLER_CALL_NAMES = ["resolve", "reject"];

function isSettlerCall(n) {
  if (!n || n.type !== "CallExpression") return false;
  const callee = n.callee;
  return callee && callee.type === "Identifier" && SETTLER_CALL_NAMES.indexOf(callee.name) !== -1;
}

/**
 * 遍历一块代码块（BlockStatement），跳过 AST 元数据字段（parent / range / loc /
 * start / end / type / value / raw）与嵌套函数体。返回是否命中 visitor。
 */
function walkBlock(node, visitor) {
  let hit = null;

  function walk(n) {
    if (!n || hit) return;
    if (n !== node && isFunctionNode(n)) {
      // 嵌套函数：不深入，子函数内的语句不算数
      return;
    }
    if (visitor(n)) {
      hit = n;
      return;
    }
    for (const key of Object.keys(n)) {
      if (
        key === "parent" ||
        key === "loc" ||
        key === "range" ||
        key === "start" ||
        key === "end" ||
        key === "type" ||
        key === "value" ||
        key === "raw"
      ) {
        continue;
      }
      const child = n[key];
      if (Array.isArray(child)) {
        for (const item of child) walk(item);
      } else if (child && typeof child === "object" && child.type) {
        walk(child);
      }
    }
  }

  walk(node);
  return hit;
}

function hasReturnOrThrow(node) {
  if (!node || node.type !== "BlockStatement") return false;
  return !!walkBlock(
    node,
    (n) => n.type === "ReturnStatement" || n.type === "ThrowStatement" || isSettlerCall(n),
  );
}

// 裸 return;（无参数）即返回 undefined：刻意忽略错误。返回命中的 ReturnStatement 节点。
function findBareReturn(node) {
  if (!node || node.type !== "BlockStatement") return null;
  return walkBlock(node, (n) => n.type === "ReturnStatement" && n.argument == null);
}

function isConsoleCall(n) {
  if (!n || n.type !== "CallExpression") return false;
  const callee = n.callee;
  if (!callee || callee.type !== "MemberExpression" || callee.computed) {
    return false;
  }
  const object = callee.object;
  return !!object && object.type === "Identifier" && object.name === "console";
}

// catch 块内是否已有诊断日志（console.*）：有则视为已留痕，豁免 no-bare-return
function hasConsoleCall(node) {
  if (!node || node.type !== "BlockStatement") return false;
  return !!walkBlock(node, isConsoleCall);
}

function getCatchCallbackBody(callback) {
  // 仅处理块体回调；表达式体交由 type-aware 规则处理
  if (
    (callback.type === "ArrowFunctionExpression" || callback.type === "FunctionExpression") &&
    callback.body &&
    callback.body.type === "BlockStatement"
  ) {
    return callback.body;
  }
  return null;
}

// —— 规则 1：must-return-or-throw（error 级） ——
const MSG =
  "缺少 throw 或 return，可能吞错。请显式 `throw e` 上抛，或 `return 兜底值` 降级；确要忽略请 `return;`";
const mustReturnOrThrow = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require Promise.catch() callbacks and try/catch blocks to contain an explicit return or throw.",
    },
    messages: {
      catchMissingExit: `Promise.catch() 闭包${MSG}`,
      catchBlockMissingExit: `catch 块${MSG}`,
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        if (!isCatchCall(node)) return;
        const body = getCatchCallbackBody(node.arguments[0]);
        if (body && !hasReturnOrThrow(body)) {
          context.report({
            node: node.arguments[0],
            messageId: "catchMissingExit",
          });
        }
      },

      CatchClause(node) {
        if (!hasReturnOrThrow(node.body)) {
          context.report({ node, messageId: "catchBlockMissingExit" });
        }
      },
    };
  },
};

// —— 规则 2：no-bare-return（warn 级，刻意忽略错误提示） ——

const noBareReturn = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Warn on bare `return;` in catch blocks which silently swallows the error.",
    },
    messages: {
      bareReturn:
        "catch 块里用裸 `return;`（返回 undefined）刻意忽略了错误。建议在return前`console.debug('prefix', err)`留下诊断日志；若确要忽略，请在它上一行加`// oxlint-disable-next-line catch/no-bare-return`注释说明原因。",
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        if (!isCatchCall(node)) return;
        const callback = node.arguments[0];
        const body = getCatchCallbackBody(callback);
        const bare = body && findBareReturn(body);
        if (bare && !hasConsoleCall(body)) {
          // 精确指向那行 `return;`，便于在其上一行放置 oxlint-disable 注释
          context.report({ node: bare, messageId: "bareReturn" });
        }
      },

      CatchClause(node) {
        const bare = findBareReturn(node.body);
        if (bare && !hasConsoleCall(node.body)) {
          context.report({ node: bare, messageId: "bareReturn" });
        }
      },
    };
  },
};

const plugin = {
  meta: {
    name: "catch",
  },
  rules: {
    "must-return-or-throw": mustReturnOrThrow,
    "no-bare-return": noBareReturn,
  },
};

export default plugin;
