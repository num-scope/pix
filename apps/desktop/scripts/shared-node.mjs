/** Ship npm scripts only; the Tauri sidecar supplies the single Node executable. */
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export function requireNode24(version = process.versions.node) {
  if (version.split(".")[0] !== "24")
    throw new Error(`Packaging Pix requires Node.js 24 (running ${version})`);
  return version;
}

export function resolveBuildNpmRoot(nodeExecutable = process.execPath) {
  const bin = dirname(nodeExecutable);
  const candidates = [join(bin, "node_modules/npm"), join(bin, "../lib/node_modules/npm")];
  const root = candidates.find((path) => existsSync(join(path, "bin/npm-cli.js")));
  if (!root)
    throw new Error(
      "Install the official Node.js 24 distribution including npm before packaging Pix",
    );
  return root;
}

export function stageSharedNpm(destination, npmRoot = resolveBuildNpmRoot()) {
  rmSync(destination, { recursive: true, force: true });
  const installedNpm = join(destination, "node_modules/npm");
  mkdirSync(dirname(installedNpm), { recursive: true });
  cpSync(npmRoot, installedNpm, { recursive: true, dereference: true });
  // Launchers resolve npm relative to themselves, Node through the managed PATH.
  // npm's stock Unix launcher assumes npm lives beside process.execPath.
  for (const command of ["npm", "npx"]) {
    const cli = `node_modules/npm/bin/${command}-cli.js`;
    writeFileSync(
      join(destination, command),
      `#!/bin/sh\nexec "\${NODE_BINARY:-node}" "$(dirname "$0")/${cli}" "$@"\n`,
    );
    chmodSync(join(destination, command), 0o755);
    writeFileSync(
      join(destination, `${command}.cmd`),
      [
        "@ECHO OFF",
        "SETLOCAL",
        'SET "PIX_NODE=node"',
        'IF DEFINED NODE_BINARY SET "PIX_NODE=%NODE_BINARY%"',
        `"%PIX_NODE%" "%~dp0${cli.replaceAll("/", "\\")}" %*`,
        "EXIT /B %ERRORLEVEL%",
        "",
      ].join("\r\n"),
    );
    writeFileSync(
      join(destination, `${command}.ps1`),
      [
        '$nodeBinary = if ($env:NODE_BINARY) { $env:NODE_BINARY } else { "node" }',
        `& $nodeBinary "$PSScriptRoot/${cli}" @args`,
        "exit $LASTEXITCODE",
        "",
      ].join("\r\n"),
    );
  }
  return JSON.parse(readFileSync(join(installedNpm, "package.json"), "utf8")).version;
}
