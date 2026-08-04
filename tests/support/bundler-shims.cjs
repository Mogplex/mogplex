// Shims for modules that only work under the Next.js build pipeline, so
// node:test can import page/component modules directly.
const Module = require("node:module");

// Stylesheet imports are a bundler concern.
require.extensions[".css"] = () => {
  // Intentionally empty: a global stylesheet has no module exports.
};

// next/font/* factories run at module scope but require the SWC transform;
// return inert font objects instead.
const fontFactory = () => ({
  className: "",
  variable: "",
  style: { fontFamily: "" },
});
const fontStub = new Proxy(
  {},
  {
    get: (_target, prop) =>
      typeof prop === "string" ? fontFactory : undefined,
  }
);

const originalLoad = Module._load;
Module._load = function _load(request, ...rest) {
  if (request === "next/font/google" || request === "next/font/local") {
    return fontStub;
  }
  return originalLoad.call(this, request, ...rest);
};
