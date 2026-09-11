/**
 * @typescript-eslint Type-aware 规则：no-void-catch-return
 *
 * 阻止 Promise.catch() 回调返回 void/undefined（从而静默吞掉错误）。
 *
 * 典型场景（表达式体/箭头简写）：
 *   .catch((e) => console.log(e))   // console.log 返回 void
 *   .catch((e) => undefined)        // 显式返回 undefined
 *
 * 说明：
 *  - 本规则需要类型信息，因此必须搭配 `parserOptions.project` /
 *    `projectService` 运行（type-aware），由 ESLint + @typescript-eslint 执行。
 *  - 需要显式 return/throw 的“控制流”问题（catch 块/块体闭包），由 oxlint
 *    的 `catch-must-return-or-throw` 负责；这里是互补的“返回值类型”检查。
 *
 * 依赖：
 *  - eslint
 *  - @typescript-eslint/utils
 *  - typescript
 */
import { ESLintUtils } from "@typescript-eslint/utils";
import ts from "typescript";

const createRule = ESLintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);

const rule = createRule({
  name: "no-void-catch-return",
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Promise.catch() callbacks whose return value is void/undefined, which would silently swallow errors.",
      recommended: "strict",
    },
    messages: {
      returnsVoid:
        "Promise.catch() 的回调返回值不能为 void/undefined，否则会静默吞掉错误。建议转为 console.debug('prefix', err); return;",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const parserServices = context.sourceCode.parserServices;

    // 非 type-aware 环境下就直接关掉（无类型信息时无法判断）
    if (!parserServices || !parserServices.program || !parserServices.esTreeNodeToTSNodeMap) {
      return {};
    }

    const checker = parserServices.program.getTypeChecker();

    function isVoidOrUndefined(type) {
      if (!type) return false;
      // 联合类型里混有其它类型时，不轻易判定（如 T | void）
      if (type.flags & ts.TypeFlags.Union) return false;
      if (type.flags & ts.TypeFlags.Void) return true;
      if (type.flags & ts.TypeFlags.Undefined) return true;
      return false;
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== "MemberExpression" || callee.computed) {
          return;
        }
        const prop = callee.property;
        if (!prop || prop.type !== "Identifier" || prop.name !== "catch") {
          return;
        }
        const callback = node.arguments[0];
        if (!callback) return;

        // 仅处理 `=> value`（表达式体）形式；块体/普通函数由
        // oxlint 的 catch-must-return-or-throw 负责控制流检查。
        if (callback.type !== "ArrowFunctionExpression") return;
        if (callback.body.type === "BlockStatement") return;

        const valueNode = callback.body; // 表达式体
        const tsValueNode = parserServices.esTreeNodeToTSNodeMap.get(valueNode);
        if (!tsValueNode) return;

        const valueType = checker.getTypeAtLocation(tsValueNode);
        if (isVoidOrUndefined(valueType)) {
          context.report({ node: callback, messageId: "returnsVoid" });
        }
      },
    };
  },
});

export default rule;
