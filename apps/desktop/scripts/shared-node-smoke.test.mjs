/** Real runtime compatibility checks against the staged/installed production dependencies. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ensureProvisionedRuntimes } from "../src/main/runtime-provision.ts";
import {
  applyManagedRuntimeToProcessEnv,
  configureBundledRuntimes,
} from "../src/main/bundled-runtimes.ts";

const desktop = resolve(import.meta.dirname, "..");
const executable =
  process.env.PIX_SMOKE_NODE ||
  join(desktop, "src-tauri/binaries", process.platform === "win32" ? "node.exe" : "node");
// The Node test runner owns the worker lifetime. Some Windows native addons
// retain handles after their API checks finish, so run them in an isolated worker.
if (process.env.PIX_SHARED_NODE_TEST_CHILD !== "1") {
  const result = spawnSync(
    executable,
    ["--test", "--test-force-exit", fileURLToPath(import.meta.url)],
    {
      stdio: "inherit",
      env: { ...process.env, PIX_SMOKE_NODE: executable, PIX_SHARED_NODE_TEST_CHILD: "1" },
      timeout: 180_000,
    },
  );
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

await test(
  "shared Node 24: npm/npx, install scripts, real terminal PTY, native clipboard and image WASM",
  { timeout: 120_000 },
  async () => {
    assert.match(process.version, /^v24\./);
    const root = process.env.PIX_SMOKE_ROOT || join(desktop, "src-tauri/resources/sidecar");
    const resources = process.env.PIX_RESOURCES_DIR || join(desktop, "src-tauri/resources");
    const require = createRequire(join(root, "package.json"));
    const temporary = mkdtempSync(join(tmpdir(), "Pix shared node 空格 "));
    try {
      const manifest = JSON.parse(readFileSync(join(resources, "runtimes/manifest.json"), "utf8"));
      assert.equal(manifest.nodeRuntime, "shared");
      assert.equal(manifest.node, process.versions.node);
      assert.ok(!existsSync(join(resources, "runtimes/archives/node.tar.gz")));
      const layout = ensureProvisionedRuntimes({
        userDataPath: temporary,
        resourcesPath: resources,
        skipVenv: true,
      });
      assert.ok(layout);
      for (const name of ["node", "node.exe", "bin/node", "bin/node.exe"])
        assert.ok(!existsSync(join(layout.roots.nodeRoot, name)), `No second executable: ${name}`);
      const systemPath =
        process.platform === "win32" ? join(process.env.SystemRoot, "System32") : "/usr/bin:/bin";
      const env = {
        ...process.env,
        HOME: temporary,
        USERPROFILE: temporary,
        PATH: systemPath,
        npm_config_cache: join(temporary, "npm-cache"),
        npm_config_userconfig: join(temporary, ".npmrc"),
        npm_config_globalconfig: join(temporary, "global.npmrc"),
      };
      if (process.platform === "win32") env.Path = systemPath;
      delete env.NODE_OPTIONS;
      delete env.NODE_PATH;
      configureBundledRuntimes({
        roots: layout.roots,
        prefs: { useBundledNode: true, useBundledPython: false },
        isolation: layout,
      });
      applyManagedRuntimeToProcessEnv(env);
      assert.equal(realpathSync(env.NODE_BINARY), realpathSync(process.execPath));
      const shell = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "/bin/sh";
      const shellArgs = (command) =>
        process.platform === "win32" ? ["/d", "/s", "/c", `"${command}"`] : ["-c", command];
      const run = (command) =>
        execFileSync(shell, shellArgs(command), {
          cwd: temporary,
          env,
          encoding: "utf8",
          timeout: 60_000,
          windowsVerbatimArguments: process.platform === "win32",
        }).trim();
      assert.equal(run("node --version"), process.version);
      assert.equal(run("npm --version"), manifest.npm);
      assert.equal(run("npx --version"), manifest.npm);
      if (process.platform === "win32") {
        const powershell = join(
          process.env.SystemRoot,
          "System32/WindowsPowerShell/v1.0/powershell.exe",
        );
        for (const command of ["npm", "npx"]) {
          const version = execFileSync(
            powershell,
            ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `${command} --version`],
            { cwd: temporary, env, encoding: "utf8", timeout: 30_000 },
          ).trim();
          assert.equal(version, manifest.npm, `${command}.ps1 uses the shared Node`);
        }
      }
      const fixture = join(temporary, "fixture");
      mkdirSync(fixture);
      writeFileSync(
        join(fixture, "package.json"),
        JSON.stringify({
          name: "pix-shared-node-probe",
          version: "1.0.0",
          bin: { "pix-node-probe": "probe.cjs" },
          scripts: { postinstall: "node install.cjs" },
        }),
      );
      writeFileSync(
        join(fixture, "probe.cjs"),
        "#!/usr/bin/env node\nconsole.log(JSON.stringify({node:process.execPath,version:process.version,args:process.argv.slice(2)}));\n",
        { mode: 0o755 },
      );
      writeFileSync(
        join(fixture, "install.cjs"),
        'require("node:fs").writeFileSync(require("node:path").join(process.env.NPM_CONFIG_PREFIX,"install-proof.json"),JSON.stringify({node:process.execPath,version:process.version}));',
      );
      run("npm install --global --install-links --offline --no-audit --no-fund ./fixture");
      const installed = JSON.parse(
        readFileSync(join(layout.npmPrefix, "install-proof.json"), "utf8"),
      );
      assert.equal(realpathSync(installed.node), realpathSync(process.execPath));
      assert.deepEqual(JSON.parse(run('pix-node-probe "two words"')).args, ["two words"]);
      const invoked = JSON.parse(run('npx --offline --no -- pix-node-probe "two words"'));
      assert.equal(realpathSync(invoked.node), realpathSync(process.execPath));
      assert.deepEqual(invoked.args, ["two words"]);
      console.log("Node, npm/npx, shell quoting and install scripts passed");
      const clipboard = require("@mariozechner/clipboard");
      assert.equal(typeof clipboard.getText, "function"); // Load the real N-API addon without modifying the clipboard.
      console.log("Clipboard N-API addon loaded");
      const { PhotonImage, resize, SamplingFilter } = require("@silvia-odwyer/photon-node");
      const source = new PhotonImage(new Uint8Array([255, 0, 0, 255]), 1, 1);
      const resized = resize(source, 2, 2, SamplingFilter.Nearest);
      assert.equal(resized.get_width(), 2);
      assert.ok(resized.get_bytes().length > 0);
      resized.free();
      source.free();
      console.log("Photon WASM image resize passed");
      const pty = require("node-pty");
      const terminalCommand = 'node --version && npm --version && pix-node-probe "terminal words"';
      const terminal = pty.spawn(
        shell,
        process.platform === "win32" ? `/d /s /c "${terminalCommand}"` : shellArgs(terminalCommand),
        { cwd: temporary, env, cols: 120, rows: 30 },
      );
      let output = "";
      terminal.onData((chunk) => {
        output += chunk;
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          terminal.kill();
          reject(new Error(`PTY timeout: ${output}`));
        }, 30_000);
        terminal.onExit(({ exitCode }) => {
          clearTimeout(timer);
          if (exitCode === 0) resolve();
          else reject(new Error(`PTY exit ${exitCode}: ${output}`));
        });
      });
      assert.ok(output.includes(process.version), output);
      assert.ok(output.includes(manifest.npm), output);
      assert.ok(output.includes("terminal words"), output);
      console.log(
        `Verified ${process.version}, npm ${manifest.npm}, terminal PTY, clipboard N-API and Photon WASM`,
      );
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  },
);
