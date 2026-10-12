const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawn } = require("node:child_process");

const root = mkdtempSync(join(tmpdir(), "zotero-live-smoke-"));
const workspace = join(root, "workspace");
mkdirSync(workspace);
mkdirSync(join(root, "profile", "User"), { recursive: true });
writeFileSync(join(root, "profile", "User", "settings.json"), JSON.stringify({ "telemetry.telemetryLevel": "off" }));
const repository = resolve(__dirname, "..");
console.log(`Isolated live-test directory: ${root}`);
// Trust bypass is confined to this fresh profile and generated test-only workspace.
const child = spawn("code", [workspace, "--new-window", "--disable-extensions", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes",
  `--user-data-dir=${join(root, "profile")}`, `--extensions-dir=${join(root, "extensions")}`,
  `--extensionDevelopmentPath=${repository}`, `--extensionTestsPath=${join(repository, "dist", "test", "live", "run.js")}`],
  { stdio: "inherit", env: { ...process.env, ZOTERO_LIVE_SMOKE_ROOT: root } });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", async (code) => {
  // The desktop CLI can exit before its extension host has finished the tests.
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const report = JSON.parse(readFileSync(join(root, "report.json"), "utf8"));
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.success && code === 0 ? 0 : 1;
      return;
    } catch {
      if (code !== 0) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  console.error(`VS Code did not produce a live-test report. Inspect ${join(root, "profile", "logs")}.`);
  process.exitCode = 1;
});
