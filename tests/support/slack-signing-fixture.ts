import crypto from "node:crypto";

export function getSlackSigningFixture() {
  return crypto
    .createHash("sha256")
    .update(["mogplex", "playwright", "slack", "fixture"].join(":"))
    .digest("hex");
}
