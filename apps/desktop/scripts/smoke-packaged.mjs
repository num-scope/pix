import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeOpenAiServer } from "../../../packages/test-utils/src/index.ts";

if (process.platform !== "darwin") throw new Error("The current packaged smoke targets macOS");

const appDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const executable = join(appDirectory, "release/app/mac-arm64/Pix.app/Contents/MacOS/Pix");
const root = await mkdtemp(join(tmpdir(), "pix-packaged-smoke-"));
const home = join(root, "home");
const agentDir = join(home, ".pi", "agent");
const workspace = join(root, "workspace");
const toolPath = join(workspace, "fixture.txt");

await Promise.all([
  mkdir(agentDir, { recursive: true }),
  mkdir(join(home, ".agents"), { recursive: true }),
  mkdir(workspace, { recursive: true }),
]);
await writeFile(toolPath, "Pix packaged smoke fixture\n");

const fakeModel = new FakeOpenAiServer({ toolPath });
await fakeModel.start();
await writeFile(
  join(agentDir, "models.json"),
  JSON.stringify({
    providers: {
      "pix-fake": {
        baseUrl: fakeModel.baseUrl,
        apiKey: "test-key-not-secret",
        api: "openai-completions",
        models: [
          {
            id: "pix-fake",
            name: "Pix Fake Model",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 8192,
            maxTokens: 1024,
            compat: { supportsUsageInStreaming: true },
          },
        ],
      },
    },
  }),
);

const environment = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  PI_CODING_AGENT_DIR: agentDir,
  PIX_WORKSPACE: workspace,
  PIX_MODEL_PROVIDER: "pix-fake",
  PIX_MODEL_ID: "pix-fake",
  PIX_TOOLS: "read",
  PIX_AUTO_START: "1",
  PIX_AUTO_PROMPT: "Use the read tool for the fixture file.",
  PIX_AUTO_ABORT: "1",
  PIX_AUTO_CRASH_PROBE: "1",
  PIX_ENABLE_TEST_COMMANDS: "1",
  PIX_PERSIST_SESSION: "1",
  PIX_AUTO_CLOSE_MS: "1000",
};
delete environment.ELECTRON_RUN_AS_NODE;

try {
  const child = spawn(executable, [], { cwd: appDirectory, env: environment });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => (stdout += String(data)));
  child.stderr.on("data", (data) => (stderr += String(data)));
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Packaged Electron exited from signal ${signal}`));
      else resolve(code ?? 1);
    });
  });

  if (exitCode !== 0) throw new Error(`Packaged Electron exited with ${exitCode}: ${stderr}`);

  const runtimeLine = stdout
    .split("\n")
    .find((line) => line.includes('"type":"pix.smoke.runtime"'));
  if (!runtimeLine)
    throw new Error(`Packaged runtime smoke report was not emitted:\n${stdout}\n${stderr}`);
  const runtimeReport = JSON.parse(runtimeLine);
  for (const event of [
    "agent.started",
    "message.delta",
    "tool.started",
    "tool.completed",
    "agent.settled",
    "message.failed",
  ]) {
    if (!runtimeReport.eventCounts?.[event])
      throw new Error(`Packaged runtime smoke did not emit ${event}`);
  }

  const recoveryLine = stdout
    .split("\n")
    .find((line) => line.includes('"type":"pix.smoke.recovery"'));
  if (!recoveryLine)
    throw new Error(`Packaged recovery smoke report was not emitted:\n${stdout}\n${stderr}`);
  const recoveryReport = JSON.parse(recoveryLine);
  for (const key of [
    "runtimeIdsUnique",
    "sessionIdsStable",
    "sessionFileStable",
    "messagePendingRejected",
    "toolPendingRejected",
    "gapRecovered",
    "windowAlive",
  ]) {
    if (recoveryReport[key] !== true) throw new Error(`Packaged recovery smoke failed ${key}`);
  }
  if (
    recoveryReport.eventCounts?.["host.crashed"] !== 3 ||
    recoveryReport.eventCounts?.["host.restarted"] !== 3 ||
    recoveryReport.eventCounts?.["runtime.gap"] !== 1
  ) {
    throw new Error("Packaged recovery smoke did not complete three crash/restart cycles");
  }
  const sessionLines = (await readFile(recoveryReport.sessionFile, "utf8")).trim().split("\n");
  if (sessionLines.length < 2)
    throw new Error("Packaged recovery smoke session did not flush JSONL entries");
  for (const line of sessionLines) JSON.parse(line);

  console.log(runtimeLine);
  console.log(recoveryLine);
} finally {
  await fakeModel.stop();
  await rm(root, { recursive: true, force: true });
}
