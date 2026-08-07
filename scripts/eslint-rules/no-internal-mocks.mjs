// Enforces the "mock only at boundaries" rule from TESTING.md. The allowlist
// of legitimate boundaries lives in tests/support/mockable-boundaries.mjs.
//
// Covers both test runners in this repo:
//   vitest      — vi.mock / vi.doMock / vi.importMock / vi.spyOn / vi.stubGlobal
//   node:test   — mock.module / t.mock.module / mock.method
import {
  boundaryModules,
  stubbableGlobals,
} from "../../tests/support/mockable-boundaries.mjs";

const VI_MODULE_MOCKERS = new Set(["mock", "doMock", "importMock"]);

const isVi = (node) => node.type === "Identifier" && node.name === "vi";

// Matches the `mock` namespace in `mock.module(...)`, `t.mock.module(...)`,
// and `ctx.mock.method(...)`.
const isMockNamespace = (node) => {
  if (node.type === "Identifier") return node.name === "mock";
  return (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.property.type === "Identifier" &&
    node.property.name === "mock"
  );
};

const isInternalSpecifier = (specifier) =>
  specifier.startsWith(".") || specifier.startsWith("@/");

const isAllowlistedModule = (specifier) =>
  boundaryModules.some((entry) =>
    entry.endsWith("/") ? specifier.startsWith(entry) : specifier === entry
  );

const resolveImportSource = (context, identifier) => {
  let scope = context.sourceCode.getScope(identifier);
  while (scope) {
    const variable = scope.variables.find(
      (candidate) => candidate.name === identifier.name
    );
    if (variable) {
      const def = variable.defs[0];
      if (def?.type === "ImportBinding") return def.parent.source.value;
      return null;
    }
    scope = scope.upper;
  }
  return null;
};

// Classifies a member-expression call as one of the mocking APIs this rule
// governs, or null for anything else.
const classifyMockCall = (callee) => {
  const method = callee.property.name;
  const target = callee.object;
  if (isVi(target)) {
    if (VI_MODULE_MOCKERS.has(method)) return "module";
    if (method === "spyOn") return "spy";
    if (method === "stubGlobal") return "global";
    return null;
  }
  if (!isMockNamespace(target)) return null;
  if (method === "module") return "module";
  if (method === "method") return "spy";
  return null;
};

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Allow mocking only at the boundaries declared in tests/support/mockable-boundaries.mjs (see TESTING.md).",
    },
    schema: [],
    messages: {
      internalModule:
        'Mocking internal module "{{specifier}}" replaces the code under test. Test it for real, or move the test to the tier where that is possible (see TESTING.md).',
      unlistedModule:
        '"{{specifier}}" is not a declared mockable boundary. If it truly crosses a process or network boundary, add it to tests/support/mockable-boundaries.mjs (owner-reviewed).',
      dynamicTarget:
        "Mock targets must be string literals so the boundary rule can verify them.",
      importedSpy:
        'Spying on "{{name}}" (imported from "{{specifier}}") mocks internal behavior. Inject the dependency or test the real path (see TESTING.md).',
      unlistedGlobal:
        'Global "{{name}}" is not stubbable. Declared stubbable globals live in tests/support/mockable-boundaries.mjs.',
    },
  },
  create(context) {
    const checkModuleMock = (node, arg) => {
      if (!arg || arg.type !== "Literal" || typeof arg.value !== "string") {
        context.report({ node, messageId: "dynamicTarget" });
        return;
      }
      if (isInternalSpecifier(arg.value)) {
        context.report({
          node,
          messageId: "internalModule",
          data: { specifier: arg.value },
        });
        return;
      }
      if (!isAllowlistedModule(arg.value)) {
        context.report({
          node,
          messageId: "unlistedModule",
          data: { specifier: arg.value },
        });
      }
    };

    const checkSpyTarget = (node, arg) => {
      if (!arg || arg.type !== "Identifier") return;
      const source = resolveImportSource(context, arg);
      if (source === null) return;
      if (isInternalSpecifier(source) || !isAllowlistedModule(source)) {
        context.report({
          node,
          messageId: "importedSpy",
          data: { name: arg.name, specifier: source },
        });
      }
    };

    const checkStubGlobal = (node, arg) => {
      if (!arg || arg.type !== "Literal" || typeof arg.value !== "string") {
        context.report({ node, messageId: "dynamicTarget" });
        return;
      }
      if (!stubbableGlobals.includes(arg.value)) {
        context.report({
          node,
          messageId: "unlistedGlobal",
          data: { name: arg.value },
        });
      }
    };

    const handleCall = (node) => {
      const { callee } = node;
      if (
        callee.type !== "MemberExpression" ||
        callee.computed ||
        callee.property.type !== "Identifier"
      ) {
        return;
      }
      const kind = classifyMockCall(callee);
      const firstArg = node.arguments[0];
      if (kind === "module") checkModuleMock(node, firstArg);
      if (kind === "spy") checkSpyTarget(node, firstArg);
      if (kind === "global") checkStubGlobal(node, firstArg);
    };

    return { CallExpression: handleCall };
  },
};

export default rule;
