import { test, expect, startHost } from "./fixtures.ts";

test.describe("Desktop shell Playwright E2E (macOS Electron)", () => {
  test("Runtime: new thread, stream a tool turn, and abort a hanging response", async ({
    page,
  }) => {
    await startHost(page);
    await expect(page.getByTestId("sidebar")).toBeVisible();
    await expect(page.getByTestId("composer-dock")).toBeVisible();

    // Default prompt asks the fake model to use the read tool.
    await page.getByTestId("prompt-input").fill("Use the read tool for the fixture file.");
    await page.getByTestId("send-prompt").click();

    await expect(page.getByTestId("host-status")).toContainText("Agent settled", {
      timeout: 60_000,
    });
    // Tool turn: timeline shows tool activity; stream may buffer partial deltas until paint.
    await expect
      .poll(async () => page.getByTestId("timeline").innerText(), { timeout: 30_000 })
      .toMatch(/read|Tool/i);
    await expect(page.getByTestId("event-log")).toContainText("tool.");
    await expect(page.getByTestId("runtime-snapshot")).toContainText('"id": "pix-fake"');
    await expect(page.getByTestId("event-log")).toContainText("message.delta");

    // Mid-stream abort: fake model hangs after the first abort delta.
    await page.getByTestId("prompt-input").fill("ABORT this response after its first delta.");
    await page.getByTestId("send-prompt").click();
    await expect(page.getByTestId("host-status")).toContainText("Agent running");
    await expect
      .poll(async () => page.getByTestId("timeline").innerText(), { timeout: 30_000 })
      .toMatch(/Waiting for abort|abort/i);
    await page.getByTestId("abort-prompt").click();
    await expect(page.getByTestId("host-status")).toContainText(/Agent aborted|Agent settled/, {
      timeout: 30_000,
    });
  });

  test("sessions: create a second thread and switch back", async ({ page }) => {
    await startHost(page);

    await page.getByTestId("prompt-input").fill("first thread hello");
    await page.getByTestId("send-prompt").click();
    await expect(page.getByTestId("host-status")).toContainText("Agent settled", {
      timeout: 60_000,
    });
    await expect(page.getByTestId("timeline")).toContainText("first thread hello");

    const firstSnapshot = await page.getByTestId("runtime-snapshot").innerText();
    const firstSessionId = /"sessionId":\s*"([^"]+)"/.exec(firstSnapshot)?.[1];
    expect(firstSessionId).toBeTruthy();

    await page.getByTestId("start-host").click();
    await expect(page.getByTestId("host-status")).toContainText("Agent Host ready", {
      timeout: 30_000,
    });
    // New thread starts empty (Codex-like hero).
    await expect(page.getByTestId("empty-hero")).toBeVisible();
    await expect(page.getByTestId("empty-hero")).toBeVisible();
    await expect(page.getByText(/Explore and understand the code/i)).toHaveCount(0);

    await page.getByTestId("prompt-input").fill("second thread hello");
    await page.getByTestId("send-prompt").click();
    await expect(page.getByTestId("host-status")).toContainText("Agent settled", {
      timeout: 60_000,
    });
    await expect(page.getByTestId("timeline")).toContainText("second thread hello");

    // Thread list should show more than one row (title buttons, not menu … buttons).
    await expect(page.getByTestId("thread-list").locator("button[data-active]")).toHaveCount(2, {
      timeout: 10_000,
    });

    // Switch to the non-active thread (first one).
    await page.locator('[data-testid="thread-list"] button[data-active="false"]').first().click();
    await expect(page.getByTestId("host-status")).toContainText("Agent Host ready", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("timeline")).toContainText("first thread hello", {
      timeout: 15_000,
    });
    const switched = await page.getByTestId("runtime-snapshot").innerText();
    const switchedId = /"sessionId":\s*"([^"]+)"/.exec(switched)?.[1];
    expect(switchedId).toBe(firstSessionId);
  });

  test("packages: open installed page, install local source, then remove", async ({ page }) => {
    await startHost(page);
    await page.getByTestId("nav-packages").click();
    await expect(page.getByTestId("packages-page")).toBeVisible();
    await expect(page.getByTestId("packages-empty")).toContainText("No packages configured");
    await expect(page.getByTestId("packages-catalog-link")).toHaveAttribute(
      "href",
      "https://pi.dev/packages",
    );

    // Resolve absolute package path from runtime cwd (workspace).
    await page.getByRole("button", { name: "Back to thread" }).click();
    const threadSnapshot = await page.getByTestId("runtime-snapshot").innerText();
    const cwd = /"cwd":\s*"([^"]+)"/.exec(threadSnapshot)?.[1];
    expect(cwd).toBeTruthy();
    const localPackage = `${cwd}/e2e-local-package`;

    await page.getByTestId("nav-packages").click();
    await page.getByTestId("package-source-input").fill(localPackage);
    await page.getByTestId("package-scope-select").selectOption("global");
    await page.getByTestId("package-install-button").click();

    await expect(page.getByTestId("packages-list")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("packages-list")).toContainText("e2e-local-package");
    // Install may leave a transient status string; only fail on an explicit form error.
    if (await page.getByTestId("package-form-error").count()) {
      throw new Error(await page.getByTestId("package-form-error").innerText());
    }

    // Remove using the row action; wait for empty state or surface form errors.
    await page.getByTestId("packages-list").getByRole("button", { name: "Remove" }).click();
    await expect
      .poll(
        async () => {
          if (await page.getByTestId("packages-empty").count()) return "empty";
          if (await page.getByTestId("package-form-error").count()) {
            return await page.getByTestId("package-form-error").innerText();
          }
          return "pending";
        },
        { timeout: 60_000 },
      )
      .toBe("empty");

    await page.getByTestId("nav-resources").click();
    await expect(page.getByTestId("resources-page")).toBeVisible();
    await expect(page.getByTestId("resources-page")).toContainText("Resources");
  });

  test("palette, theme toggle, and fork thread", async ({ page }) => {
    await startHost(page);
    await page.getByTestId("prompt-input").fill("fork base message");
    await page.getByTestId("send-prompt").click();
    await expect(page.getByTestId("host-status")).toContainText("Agent settled", {
      timeout: 60_000,
    });

    // Theme control lives in appearance settings (not next to brand/search).
    await page.getByTestId("nav-settings").click();
    await page.getByTestId("settings-nav-appearance").click();
    await page.getByTestId("appearance-theme").selectOption("light");
    await expect(page.getByTestId("pix-app")).toHaveAttribute("data-theme", "light");
    await page.getByTestId("appearance-theme").selectOption("dark");
    await expect(page.getByTestId("pix-app")).toHaveAttribute("data-theme", "dark");
    await page.getByTestId("settings-back").click();

    await page.getByTestId("open-palette").click();
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.getByTestId("command-packages").click();
    await expect(page.getByTestId("packages-page")).toBeVisible();

    // Focus composer from a non-thread view must mount thread UI and focus the textarea.
    await page.getByTestId("open-palette").click();
    await page.getByTestId("command-focus-composer").click();
    await expect(page.getByTestId("composer-dock")).toBeVisible();
    await expect(page.getByTestId("prompt-input")).toBeFocused({ timeout: 10_000 });
    const activeTag = await page.evaluate(() =>
      document.activeElement?.getAttribute("data-testid"),
    );
    expect(activeTag).toBe("prompt-input");

    await page.getByTestId("open-palette").click();
    await page.getByTestId("command-thread").click();
    await expect(page.getByTestId("composer-dock")).toBeVisible();

    const before = await page.getByTestId("thread-list").locator("button[data-active]").count();
    // Fork probe lives under Developer (not primary chrome).
    await page.getByTestId("developer-summary").click();
    await page.getByTestId("fork-thread").click();
    await expect(page.getByTestId("host-status")).toContainText("Agent Host ready", {
      timeout: 30_000,
    });
    await expect
      .poll(async () => page.getByTestId("thread-list").locator("button[data-active]").count(), {
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(Math.max(before, 2));
  });

  test("m2: model/thinking/trust chips and openPath/resume workspace", async ({ page }) => {
    const { mkdir } = await import("node:fs/promises");
    const { dirname, join } = await import("node:path");

    await startHost(page);
    await expect(page.getByTestId("composer-dock").getByTestId("model-select")).toBeVisible();
    await expect(page.getByTestId("composer-dock").getByTestId("thinking-select")).toBeVisible();
    await expect(page.getByTestId("composer-dock").getByTestId("trust-chip")).toBeVisible();
    await expect(page.getByTestId("workspace-name")).toBeVisible();
    await expect(page.getByTestId("empty-hero")).toBeVisible();
    await expect(page.getByTestId("suggest-grid")).toHaveCount(0);

    const modelValue = await page
      .getByTestId("composer-dock")
      .getByTestId("model-select")
      .inputValue();
    expect(modelValue).toContain("pix-fake");

    // Thinking select has at least one option from snapshot.
    const thinkingOptions = await page
      .getByTestId("composer-dock")
      .getByTestId("thinking-select")
      .locator("option")
      .count();
    expect(thinkingOptions).toBeGreaterThan(0);

    // Persist a session, then reopen cwd with resumeRecent via workspace.openPath.
    await page.getByTestId("prompt-input").fill("resume base");
    await page.getByTestId("send-prompt").click();
    await expect(page.getByTestId("host-status")).toContainText("Agent settled", {
      timeout: 60_000,
    });
    await expect(page.getByTestId("usage-chip")).not.toHaveText("usage —", { timeout: 10_000 });
    await expect(page.getByTestId("runtime-snapshot")).toContainText('"usage"');
    const snap = await page.getByTestId("runtime-snapshot").innerText();
    const cwd = /"cwd":\s*"([^"]+)"/.exec(snap)?.[1];
    const sessionId = /"sessionId":\s*"([^"]+)"/.exec(snap)?.[1];
    const sessionFile = /"sessionFile":\s*"([^"]+)"/.exec(snap)?.[1];
    expect(cwd).toBeTruthy();
    expect(sessionId).toBeTruthy();
    expect(sessionFile).toBeTruthy();

    await page.evaluate(async (path) => {
      await window.pix.workspace.openPath(path, { resumeRecent: true });
    }, cwd!);
    await expect(page.getByTestId("host-status")).toContainText(/Agent Host ready|Agent settled/, {
      timeout: 30_000,
    });
    await expect
      .poll(
        async () => {
          const text = await page.getByTestId("runtime-snapshot").innerText();
          const resumedFile = /"sessionFile":\s*"([^"]+)"/.exec(text)?.[1];
          const resumedId = /"sessionId":\s*"([^"]+)"/.exec(text)?.[1];
          return resumedFile === sessionFile || resumedId === sessionId;
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    // Cross-cwd open must not keep the previous workspace sessionFile.
    const otherCwd = join(dirname(cwd!), "other-workspace");
    await mkdir(otherCwd, { recursive: true });
    await page.evaluate(async (path) => {
      await window.pix.workspace.openPath(path, { resumeRecent: false });
    }, otherCwd);
    await expect(page.getByTestId("host-status")).toContainText(/Agent Host ready|Agent settled/, {
      timeout: 30_000,
    });
    await expect
      .poll(
        async () => {
          const text = await page.getByTestId("runtime-snapshot").innerText();
          const nextCwd = /"cwd":\s*"([^"]+)"/.exec(text)?.[1];
          const nextFile = /"sessionFile":\s*"([^"]+)"/.exec(text)?.[1];
          if (nextCwd !== otherCwd) return false;
          if (nextFile && nextFile === sessionFile) return false;
          return true;
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    // Trust chip reflects snapshot; toggle probe is under Developer.
    await page.getByTestId("developer-summary").click();
    await page.getByTestId("trust-toggle").click();
    await expect(page.getByTestId("trust-chip")).toContainText(/trusted|untrusted|已信任|未信任/, {
      timeout: 15_000,
    });
  });

  test("m2: ephemeral openPath does not pollute recent workspaces UI", async ({ page }) => {
    const { mkdir } = await import("node:fs/promises");
    const { dirname, join } = await import("node:path");

    await startHost(page);
    const snap = await page.getByTestId("runtime-snapshot").innerText();
    const cwd = /"cwd":\s*"([^"]+)"/.exec(snap)?.[1];
    expect(cwd).toBeTruthy();

    // E2E dirs live under /var/folders/... and must not appear as product "recent projects".
    const other = join(dirname(cwd!), "recent-ws-b");
    await mkdir(other, { recursive: true });
    await page.evaluate(async (path) => {
      await window.pix.workspace.openPath(path, { resumeRecent: false });
    }, other);
    await expect(page.getByTestId("host-status")).toContainText(/Agent Host ready|Agent settled/, {
      timeout: 30_000,
    });

    const recent = await page.evaluate(async () => window.pix.workspace.listRecent());
    expect(recent).not.toContain(other);
    expect(recent.every((path) => !/pix-e2e-|\/var\/folders\//i.test(path))).toBe(true);
    await expect(
      page.locator(`[data-testid="recent-workspace-item"][data-path="${other}"]`),
    ).toHaveCount(0);
  });

  test("m2: settings providers list has non-secret auth status", async ({ page }) => {
    await startHost(page);
    await page.getByTestId("nav-settings").click();
    await expect(page.getByTestId("settings-page")).toBeVisible();
    await expect(page.getByTestId("settings-rail")).toBeVisible();
    await page.getByTestId("settings-nav-providers").click();
    await expect(page.getByTestId("providers-list")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("provider-row-pix-fake")).toBeVisible();
    await expect(page.getByTestId("provider-configured-pix-fake")).toContainText(
      /configured|missing/,
    );
    const body = await page.getByTestId("providers-list").innerText();
    expect(body.toLowerCase()).not.toContain("test-key");
    expect(body).not.toMatch(/sk-[a-z0-9]{8,}/i);
  });

  test("shell: collapse sidebar, settings rail, appearance, no suggest prompts", async ({
    page,
  }) => {
    await startHost(page);
    await expect(page.getByTestId("empty-hero")).toBeVisible();
    await expect(page.getByTestId("suggest-grid")).toHaveCount(0);
    await expect(page.getByText("Explore and understand the code")).toHaveCount(0);

    // Geometry: overlay sidebar + shell-main marginLeft; composer is inset-x-0 in main.
    async function assertComposerAlignedToMain(opts?: { collapsed?: boolean }) {
      const main = await page.getByTestId("shell-main").boundingBox();
      const dock = await page.getByTestId("composer-dock").boundingBox();
      const app = await page.getByTestId("pix-app").boundingBox();
      expect(main).toBeTruthy();
      expect(dock).toBeTruthy();
      expect(app).toBeTruthy();
      expect(Math.abs(dock!.x - main!.x)).toBeLessThan(8);
      // Content column must fill remaining width (not shrink-to-content leaving a dead right strip).
      expect(Math.abs(main!.x + main!.width - (app!.x + app!.width))).toBeLessThan(12);
      if (opts?.collapsed) {
        // Full collapse: rail width 0 — main flush to shell left (no icon strip).
        const sidebar = await page.getByTestId("sidebar").boundingBox();
        const sidebarWidth = sidebar?.width ?? 0;
        expect(sidebarWidth).toBeLessThan(4);
        expect(main!.x - app!.x).toBeLessThan(8);
      } else {
        const sidebar = await page.getByTestId("sidebar").boundingBox();
        expect(sidebar).toBeTruthy();
        expect(sidebar!.width).toBeGreaterThan(200);
        expect(Math.abs(main!.x - (sidebar!.x + sidebar!.width))).toBeLessThan(12);
      }
    }
    await assertComposerAlignedToMain();
    await expect(page.getByTestId("sidebar")).toHaveAttribute("data-translucent", "true");
    const mainExpanded = await page.getByTestId("shell-main").boundingBox();

    // Packages page must also fill shell-main width (while expanded — rail is full-width only).
    await page.getByTestId("nav-packages").click();
    await expect(page.getByTestId("packages-page")).toBeVisible();
    const packagesBox = await page.getByTestId("packages-page").boundingBox();
    const shellMain = await page.getByTestId("shell-main").boundingBox();
    expect(packagesBox).toBeTruthy();
    expect(shellMain).toBeTruthy();
    expect(Math.abs(packagesBox!.width - shellMain!.width)).toBeLessThan(16);
    await page.getByRole("button", { name: /Back to thread|返回应用|Back to app/ }).click();

    await page.getByTestId("sidebar-collapse").click();
    await expect(page.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "true");
    await assertComposerAlignedToMain({ collapsed: true });
    const mainCollapsed = await page.getByTestId("shell-main").boundingBox();
    expect(mainCollapsed!.x).toBeLessThan(mainExpanded!.x);
    expect(mainCollapsed!.width).toBeGreaterThan(mainExpanded!.width);
    // Expand control remains after traffic lights; nav is fully tucked away.
    await expect(page.getByTestId("sidebar-collapse")).toBeVisible();
    await expect(page.getByTestId("nav-packages")).toHaveCount(0);

    // composer still usable after full collapse
    await page.getByTestId("prompt-input").fill("after collapse");
    await page.getByTestId("send-prompt").click();
    await expect(page.getByTestId("host-status")).toContainText("Agent settled", {
      timeout: 60_000,
    });

    await page.getByTestId("sidebar-collapse").click();
    await expect(page.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "false");
    await assertComposerAlignedToMain();

    await page.getByTestId("nav-settings").click();
    await expect(page.getByTestId("settings-rail")).toBeVisible();
    await expect(page.getByTestId("settings-page")).toBeVisible();
    // Codex-style: default 常规 + grouped rail (个人 / 集成 / …)
    await expect(page.getByTestId("settings-general")).toBeVisible();
    await expect(page.getByTestId("settings-group-personal")).toBeVisible();
    await page.getByTestId("appearance-locale").selectOption("en");
    await page.getByTestId("settings-nav-appearance").click();
    await expect(page.getByTestId("settings-appearance")).toBeVisible();
    // Sidebar translucency lives under Appearance (not General).
    await expect(page.getByTestId("appearance-translucent")).toHaveAttribute("data-on", "true");
    await expect(page.getByTestId("settings-back")).toContainText(/Back to app|返回应用/);
    await page.getByTestId("settings-back").click();
    await expect(page.getByTestId("thread-list")).toBeVisible();
  });

  test("Crash recovery: crash probe keeps the window alive and New thread recovers the host", async ({
    page,
  }) => {
    await startHost(page);

    const firstSnapshot = await page.getByTestId("runtime-snapshot").innerText();
    expect(firstSnapshot).toContain("runtimeId");
    const firstRuntimeId = /"runtimeId":\s*"([^"]+)"/.exec(firstSnapshot)?.[1];
    expect(firstRuntimeId).toBeTruthy();

    // Probe controls live under collapsible Developer section (not primary chrome).
    await page.getByTestId("developer-summary").click();
    await page.getByTestId("crash-host").click({ force: true });
    await expect(page.getByTestId("host-status")).toContainText("Agent Host exited", {
      timeout: 15_000,
    });
    // Window must still be interactive.
    await expect(page.getByTestId("pix-app")).toBeVisible();
    await expect(page.getByTestId("start-host")).toBeEnabled();

    await page.getByTestId("start-host").click();
    await expect(page.getByTestId("host-status")).toContainText(
      /Agent Host ready|Agent Host restarted/,
      {
        timeout: 30_000,
      },
    );

    const recovered = await page.getByTestId("runtime-snapshot").innerText();
    const secondRuntimeId = /"runtimeId":\s*"([^"]+)"/.exec(recovered)?.[1];
    expect(secondRuntimeId).toBeTruthy();
    expect(secondRuntimeId).not.toBe(firstRuntimeId);

    // Post-recovery prompt still works through the four-process path.
    await page.getByTestId("prompt-input").fill("hello after crash");
    await page.getByTestId("send-prompt").click();
    await expect(page.getByTestId("host-status")).toContainText("Agent settled", {
      timeout: 60_000,
    });
    await expect
      .poll(async () => page.getByTestId("timeline").innerText(), { timeout: 30_000 })
      .toMatch(/Pix fake model|hello after crash/i);
  });
});
