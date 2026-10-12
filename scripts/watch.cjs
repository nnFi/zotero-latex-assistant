const { spawn } = require("node:child_process");

const compiler = require.resolve("typescript/bin/tsc");
const watchers = ["tsconfig.json", "tsconfig.webview.json"].map((config) =>
  spawn(process.execPath, [compiler, "--watch", "--preserveWatchOutput", "--project", config], { stdio: "inherit" }));
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const watcher of watchers) watcher.kill();
}
for (const watcher of watchers) {
  watcher.on("error", (error) => { console.error(error); stop(1); });
  watcher.on("exit", (code) => stop(code ?? 1));
}
process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));
