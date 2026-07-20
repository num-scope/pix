import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeOpenAiServer } from "../../../packages/test-utils/src/index.ts";

if (process.platform !== "darwin") throw new Error("The current packaged M0 smoke targets macOS");

const appDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const executable = join(appDirectory, "release/m0/mac-arm64/Pix M0.app/Contents/MacOS/Pix M0");
const root = await mkdtemp(join(tmpdir(), "pix-packaged-r01-"));
const home = join(root, "home");
const agentDir = join(home, ".pi", "agent");
const workspace = join(root, "workspace");
const toolPath = join(workspace, "fixture.txt");

await Promise.all([
  mkdir(agentDir, { recursive: true }),
  mkdir(join(home, ".agents"), { recursive: true }),
  mkdir(workspace, { recursive: true }),
]);
await writeFile(toolPath, "Pix packaged R01 fixture\n");

const fakeModel = new FakeOpenAiServer({ toolPath });
await fakeModel.start();
await writeFile(
  join(agentDir, "models.json"),
  JSON.stringify({
    providers: {
      "pix-m0": {
        baseUrl: fakeModel.baseUrl,
        apiKey: "test-key-not-secret",
        api: "openai-completions",
        models: [
          {
            id: "pix-m0",
            name: "Pix M0 Fake Model",
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
  PIX_M0_WORKSPACE: workspace,
  PIX_M0_MODEL_PROVIDER: "pix-m0",
  PIX_M0_MODEL_ID: "pix-m0",
  PIX_M0_TOOLS: "read",
  PIX_M0_AUTO_START: "1",
  PIX_M0_AUTO_PROMPT: "Use the read tool for the fixture file.",
  PIX_M0_AUTO_ABORT: "1",
  PIX_M0_AUTO_R04: "1",
  PIX_M0_ENABLE_TEST_COMMANDS: "1",
  PIX_M0_PERSIST_SESSION: "1",
  PIX_M0_AUTO_CLOSE_MS: "1000",
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

  const r01Line = stdout.split("\n").find((line) => line.includes('"type":"pix.m0.r01"'));
  if (!r01Line) throw new Error(`Packaged R01 report was not emitted:\n${stdout}\n${stderr}`);
  const r01 = JSON.parse(r01Line);
  for (const event of [
    "agent.started",
    "message.delta",
    "tool.started",
    "tool.completed",
    "agent.settled",
    "message.failed",
  ]) {
    if (!r01.eventCounts?.[event]) throw new Error(`Packaged R01 did not emit ${event}`);
  }

  const r04Line = stdout.split("\n").find((line) => line.includes('"type":"pix.m0.r04"'));
  if (!r04Line) throw new Error(`Packaged R04 report was not emitted:\n${stdout}\n${stderr}`);
  const r04 = JSON.parse(r04Line);
  for (const key of [
    "runtimeIdsUnique",
    "sessionIdsStable",
    "sessionFileStable",
    "messagePendingRejected",
    "toolPendingRejected",
    "gapRecovered",
    "windowAlive",
  ]) {
    if (r04[key] !== true) throw new Error(`Packaged R04 failed ${key}`);
  }
  if (
    r04.eventCounts?.["host.crashed"] !== 3 ||
    r04.eventCounts?.["host.restarted"] !== 3 ||
    r04.eventCounts?.["runtime.gap"] !== 1
  ) {
    throw new Error("Packaged R04 did not complete three crash/restart cycles");
  }
  const sessionLines = (await readFile(r04.sessionFile, "utf8")).trim().split("\n");
  if (sessionLines.length < 2) throw new Error("Packaged R04 session did not flush JSONL entries");
  for (const line of sessionLines) JSON.parse(line);

  console.log(r01Line);
  console.log(r04Line);
} finally {
  await fakeModel.stop();
  await rm(root, { recursive: true, force: true });
}
