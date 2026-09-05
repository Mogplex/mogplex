// The short-lived launcher waits for the child's listening event over IPC.
// Only the bridge survives command completion; logs stay in the sandbox.
export const TERMINAL_BRIDGE_BOOTSTRAP = String.raw`
const { spawn } = require("node:child_process");
const { openSync, closeSync } = require("node:fs");
const [scriptPath, logPath] = process.argv.slice(1);
const log = openSync(logPath, "w");
const child = spawn(process.execPath, [scriptPath], {
  detached: true,
  stdio: ["ignore", log, log, "ipc"],
});
closeSync(log);
let finished = false;
const deadline = setTimeout(() => finish(false), 10000);
function finish(ready) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  if (!ready) child.kill();
  if (child.connected) child.disconnect();
  child.unref();
  process.exitCode = ready ? 0 : 1;
  console.log(ready ? "MOGPLEX_TERMINAL_BRIDGE_READY" : "Terminal bridge startup failed");
}
child.on("error", () => finish(false));
child.on("exit", () => finish(false));
child.on("message", (message) => {
  if (message?.type === "listening") finish(true);
});
`;
