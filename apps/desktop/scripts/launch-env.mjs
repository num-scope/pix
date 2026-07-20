/**
 * Shared launch environment for interactive / isolated desktop runs.
 * Used by launch-m0.mjs and dev.mjs.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeOpenAiServer } from "../../../packages/test-utils/src/index.ts";

/**
 * @param {{ isolated?: boolean, smoke?: boolean }} options
 * @returns {Promise<{ environment: NodeJS.ProcessEnv, cleanup: () => Promise<void>, label: string }>}
 */
export async function prepareLaunchEnv(options = {}) {
  const isolated = Boolean(options.isolated);
  const smoke = Boolean(options.smoke);

  if (!isolated && !smoke) {
    // Product = visual pi: real HOME, real ~/.pi/agent (models/auth/settings/tools).
    const environment = {
      ...process.env,
      // CLI-compatible durable sessions unless the user disables.
      PIX_M0_PERSIST_SESSION: process.env.PIX_M0_PERSIST_SESSION ?? "1",
    };
    delete environment.ELECTRON_RUN_AS_NODE;
    // Never inherit probe fixtures into product mode.
    delete environment.PIX_M0_WORKSPACE;
    delete environment.PIX_M0_AUTO_START;
    delete environment.PIX_M0_AUTO_PROMPT;
    delete environment.PIX_M0_AUTO_ABORT;
    delete environment.PIX_M0_AUTO_R04;
    delete environment.PIX_M0_AUTO_CLOSE_MS;
    delete environment.PIX_M0_TOOLS;
    if (!process.env.PIX_M0_MODEL_PROVIDER) {
      delete environment.PIX_M0_MODEL_PROVIDER;
      delete environment.PIX_M0_MODEL_ID;
    }
    // Use the same agent dir as the `pi` CLI unless the user overrode it.
    if (!process.env.PI_CODING_AGENT_DIR) {
      delete environment.PI_CODING_AGENT_DIR;
    }
    return {
      environment,
      label: "Pix product launch (visual pi — real HOME + ~/.pi/agent)",
      cleanup: async () => {},
    };
  }

  const root = await mkdtemp(join(tmpdir(), "pix-m0-"));
  const home = join(root, "home");
  const agentDir = join(home, ".pi", "agent");
  const workspace = join(root, "workspace");

  await Promise.all([
    mkdir(agentDir, { recursive: true }),
    mkdir(join(home, ".agents"), { recursive: true }),
    mkdir(workspace, { recursive: true }),
  ]);
  const toolPath = join(workspace, "fixture.txt");
  await writeFile(toolPath, "Pix Electron R01 fixture\n");

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
    PIX_M0_PERSIST_SESSION: "1",
    PIX_M0_ENABLE_TEST_COMMANDS: "1",
    ...(smoke
      ? {
          PIX_M0_AUTO_START: "1",
          PIX_M0_AUTO_PROMPT: "Use the read tool for the fixture file.",
          PIX_M0_AUTO_ABORT: "1",
          PIX_M0_AUTO_R04: "1",
          PIX_M0_AUTO_CLOSE_MS: "2500",
        }
      : {}),
  };
  delete environment.ELECTRON_RUN_AS_NODE;

  return {
    environment,
    label: `Pix M0 isolated home: ${root}`,
    cleanup: async () => {
      await fakeModel.stop();
      if (process.env.PIX_M0_KEEP_HOME === "1") console.log(`Kept Pix M0 home: ${root}`);
      else await rm(root, { recursive: true, force: true });
    },
  };
}
