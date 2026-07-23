import { test, expect, startHost, conversationSessionButtons, sendPrompt } from "./fixtures.ts";

test.describe("Desktop shell Playwright E2E (macOS Electron)", () => {
  test("conversation content renders safe interactive rich content", async ({ page, pix }) => {
    await startHost(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            (window as Window & { __copiedCode?: string }).__copiedCode = value;
          },
        },
      });
    });
    await pix.app.evaluate(({ shell }) => {
      const state = globalThis as typeof globalThis & {
        __openedFile?: string;
        __openedExternal?: string;
      };
      Object.defineProperty(shell, "openPath", {
        configurable: true,
        value: async (path: string) => {
          state.__openedFile = path;
          return "";
        },
      });
      Object.defineProperty(shell, "openExternal", {
        configurable: true,
        value: async (url: string) => {
          state.__openedExternal = url;
        },
      });
    });
    await sendPrompt(page, "Render the rich content fixture.");

    const timeline = page.getByTestId("timeline");
    await expect(timeline).toContainText("Rich content");
    await expect(timeline.locator('input[type="checkbox"]')).toHaveCount(2);
    await expect(timeline.locator('input[type="checkbox"]').first()).toBeChecked();
    await expect(timeline.locator("del")).toContainText("Removed text");
    await expect(page.locator(".content-table-scroll")).toBeVisible();
    await expect(page.locator(".katex").first()).toBeVisible();
    await expect(page.locator(".katex-display")).toBeVisible();

    const javascript = page.locator('.content-code-block[data-language="javascript"]');
    await expect(javascript.locator(".hljs")).toBeVisible();
    await javascript.getByRole("button").click();
    await expect(javascript.getByRole("button")).toContainText(/Copied|已复制/i);
    expect(
      await page.evaluate(() => (window as Window & { __copiedCode?: string }).__copiedCode),
    ).toBe("const answer = 42;");

    await expect(page.locator('.content-code-block[data-language="diff"]')).toBeVisible();
    await expect(page.getByTestId("mermaid-diagram")).toBeVisible({ timeout: 15_000 });

    const fileLink = timeline.locator("a.content-file-link");
    await expect(fileLink).toHaveAttribute("title", `${pix.workspace}/fixture.txt`);
    await fileLink.click();
    await expect
      .poll(() =>
        pix.app.evaluate(
          () => (globalThis as typeof globalThis & { __openedFile?: string }).__openedFile,
        ),
      )
      .toBe(`${pix.workspace}/fixture.txt`);

    const externalLink = timeline.getByRole("link", { name: /External docs/ });
    await expect(externalLink).toHaveAttribute("href", "https://example.com/docs");
    await externalLink.click();
    await expect
      .poll(() =>
        pix.app.evaluate(
          () => (globalThis as typeof globalThis & { __openedExternal?: string }).__openedExternal,
        ),
      )
      .toBe("https://example.com/docs");

    const image = timeline.locator(".content-image-button");
    await expect(image).toBeVisible();
    await image.click();
    await expect(page.locator('.content-image-preview-dialog[role="dialog"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('.content-image-preview-dialog[role="dialog"]')).toHaveCount(0);
    await expect(timeline.locator("video.content-video")).toHaveAttribute("src", /demo\.mp4$/);
    await expect(timeline.locator("video.content-video")).toHaveAttribute("controls", "");

    await expect(timeline.locator("script, iframe, [data-unsafe-html]")).toHaveCount(0);
    await expect(timeline.locator(".pix-md > style")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => (window as Window & { __pixUnsafeScript?: boolean }).__pixUnsafeScript,
      ),
    ).toBeUndefined();
  });

  test("structured thinking is separated from the assistant answer", async ({ page }) => {
    await startHost(page);
    await sendPrompt(page, "Render the structured timeline fixture.");

    const process = page.getByTestId("timeline-process");
    await expect(process).toBeVisible();
    await process.locator(".timeline-process-summary").click();
    const thinking = process.locator('[data-kind="thinking"]');
    await expect(thinking).toBeVisible();
    await thinking.locator(".content-thinking-trigger").click();
    await expect(thinking).toContainText("Check the structured timeline first.");
    await expect(page.locator('[data-kind="assistant"]')).toContainText(
      "Structured timeline ready.",
    );
    await expect(page.getByTestId("event-log").first()).toContainText("thinking.delta");
  });

  test("Runtime: new thread, stream a tool turn, and abort a hanging response", async ({
    page,
  }) => {
    await startHost(page);
    await expect(page.getByTestId("sidebar")).toBeVisible();
    await expect(page.getByTestId("composer-dock")).toBeVisible();

    await page.getByTestId("prompt-input").fill("/");
    await expect(page.getByTestId("composer-slash-menu")).toBeVisible();
    await expect(page.getByTestId("composer-slash-menu")).toContainText("/e2e-review");
    await expect(page.getByTestId("composer-slash-menu")).toContainText("/skill:e2e-skill");
    await page.getByTestId("composer-slash-item").filter({ hasText: "/e2e-review" }).click();
    await expect(page.getByTestId("prompt-input")).toHaveValue("/e2e-review ");

    await page.getByTestId("prompt-input").fill("@");
    await expect(page.getByTestId("composer-attach-menu")).toBeVisible();
    await expect(page.getByTestId("composer-attach-files")).toBeVisible();
    await expect(page.getByTestId("composer-attach-menu")).toContainText("fixture.txt");
    await expect(page.getByTestId("composer-attach-menu")).not.toContainText("/e2e-review");

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
    await page.getByTestId("timeline-process").locator(".timeline-process-summary").click();
    const toolCard = page.locator('[data-kind="tool"]');
    await expect(toolCard).toHaveCount(1);
    await expect(toolCard).toHaveAttribute("data-status", "completed");
    await toolCard.locator(".content-tool-card-trigger").click();
    await expect(toolCard).toContainText("Pix Playwright E2E fixture");

    // Mid-stream abort: fake model hangs after the first abort delta.
    await page.getByTestId("prompt-input").fill("ABORT this response after its first delta.");
    await page.getByTestId("send-prompt").click();
    await expect(page.getByTestId("host-status").first()).toContainText("Agent running");
    await expect
      .poll(async () => page.getByTestId("timeline").innerText(), { timeout: 30_000 })
      .toMatch(/Waiting for abort|abort/i);
    await page.getByTestId("prompt-input").fill("Queued guidance while the model is running.");
    await page.getByTestId("queue-prompt").click();
    await expect(page.getByTestId("composer-queue-card")).toContainText("Queued guidance", {
      timeout: 10_000,
    });
    await page.getByTestId("prompt-input").fill("Queued follow-up after the model settles.");
    await page.getByTestId("prompt-input").press("Alt+Enter");
    await expect(page.getByTestId("composer-queue-card")).toContainText("Queued follow-up", {
      timeout: 10_000,
    });
    await expect(page.getByTestId("composer-queue-card")).toContainText(/Follow-up|后续/i);
    await page.getByTestId("composer-queue-clear").click();
    await expect(page.getByTestId("composer-queue-card")).toHaveCount(0);
    await page.getByTestId("abort-prompt").click();
    await expect(page.getByTestId("host-status").first()).toContainText(
      /Agent aborted|Agent settled/,
      { timeout: 30_000 },
    );
    await expect(page.locator('[data-kind="system"].is-error')).toContainText("Response stopped");
  });

  test("attachments render typed cards from picker through the sent timeline", async ({
    page,
    pix,
  }) => {
    await startHost(page);
    await pix.app.evaluate(({ dialog }, paths) => {
      Object.defineProperty(dialog, "showOpenDialog", {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: paths }),
      });
    }, pix.attachmentPaths);

    await page.getByTestId("composer-attach").click();
    await expect(page.getByTestId("composer-attach-menu")).toBeVisible();
    await page.getByTestId("composer-attach-files").click();

    const cards = page.getByTestId("composer-attachment-card");
    await expect(cards).toHaveCount(11);
    expect(await cards.evaluateAll((items) => items.map((item) => item.dataset.kind))).toEqual([
      "spreadsheet",
      "image",
      "pdf",
      "presentation",
      "document",
      "archive",
      "text",
      "text",
      "code",
      "code",
      "code",
    ]);
    await expect(page.getByTestId("composer-attachments")).toContainText(
      /Excel|PNG|PDF|PowerPoint|Word|ZIP|Markdown|JavaScript|Python/,
    );

    const imageCard = cards.filter({ hasText: "photo.png" });
    await imageCard.getByRole("button").click();
    await expect(cards).toHaveCount(10);
    await page.getByTestId("composer-attach").click();
    await page.getByTestId("composer-attach-files").click();
    await expect(cards).toHaveCount(11);

    await page.getByTestId("prompt-input").fill("Inspect every attachment card.");
    await page.getByTestId("send-prompt").click();
    await expect(page.getByTestId("host-status").first()).toContainText("Agent settled", {
      timeout: 60_000,
    });

    const sentCards = page.getByTestId("timeline-attachments").locator("button");
    await expect(sentCards).toHaveCount(11);
    await expect(page.getByTestId("timeline")).toContainText("Inspect every attachment card.");
    await expect(page.getByTestId("timeline")).not.toContainText("<attached-paths>");
    const request = JSON.stringify(pix.fakeModel.requests.at(-1));
    for (const path of pix.attachmentPaths) expect(request).toContain(path);
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
    await conversationSessionButtons(page)
      .filter({ hasNot: page.locator('[data-active="true"]') })
      .first()
      .click();
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

  test("palette, theme toggle, and fork thread", async ({ page, pix }) => {
    await startHost(page);
    await sendPrompt(page, "fork base message");

    // Theme control lives in appearance settings (not next to brand/search).
    await page.getByTestId("nav-settings").click();
    await page.getByTestId("settings-nav-appearance").click();
    const sidebarMaterial = () =>
      page.getByTestId("sidebar").evaluate((element) => {
        const style = getComputedStyle(element);
        const color = style.backgroundColor;
        const slash = /\/\s*([\d.]+)(%)?\s*\)/.exec(color);
        const rgba = /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/.exec(color);
        const alpha = slash ? Number(slash[1]) / (slash[2] ? 100 : 1) : rgba ? Number(rgba[1]) : 1;
        return {
          alpha,
          backdrop: style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter"),
        };
      });

    await page.getByTestId("appearance-theme").click();
    await page.getByRole("option", { name: /Light|浅色/ }).click();
    await expect(page.getByTestId("pix-app")).toHaveAttribute("data-theme", "light");
    await expect
      .poll(() => pix.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource))
      .toBe("light");
    await expect.poll(async () => (await sidebarMaterial()).alpha).toBe(0);
    await expect.poll(async () => (await sidebarMaterial()).backdrop).toBe("none");

    await page.getByTestId("appearance-translucent").click();
    await expect(page.getByTestId("sidebar")).toHaveAttribute("data-translucent", "false");
    await expect.poll(async () => (await sidebarMaterial()).alpha).toBe(1);
    await expect.poll(async () => (await sidebarMaterial()).backdrop).toBe("none");
    await page.getByTestId("appearance-translucent").click();
    await expect(page.getByTestId("sidebar")).toHaveAttribute("data-translucent", "true");

    await page.getByTestId("appearance-theme").click();
    await page.getByRole("option", { name: /Dark|深色/ }).click();
    await expect(page.getByTestId("pix-app")).toHaveAttribute("data-theme", "dark");
    await expect
      .poll(() => pix.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource))
      .toBe("dark");
    await expect.poll(async () => (await sidebarMaterial()).alpha).toBe(0);
    await expect.poll(async () => (await sidebarMaterial()).backdrop).toBe("none");
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
    const forkPanel = page.getByTestId("session-tree-panel");
    await expect(forkPanel).toBeVisible();
    await forkPanel.locator("button.session-tree-item:not([disabled])").last().click();
    await expect(page.getByTestId("host-status").first()).toContainText("Agent Host ready", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("prompt-input")).toHaveValue("fork base message");
    await sendPrompt(page, "forked base message");
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
            snap.sessionFile === sessionFile || snap.sessionId === sessionId || snap.cwd === cwd
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
    await expect(page.getByTestId("trust-chip")).toContainText(/trusted|untrusted|已信任|未信任/i, {
      timeout: 15_000,
    });
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

    await page.getByTestId("settings-nav-usage").click();
    await expect(page.getByTestId("settings-usage")).toBeVisible();
    await expect(page.getByTestId("usage-limits-list")).toBeVisible();
    await expect(page.getByTestId("usage-card-zai")).toContainText("GLM Coding Max");
    await expect(page.getByTestId("usage-limit-zai-0")).toContainText(/26%|74%/);
    await expect(page.getByTestId("usage-limit-zai-1")).toContainText(/63%|37%/);
    await expect(page.getByTestId("usage-card-pix-fake")).toHaveCount(0);
    await expect(page.getByTestId("settings-usage")).not.toContainText("test-key");
    await expect(page.getByTestId("settings-usage")).not.toContainText(
      /此处展示通过 Auth|Shows Auth\/OAuth plan limits/i,
    );
  });

  test("settings: OAuth login completes in-app and refreshes auth status", async ({
    page,
    pix,
  }) => {
    await pix.app.evaluate(({ shell }) => {
      const state = globalThis as typeof globalThis & { __oauthUrl?: string };
      Object.defineProperty(shell, "openExternal", {
        configurable: true,
        value: async (url: string) => {
          state.__oauthUrl = url;
        },
      });
    });
    await startHost(page);
    await page.getByTestId("nav-settings").click();
    await page.getByTestId("settings-nav-providers").click();
    await page.getByTestId("providers-search").fill("openai-codex");

    const row = page.getByTestId("provider-row-openai-codex");
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByTestId("provider-oauth-openai-codex").click();

    const dialog = page.getByTestId("provider-oauth-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Device code login" }).click();
    await expect(page.getByTestId("provider-oauth-device-code")).toContainText("PIX-E2E");
    await expect
      .poll(() =>
        pix.app.evaluate(
          () => (globalThis as typeof globalThis & { __oauthUrl?: string }).__oauthUrl,
        ),
      )
      .toBe("https://example.com/device");

    await page.getByTestId("provider-oauth-input").fill("complete");
    await page.getByTestId("provider-oauth-continue").click();
    await expect(page.getByTestId("provider-oauth-complete")).toBeVisible();
    await dialog
      .getByRole("button", { name: /Close|关闭/ })
      .last()
      .click();

    await expect(row).toContainText(/OAuth 已登录|Signed in with OAuth/);
    await expect(row.getByTestId("provider-oauth-openai-codex")).toContainText(
      /重新登录|Sign in again/,
    );
    await expect(row).not.toContainText(/access.?token|refresh.?token/i);
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
    const shortcutRow = page.getByTestId("shortcut-row-new-thread");
    const shortcutInput = page.getByTestId("shortcut-bind-new-thread");
    const shortcutReset = page.getByTestId("shortcut-reset-new-thread");
    const shortcutClear = page.getByTestId("shortcut-clear-new-thread");
    await expect(shortcutInput).toBeVisible();
    await expect(shortcutReset).toBeDisabled();
    await expect(shortcutClear).toBeEnabled();
    await expect(shortcutReset.locator("svg")).toHaveCount(1);
    await expect(shortcutClear.locator("svg")).toHaveCount(1);
    await expect(shortcutRow.locator("button")).toHaveCount(3);
    expect(
      await shortcutRow
        .locator("button")
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-testid"))),
    ).toEqual([
      "shortcut-bind-new-thread",
      "shortcut-reset-new-thread",
      "shortcut-clear-new-thread",
    ]);

    await shortcutInput.click();
    await page.keyboard.press("Meta+Shift+N");
    await expect(shortcutReset).toBeEnabled();
    await shortcutClear.click();
    await expect(shortcutClear).toBeDisabled();
    await expect(shortcutReset).toBeEnabled();
    await shortcutReset.click();
    await expect(shortcutReset).toBeDisabled();
    await expect(shortcutClear).toBeEnabled();

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
      // Composer matches thread content width (min 760 / 100%); dock stays in padded content.
      expect(dock!.x).toBeGreaterThanOrEqual(main!.x - 2);
      expect(dock!.x + dock!.width).toBeLessThanOrEqual(main!.x + main!.width + 2);
      if (opts?.collapsed) {
        const sidebar = await page.getByTestId("sidebar").boundingBox();
        const sidebarWidth = sidebar?.width ?? 0;
        expect(sidebarWidth).toBeLessThan(4);
        expect(Number(await page.getByTestId("shell-main").getAttribute("data-rail-width"))).toBe(
          0,
        );
      } else {
        const sidebar = await page.getByTestId("sidebar").boundingBox();
        expect(sidebar).toBeTruthy();
        expect(sidebar!.width).toBeGreaterThan(200);
        // Content (composer) starts after the rail overlay.
        expect(dock!.x).toBeGreaterThanOrEqual(sidebar!.x + sidebar!.width - 4);
        const railAttr = Number(
          await page.getByTestId("shell-main").getAttribute("data-rail-width"),
        );
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
    await page
      .getByTestId("settings-back")
      .or(page.getByRole("button", { name: /Back|返回/i }))
      .first()
      .click()
      .catch(async () => {
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
      await localeSelect.click();
      await page.getByRole("option", { name: "English" }).click();
    }
    await page.getByTestId("settings-nav-appearance").click();
    await expect(page.getByTestId("settings-appearance")).toBeVisible();
    await expect(page.getByTestId("appearance-translucent")).toHaveAttribute("data-on", "true");
    await expect(page.getByTestId("settings-back")).toContainText(/Back to app|返回应用/);
    await page.getByTestId("settings-back").click();
    await expect(page.getByTestId("composer-dock")).toBeVisible();
  });

  test("overlay scrollbar highlights, stays visible on hover, and follows dragging", async ({
    page,
  }) => {
    // Keep geometry assertions independent of Electron's throttled animation clock.
    await page.addStyleTag({
      content: ".pix-scroll-thumb::before { transition: none !important; }",
    });
    const scrollId = await page.evaluate(() => {
      const host = document.createElement("div");
      host.className = "pix-scroll";
      host.dataset.testid = "overlay-scroll-probe";
      Object.assign(host.style, {
        position: "fixed",
        top: "80px",
        left: "400px",
        width: "220px",
        height: "240px",
        zIndex: "9000",
      });
      const content = document.createElement("div");
      content.style.height = "1200px";
      host.appendChild(content);
      document.body.appendChild(host);
      host.scrollTop = 160;
      host.dispatchEvent(new Event("scroll", { bubbles: true }));
      return host.dataset.pixScrollId;
    });
    expect(scrollId).toBeTruthy();

    const host = page.getByTestId("overlay-scroll-probe");
    const thumb = page.locator(`.pix-scroll-thumb[data-for="${scrollId}"]`);
    await expect(thumb).toHaveAttribute("data-visible", "true");
    await expect
      .poll(() => thumb.evaluate((el) => getComputedStyle(el, "::before").width))
      .toBe("6px");

    await thumb.hover();
    await expect(thumb).toHaveAttribute("data-hovered", "true");
    await expect
      .poll(() => thumb.evaluate((el) => getComputedStyle(el, "::before").width))
      .toBe("8px");
    await page.waitForTimeout(1_100);
    await expect(thumb).toHaveAttribute("data-visible", "true");

    const before = await host.evaluate((el) => el.scrollTop);
    const box = await thumb.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + 80, {
      steps: 4,
    });
    await expect.poll(() => host.evaluate((el) => el.scrollTop)).toBeGreaterThan(before + 200);
    await page.mouse.up();

    await page.mouse.move(20, 20);
    await expect(thumb).toHaveAttribute("data-visible", "false", { timeout: 2_000 });
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
