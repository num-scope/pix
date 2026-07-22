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
  workspace: string;
  attachmentPaths: string[];
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
  const attachmentPaths = [
    "report.xlsx",
    "photo.png",
    "brief.pdf",
    "deck.pptx",
    "proposal.docx",
    "bundle.zip",
    "notes.txt",
    "README.md",
    "Main.java",
    "app.js",
    "worker.py",
  ].map((name) => join(workspace, name));

  await Promise.all([
    mkdir(agentDir, { recursive: true }),
    mkdir(join(agentDir, "prompts"), { recursive: true }),
    mkdir(join(agentDir, "skills", "e2e-skill"), { recursive: true }),
    mkdir(join(home, ".agents"), { recursive: true }),
    mkdir(workspace, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(toolPath, "Pix Playwright E2E fixture\n"),
    ...attachmentPaths.map((path) =>
      path.endsWith("photo.png")
        ? writeFile(
            path,
            Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
              "base64",
            ),
          )
        : writeFile(path, `E2E attachment fixture: ${path}\n`),
    ),
    writeFile(join(workspace, "demo.mp4"), ""),
    writeFile(
      join(agentDir, "prompts", "e2e-review.md"),
      "---\ndescription: Review the active workspace\n---\nReview the active workspace.\n",
    ),
    writeFile(
      join(agentDir, "skills", "e2e-skill", "SKILL.md"),
      "---\nname: e2e-skill\ndescription: E2E-only skill fixture\n---\n\nExercise the E2E skill.\n",
    ),
  ]);

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

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    PI_CODING_AGENT_DIR: agentDir,
    PIX_WORKSPACE: workspace,
    PIX_MODEL_PROVIDER: "pix-fake",
    PIX_MODEL_ID: "pix-fake",
    PIX_TOOLS: "read",
    PIX_ENABLE_TEST_COMMANDS: "1",
    PIX_TEST_PROVIDER_OAUTH: "openai-codex",
    PIX_TEST_PROVIDER_USAGE: JSON.stringify([
      {
        provider: "zai",
        displayName: "Z.AI",
        updatedAt: new Date().toISOString(),
        status: "ok",
        planName: "GLM Coding Max",
        limits: [
          {
            label: "Session",
            usedPercent: 26,
            resetsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
            windowDurationMins: 300,
          },
          {
            label: "Weekly",
            usedPercent: 63,
            resetsAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
            windowDurationMins: 10_080,
          },
        ],
        usageLines: [{ label: "Web searches", value: "37 / 100" }],
      },
    ]),
    PIX_PERSIST_SESSION: "1",
    // Product cold-start auto-resume is off so each test drives Host start via UI.
    PIX_NO_AUTO_RESUME: "1",
  });
  // Interactive E2E: do not auto-drive Main; the test clicks the UI.
  for (const key of [
    "ELECTRON_RUN_AS_NODE",
    "PIX_AUTO_START",
    "PIX_AUTO_PROMPT",
    "PIX_AUTO_ABORT",
    "PIX_AUTO_CRASH_PROBE",
    "PIX_AUTO_CLOSE_MS",
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
  await page.waitForSelector('[data-testid="pix-app"]', { timeout: 30_000 });
  // Let cold-start bootstrap (packages/resources refresh) settle before UI clicks.
  await page.waitForTimeout(800);

  return { app, page, root, workspace, attachmentPaths, fakeModel };
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

/** Start host via 新建会话 and wait until the shell reports ready. */
export async function startHost(page: Page): Promise<void> {
  await page.getByTestId("pix-app").waitFor({ state: "visible" });
  const btn = page.getByTestId("start-host");
  await btn.waitFor({ state: "visible", timeout: 15_000 });
  const snapshot = page.getByTestId("runtime-snapshot").first();
  await expect(snapshot).toContainText("runtimeId", { timeout: 30_000 });
  const before = await snapshot.textContent().catch(() => "");
  const previousRuntimeId = /"runtimeId":\s*"([^"]+)"/.exec(before ?? "")?.[1];
  // Bootstrap may remount the rail briefly — force click after short settle.
  await page.waitForTimeout(300);
  await btn.click({ force: true });
  // Cold bootstrap may already say "ready" while New conversation is replacing that host.
  // Wait for the replacement runtime so the next UI action cannot race clearActive().
  await expect
    .poll(
      async () => {
        const text = await snapshot.textContent().catch(() => "");
        return /"runtimeId":\s*"([^"]+)"/.exec(text ?? "")?.[1];
      },
      { timeout: 45_000 },
    )
    .not.toBe(previousRuntimeId);
  await expect(page.getByTestId("host-status").first()).toContainText(
    /Agent Host ready|Agent Host restarted|Agent Host ready|就绪/,
    { timeout: 45_000 },
  );
  await expect(page.getByTestId("runtime-snapshot").first()).toContainText("runtimeId", {
    timeout: 15_000,
  });
}

/** Pure-conversation sessions live under 对话, not project nested thread-list. */
export function conversationSessionButtons(page: Page) {
  return page.getByTestId("conversations-list").locator("button[data-active]");
}

/** Wait until agent turn settles (locale-agnostic). */
export async function waitSettled(page: Page, timeout = 60_000): Promise<void> {
  await expect(page.getByTestId("host-status").first()).toContainText(
    /Agent settled|Agent Host ready|Agent aborted/,
    { timeout },
  );
}

export async function sendPrompt(page: Page, text: string): Promise<void> {
  await page.getByTestId("prompt-input").fill(text);
  await page.getByTestId("send-prompt").click();
  await waitSettled(page);
}
