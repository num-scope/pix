import {
  test,
  expect,
  startHost,
  conversationSessionButtons,
  sendPrompt,
  waitSettled,
} from "./fixtures.ts";

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

    await expect(page.getByTestId("host-status").first()).toContainText("Agent settled", {
      timeout: 60_000,
    });
    // Tool turn: timeline shows tool activity; stream may buffer partial deltas until paint.
    await expect
      .poll(async () => page.getByTestId("timeline").innerText(), { timeout: 30_000 })
      .toMatch(/read|Tool/i);
    await expect(page.getByTestId("event-log").first()).toContainText("tool.");
    await expect(page.getByTestId("runtime-snapshot").first()).toContainText('"id": "pix-fake"');
    await expect(page.getByTestId("event-log").first()).toContainText("message.delta");

    // Mid-stream abort: fake model hangs after the first abort delta.
    await page.getByTestId("prompt-input").fill("ABORT this response after its first delta.");
    await page.getByTestId("send-prompt").click();
    await expect(page.getByTestId("host-status").first()).toContainText("Agent running");
    await expect
      .poll(async () => page.getByTestId("timeline").innerText(), { timeout: 30_000 })
      .toMatch(/Waiting for abort|abort/i);
    await page.getByTestId("abort-prompt").click();
    await expect(page.getByTestId("host-status").first()).toContainText(
      /Agent aborted|Agent settled/,
      { timeout: 30_000 },
    );
  });

  test("sessions: create a second conversation and switch back", async ({ page }) => {
    await startHost(page);

    await sendPrompt(page, "first thread hello");
    await expect(page.getByTestId("timeline")).toContainText("first thread hello");

    const firstSnapshot = await page.getByTestId("runtime-snapshot").first().innerText();
    const firstSessionId = /"sessionId":\s*"([^"]+)"/.exec(firstSnapshot)?.[1];
    expect(firstSessionId).toBeTruthy();

    // Global 新建会话 → pure conversation (under 对话, not project thread-list).
    await page.getByTestId("start-host").click({ force: true });
    await expect(page.getByTestId("host-status").first()).toContainText(
      /Agent Host ready|开始对话|Start a conversation/,
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("empty-hero")).toBeVisible();
    await expect(page.getByText(/Explore and understand the code/i)).toHaveCount(0);

    await sendPrompt(page, "second thread hello");
    await expect(page.getByTestId("timeline")).toContainText("second thread hello");

    // Conversations list holds pure sessions (PIX_WORKSPACE is ephemeral → not a project).
    await expect(conversationSessionButtons(page)).toHaveCount(2, { timeout: 15_000 });

    // Switch to the non-active conversation.
    await conversationSessionButtons(page).filter({ hasNot: page.locator('[data-active="true"]') }).first().click();
    // Or click data-active=false
    const inactive = page
      .getByTestId("conversations-list")
      .locator('button[data-active="false"]')
      .first();
    if (await inactive.count()) {
      await inactive.click();
    }

    await expect(page.getByTestId("host-status").first()).toContainText(
      /Agent Host ready|Switching|Agent settled/,
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("timeline")).toContainText("first thread hello", {
      timeout: 20_000,
    });
    const switched = await page.getByTestId("runtime-snapshot").first().innerText();
    const switchedId = /"sessionId":\s*"([^"]+)"/.exec(switched)?.[1];
    expect(switchedId).toBe(firstSessionId);
  });

  test("packages: open installed page, install local source, then remove", async ({
    page,
    pix,
  }) => {
    await startHost(page);
    await page.getByTestId("nav-packages").click();
    await expect(page.getByTestId("packages-page")).toBeVisible();
    await expect(page.getByTestId("packages-empty")).toBeVisible();
    await expect(page.getByTestId("packages-empty")).toContainText(
      /No packages|尚未配置|尚未安装/i,
    );
    // Discover tab holds the official gallery link.
    await page.getByTestId("packages-tab-discover").click();
    await expect(page.getByTestId("packages-catalog-link")).toHaveAttribute(
      "href",
      "https://pi.dev/packages",
    );
    await page.getByTestId("packages-tab-installed").click();

    const localPackage = `${pix.workspace}/e2e-local-package`;

    await page.getByTestId("package-source-input").fill(localPackage);
    await page.getByTestId("package-scope-select").selectOption("global");
    await page.getByTestId("package-install-button").click();

    await expect(page.getByTestId("packages-list")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("packages-list")).toContainText("e2e-local-package");
    if (await page.getByTestId("package-form-error").count()) {
      throw new Error(await page.getByTestId("package-form-error").innerText());
    }

    // Remove using the row action (locale-agnostic: last primary/danger action).
    const removeBtn = page
      .getByTestId("packages-list")
      .getByRole("button")
      .filter({ hasText: /Remove|移除|删除/i });
    await removeBtn.first().click();
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
    await expect(page.getByTestId("resources-page")).toContainText(/Resources|资源/i);
  });

  test("palette, theme toggle, and fork thread", async ({ page }) => {
    await startHost(page);
    await sendPrompt(page, "fork base message");

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

    await page.getByTestId("open-palette").click();
    await page.getByTestId("command-thread").click();
    await expect(page.getByTestId("composer-dock")).toBeVisible();

    const before = await conversationSessionButtons(page).count();
    // Fork probe lives under Developer (not primary chrome).
    await page.getByTestId("developer-summary").click();
    await page.getByTestId("fork-thread").click();
    await expect(page.getByTestId("host-status").first()).toContainText("Agent Host ready", {
      timeout: 30_000,
    });
    await expect
      .poll(async () => conversationSessionButtons(page).count(), {
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(Math.max(before, 2));
  });

  test("m2: model/thinking chips, openPath/resume workspace", async ({ page }) => {
    const { mkdir } = await import("node:fs/promises");
    const { dirname, join } = await import("node:path");

    await startHost(page);
    await expect(page.getByTestId("composer-dock").getByTestId("model-select")).toBeAttached();
    await expect(page.getByTestId("composer-dock").getByTestId("thinking-select")).toBeVisible();
    // Trust chip is intentionally sr/hidden in product chrome — still present for probes.
    await expect(page.getByTestId("composer-dock").getByTestId("trust-chip")).toBeAttached();
    await expect(page.getByTestId("empty-hero")).toBeVisible();
    await expect(page.getByTestId("suggest-grid")).toHaveCount(0);

    const modelLabel = await page
      .getByTestId("composer-dock")
      .getByTestId("model-select-label")
      .innerText()
      .catch(async () => page.getByTestId("model-select").inputValue());
    expect(modelLabel.toLowerCase()).toMatch(/pix-fake|fake/);

    const thinkingOptions = await page
      .getByTestId("composer-dock")
      .getByTestId("thinking-select")
      .locator("option")
      .count();
    expect(thinkingOptions).toBeGreaterThan(0);

    await sendPrompt(page, "resume base");
    await expect(page.getByTestId("runtime-snapshot").first()).toContainText('"usage"');
    const snap = await page.getByTestId("runtime-snapshot").first().innerText();
    const cwd = /"cwd":\s*"([^"]+)"/.exec(snap)?.[1];
    const sessionId = /"sessionId":\s*"([^"]+)"/.exec(snap)?.[1];
    const sessionFile = /"sessionFile":\s*"([^"]+)"/.exec(snap)?.[1];
    expect(cwd).toBeTruthy();
    expect(sessionId).toBeTruthy();
    expect(sessionFile).toBeTruthy();

    // openPath via IPC — pull snapshot from API (renderer probe may lag host.ready).
    await page.evaluate(async (path) => {
      await window.pix.workspace.openPath(path, { resumeRecent: true });
    }, cwd!);
    await expect
      .poll(
        async () => {
          const snap = await page.evaluate(async () => window.pix.host.snapshot());
          return (
            snap.sessionFile === sessionFile ||
            snap.sessionId === sessionId ||
            snap.cwd === cwd
          );
        },
        { timeout: 20_000 },
      )
      .toBe(true);

    // Cross-cwd open must not keep the previous workspace sessionFile.
    // Avoid path segments filtered by isEphemeralWorkspacePath (e.g. "other-workspace").
    const otherCwd = join(dirname(cwd!), "project-b");
    await mkdir(otherCwd, { recursive: true });
    const openResult = await page.evaluate(async (path) => {
      try {
        const snap = await window.pix.workspace.openPath(path, { resumeRecent: false });
        return { ok: true as const, cwd: snap.cwd, sessionFile: snap.sessionFile ?? null };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
      }
    }, otherCwd);
    expect(openResult.ok, JSON.stringify(openResult)).toBe(true);
    if (openResult.ok) {
      expect(openResult.cwd).toBe(otherCwd);
      expect(openResult.sessionFile).not.toBe(sessionFile);
    }

    // Trust toggle probe under Developer.
    await page.getByTestId("developer-summary").click();
    await page.getByTestId("trust-toggle").click();
    await expect(page.getByTestId("trust-chip")).toContainText(
      /trusted|untrusted|已信任|未信任/i,
      { timeout: 15_000 },
    );
  });

  test("m2: ephemeral openPath does not pollute recent workspaces UI", async ({ page }) => {
    const { mkdir } = await import("node:fs/promises");
    const { dirname, join } = await import("node:path");

    await startHost(page);
    const snap = await page.getByTestId("runtime-snapshot").first().innerText();
    const cwd = /"cwd":\s*"([^"]+)"/.exec(snap)?.[1];
    expect(cwd).toBeTruthy();

    const other = join(dirname(cwd!), "recent-ws-b");
    await mkdir(other, { recursive: true });
    await page.evaluate(async (path) => {
      await window.pix.workspace.openPath(path, { resumeRecent: false });
    }, other);
    await expect(page.getByTestId("host-status").first()).toContainText(
      /Agent Host ready|Agent settled/,
      { timeout: 30_000 },
    );

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
      /configured|missing|已配置|未配置/i,
    );
    const body = await page.getByTestId("providers-list").innerText();
    expect(body.toLowerCase()).not.toContain("test-key");
    expect(body).not.toMatch(/sk-[a-z0-9]{8,}/i);
  });

  test("settings: environment visibility toggles and shortcuts page", async ({ page }) => {
    await startHost(page);
    await page.getByTestId("nav-settings").click();

    await page.getByTestId("settings-nav-environment").click();
    await expect(page.getByTestId("settings-environment")).toBeVisible();
    await expect(page.getByTestId("settings-env-visibility")).toBeVisible();
    await expect(page.getByTestId("settings-env-changes")).toBeVisible();
    // Toggle off changes group
    await page.getByTestId("settings-env-changes").click();
    await expect(page.getByTestId("settings-env-changes")).toHaveAttribute("data-on", "false");

    await page.getByTestId("settings-nav-shortcuts").click();
    await expect(page.getByTestId("settings-shortcuts")).toBeVisible();
    await expect(page.getByTestId("settings-shortcuts-list")).toBeVisible();
    await expect(page.getByTestId("shortcut-bind-new-thread")).toBeVisible();

    await page.getByTestId("settings-back").click();
    await expect(page.getByTestId("composer-dock")).toBeVisible();
  });

  test("shell: collapse sidebar, settings rail, appearance, no suggest prompts", async ({
    page,
  }) => {
    await startHost(page);
    await expect(page.getByTestId("empty-hero")).toBeVisible();
    await expect(page.getByTestId("suggest-grid")).toHaveCount(0);
    await expect(page.getByText("Explore and understand the code")).toHaveCount(0);

    async function assertComposerAlignedToMain(opts?: { collapsed?: boolean }) {
      const main = await page.getByTestId("shell-main").boundingBox();
      const dock = await page.getByTestId("composer-dock").boundingBox();
      const app = await page.getByTestId("pix-app").boundingBox();
      expect(main).toBeTruthy();
      expect(dock).toBeTruthy();
      expect(app).toBeTruthy();
      // shell-main is full-bleed under the frosted rail; content is inset via padding.
      expect(Math.abs(main!.x - app!.x)).toBeLessThan(8);
      expect(Math.abs(main!.x + main!.width - (app!.x + app!.width))).toBeLessThan(12);
      // Composer is centered with min-width 630; left edge is within the padded content.
      expect(dock!.x).toBeGreaterThanOrEqual(main!.x - 2);
      expect(dock!.x + dock!.width).toBeLessThanOrEqual(main!.x + main!.width + 2);
      if (opts?.collapsed) {
        const sidebar = await page.getByTestId("sidebar").boundingBox();
        const sidebarWidth = sidebar?.width ?? 0;
        expect(sidebarWidth).toBeLessThan(4);
        expect(Number(await page.getByTestId("shell-main").getAttribute("data-rail-width"))).toBe(0);
      } else {
        const sidebar = await page.getByTestId("sidebar").boundingBox();
        expect(sidebar).toBeTruthy();
        expect(sidebar!.width).toBeGreaterThan(200);
        // Content (composer) starts after the rail overlay.
        expect(dock!.x).toBeGreaterThanOrEqual(sidebar!.x + sidebar!.width - 4);
        const railAttr = Number(await page.getByTestId("shell-main").getAttribute("data-rail-width"));
        expect(railAttr).toBeGreaterThan(200);
      }
    }
    await assertComposerAlignedToMain();
    await expect(page.getByTestId("sidebar")).toHaveAttribute("data-translucent", "true");
    const mainExpanded = await page.getByTestId("shell-main").boundingBox();

    await page.getByTestId("nav-packages").click();
    await expect(page.getByTestId("packages-page")).toBeVisible();
    const packagesBox = await page.getByTestId("packages-page").boundingBox();
    const shellMain = await page.getByTestId("shell-main").boundingBox();
    const sidebarBox = await page.getByTestId("sidebar").boundingBox();
    expect(packagesBox).toBeTruthy();
    expect(shellMain).toBeTruthy();
    expect(sidebarBox).toBeTruthy();
    // Content width ≈ full shell minus rail padding (full-bleed main under glass).
    const railW = sidebarBox!.width;
    expect(Math.abs(packagesBox!.width - (shellMain!.width - railW))).toBeLessThan(24);
    expect(packagesBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x + railW - 4);
    await page.getByTestId("settings-back").or(page.getByRole("button", { name: /Back|返回/i })).first().click().catch(async () => {
      // Packages page back button
      await page.getByRole("button", { name: /Back to thread|返回对话|返回应用/i }).click();
    });
    // Prefer packages back
    if (await page.getByTestId("packages-page").count()) {
      await page.getByRole("button", { name: /Back to thread|返回对话|返回应用|Back/i }).click();
    }

    await page.getByTestId("sidebar-collapse").click();
    await expect(page.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "true");
    await assertComposerAlignedToMain({ collapsed: true });
    const mainCollapsed = await page.getByTestId("shell-main").boundingBox();
    // Full-bleed main keeps the same frame; rail padding drops so content gains width.
    expect(Math.abs(mainCollapsed!.x - mainExpanded!.x)).toBeLessThan(8);
    expect(Math.abs(mainCollapsed!.width - mainExpanded!.width)).toBeLessThan(8);
    expect(Number(await page.getByTestId("shell-main").getAttribute("data-rail-width"))).toBe(0);
    await expect(page.getByTestId("sidebar-collapse")).toBeVisible();
    await expect(page.getByTestId("nav-packages")).toHaveCount(0);

    await page.getByTestId("prompt-input").fill("after collapse");
    await page.getByTestId("send-prompt").click();
    await expect(page.getByTestId("host-status").first()).toContainText("Agent settled", {
      timeout: 60_000,
    });

    await page.getByTestId("sidebar-collapse").click();
    await expect(page.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "false");
    await assertComposerAlignedToMain();

    await page.getByTestId("nav-settings").click();
    await expect(page.getByTestId("settings-rail")).toBeVisible();
    await expect(page.getByTestId("settings-page")).toBeVisible();
    await expect(page.getByTestId("settings-general")).toBeVisible();
    // Locale may live on general
    const localeSelect = page.getByTestId("appearance-locale");
    if (await localeSelect.count()) {
      await localeSelect.selectOption("en");
    }
    await page.getByTestId("settings-nav-appearance").click();
    await expect(page.getByTestId("settings-appearance")).toBeVisible();
    await expect(page.getByTestId("appearance-translucent")).toHaveAttribute("data-on", "true");
    await expect(page.getByTestId("settings-back")).toContainText(/Back to app|返回应用/);
    await page.getByTestId("settings-back").click();
    await expect(page.getByTestId("composer-dock")).toBeVisible();
  });

  test("Crash recovery: crash probe keeps the window alive and New thread recovers the host", async ({
    page,
  }) => {
    await startHost(page);

    const firstSnapshot = await page.getByTestId("runtime-snapshot").first().innerText();
    expect(firstSnapshot).toContain("runtimeId");
    const firstRuntimeId = /"runtimeId":\s*"([^"]+)"/.exec(firstSnapshot)?.[1];
    expect(firstRuntimeId).toBeTruthy();

    await page.getByTestId("developer-summary").click();
    await page.getByTestId("crash-host").click({ force: true });
    await expect(page.getByTestId("host-status").first()).toContainText("Agent Host exited", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("pix-app")).toBeVisible();
    await expect(page.getByTestId("start-host")).toBeEnabled();

    await page.getByTestId("start-host").click({ force: true });
    await expect(page.getByTestId("host-status").first()).toContainText(
      /Agent Host ready|Agent Host restarted/,
      { timeout: 45_000 },
    );

    const recovered = await page.getByTestId("runtime-snapshot").first().innerText();
    const secondRuntimeId = /"runtimeId":\s*"([^"]+)"/.exec(recovered)?.[1];
    expect(secondRuntimeId).toBeTruthy();
    expect(secondRuntimeId).not.toBe(firstRuntimeId);

    await sendPrompt(page, "hello after crash");
    await expect(page.getByTestId("timeline")).toContainText("hello after crash", {
      timeout: 15_000,
    });
  });
});
