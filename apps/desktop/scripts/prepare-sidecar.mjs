/** Stage a real Node executable plus normal on-disk modules (PTY/WASM/dynamic pi extensions). */
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { requireNode24 } from "./shared-node.mjs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const release = process.argv.includes("--release");
const target =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/^host: (.+)$/m)?.[1];
if (!target) throw new Error("Unable to determine Rust target");
const host = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/^host: (.+)$/m)?.[1];
if (target !== host)
  throw new Error(
    "Build on the target OS/architecture so Node and native addons match the Tauri target",
  );
requireNode24();
const binaries = join(root, "src-tauri/binaries");
mkdirSync(binaries, { recursive: true });
const ext = process.platform === "win32" ? ".exe" : "";
for (const name of [`node-${target}${ext}`, `node${ext}`]) {
  const output = join(binaries, name);
  const temporary = `${output}.${process.pid}.tmp`;
  copyFileSync(process.execPath, temporary);
  if (!ext) chmodSync(temporary, 0o755);
  renameSync(temporary, output);
}
const staged = join(root, "src-tauri/resources/sidecar");
mkdirSync(staged, { recursive: true });
if (release) {
  if (!existsSync(join(root, "dist/sidecar/sidecar.mjs")))
    throw new Error("Run pnpm build:desktop before staging a release");
  rmSync(staged, { recursive: true, force: true });
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  // This dependency-only package has no workspace links. Use pnpm's locked deploy
  // path; legacy deploy rewrites the source workspace's dependency state as prod-only.
  execFileSync(
    pnpm,
    [
      "--filter",
      "@pix/sidecar-node",
      "deploy",
      "--prod",
      "--config.inject-workspace-packages=true",
      "--config.node-linker=hoisted",
      "--config.prefer-symlinked-executables=false",
      staged,
    ],
    { cwd: root, stdio: "inherit", shell: process.platform === "win32" },
  );
  // Tauri's resource walker skips symlinks. Ship real package directories and
  // executable shims, and reject layouts that would silently lose dependencies.
  function verifyRealFiles(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Sidecar resource must not be a symlink: ${path}`);
      // node-pty prebuilds can arrive without +x. Fix before bundling/signing,
      // so first terminal launch never needs to modify the installed app.
      if (process.platform !== "win32" && entry.isFile() && entry.name === "spawn-helper")
        chmodSync(path, 0o755);
      if (entry.isDirectory()) verifyRealFiles(path);
    }
  }
  verifyRealFiles(join(staged, "node_modules"));
  cpSync(join(root, "dist/sidecar"), join(staged, "dist/sidecar"), { recursive: true });
  cpSync(join(root, "dist/agent-host"), join(staged, "dist/agent-host"), { recursive: true });
  const stagedPackage = JSON.parse(readFileSync(join(staged, "package.json"), "utf8"));
  stagedPackage.version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  writeFileSync(join(staged, "package.json"), `${JSON.stringify(stagedPackage, null, 2)}\n`);
  // Managed Python/npm tool runtimes retain the original first-launch provisioner.
  execFileSync(process.execPath, [join(root, "scripts/fetch-runtimes.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  const resources = join(root, "src-tauri/resources");
  rmSync(join(resources, "runtimes"), { recursive: true, force: true });
  cpSync(join(root, "runtimes/current/archives"), join(resources, "runtimes/archives"), {
    recursive: true,
    dereference: true,
  });
  copyFileSync(
    join(root, "runtimes/current/manifest.json"),
    join(resources, "runtimes/manifest.json"),
  );
  // Do not let packaging silently ship symlinks that point back into a developer checkout.
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "await import('@earendil-works/pi-coding-agent'); await import('node-pty'); await import('@silvia-odwyer/photon-node'); console.log('Sidecar dependencies verified')",
    ],
    { cwd: staged, stdio: "inherit" },
  );
} else {
  mkdirSync(join(root, "src-tauri/resources/runtimes"), { recursive: true });
  writeFileSync(
    join(root, "src-tauri/resources/runtimes/.dev-placeholder"),
    "Development uses host tool runtimes.\n",
  );
  writeFileSync(join(staged, ".dev-placeholder"), "Development uses the workspace sidecar.\n");
}
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
console.log(`Prepared Pix ${pkg.version} Node ${process.versions.node} sidecar for ${target}`);
