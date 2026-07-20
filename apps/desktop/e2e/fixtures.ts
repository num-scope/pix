import { test as base, expect, type Page } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeOpenAiServer } from "@pix/test-utils";

const require = createRequire(import.meta.url);
const electronBinary = require("electron") as string;
const appDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");

interface LaunchedPix {
  app: ElectronApplication;
  page: Page;
  root: string;
  fakeModel: FakeOpenAiServer;
}

export interface PixE2EFixtures {
  pix: LaunchedPix;
  page: Page;
}

async function launchPixApp(): Promise<LaunchedPix> {
  const root = await mkdtemp(join(tmpdir(), "pix-e2e-"));
  const home = join(root, "home");
  const agentDir = join(home, ".pi", "agent");
  const workspace = join(root, "workspace");
  const toolPath = join(workspace, "fixture.txt");

  await Promise.all([
    mkdir(agentDir, { recursive: true }),
    mkdir(join(home, ".agents"), { recursive: true }),
    mkdir(workspace, { recursive: true }),
  ]);
  await writeFile(toolPath, "Pix Playwright E2E fixture\n");

  // Local package fixture for install E2E (absolute path source).
  const localPackage = join(workspace, "e2e-local-package");
  await mkdir(join(localPackage, "prompts"), { recursive: true });
  await Promise.all([
    writeFile(
      join(localPackage, "package.json"),
      JSON.stringify({
        name: "pix-e2e-local-package",
        version: "1.0.0",
        keywords: ["pi-package"],
        pi: { prompts: ["prompts/*.md"] },
      }),
    ),
    writeFile(join(localPackage, "prompts", "e2e.md"), "E2E local package prompt.\n"),
  ]);

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

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    PI_CODING_AGENT_DIR: agentDir,
    PIX_M0_WORKSPACE: workspace,
    PIX_M0_MODEL_PROVIDER: "pix-m0",
    PIX_M0_MODEL_ID: "pix-m0",
    PIX_M0_TOOLS: "read",
    PIX_M0_ENABLE_TEST_COMMANDS: "1",
    PIX_M0_PERSIST_SESSION: "1",
    // Product cold-start auto-resume is off so each test drives Host start via UI.
    PIX_M0_NO_AUTO_RESUME: "1",
  });
  // Interactive E2E: do not auto-drive Main; the test clicks the UI.
  for (const key of [
    "ELECTRON_RUN_AS_NODE",
    "PIX_M0_AUTO_START",
    "PIX_M0_AUTO_PROMPT",
    "PIX_M0_AUTO_ABORT",
    "PIX_M0_AUTO_R04",
    "PIX_M0_AUTO_CLOSE_MS",
  ]) {
    delete env[key];
  }

  // Isolate Electron userData so recent workspaces / prefs do not leak across runs.
  const userData = join(root, "electron-userData");
  await mkdir(userData, { recursive: true });

  const app = await electron.launch({
    executablePath: electronBinary,
    args: [appDirectory, `--user-data-dir=${userData}`],
    cwd: appDirectory,
    env,
    timeout: 60_000,
  });

  const page = await app.firstWindow({ timeout: 60_000 });
  await page.waitForSelector('[data-testid="pix-m0-app"]', { timeout: 30_000 });

  return { app, page, root, fakeModel };
}

export const test = base.extend<PixE2EFixtures>({
  // eslint-disable-next-line no-empty-pattern
  pix: async ({}, use) => {
    const launched = await launchPixApp();
    try {
      await use(launched);
    } finally {
      await launched.app.close().catch(() => undefined);
      await launched.fakeModel.stop().catch(() => undefined);
      await rm(launched.root, { recursive: true, force: true }).catch(() => undefined);
    }
  },
  page: async ({ pix }, use) => {
    await use(pix.page);
  },
});

export { expect };

/** Start host via New thread and wait until the shell reports ready. */
export async function startHost(page: Page): Promise<void> {
  await page.getByTestId("start-host").click();
  await expect(page.getByTestId("host-status")).toContainText(
    /Agent Host ready|Agent Host restarted/,
    {
      timeout: 30_000,
    },
  );
  await expect(page.getByTestId("runtime-snapshot")).toContainText("runtimeId", {
    timeout: 10_000,
  });
}
