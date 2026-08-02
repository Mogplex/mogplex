// @better-auth/infra declares zod >=4.1.12 as a peer, but pnpm resolves peers
// from the importer's ancestry, so it always lands on the app's zod v3 and
// crashes at import (z.url is not a function). Give infra its own zod v4 as a
// real dependency instead. Remove once the app itself is on zod v4.
function readPackage(pkg) {
  if (pkg.name === "@better-auth/infra") {
    pkg.dependencies = { ...pkg.dependencies, zod: "^4.4.3" };
    delete pkg.peerDependencies.zod;
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
