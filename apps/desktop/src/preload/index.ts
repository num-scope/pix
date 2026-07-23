import { contextBridge, ipcRenderer } from "electron";
import type { HostEvent, PixDesktopApi } from "@pix/contracts";

const api: PixDesktopApi = {
  app: {
    getRuntime: () => ipcRenderer.invoke("pix:app:get-runtime"),
  },
  appearance: {
    setThemeSource: (source) => ipcRenderer.invoke("pix:appearance:set-theme-source", source),
  },
  host: {
    start: (options) => ipcRenderer.invoke("pix:host:start", options),
    stop: () => ipcRenderer.invoke("pix:host:stop"),
    snapshot: () => ipcRenderer.invoke("pix:host:snapshot"),
    onEvent(listener) {
      const handler = (_event: Electron.IpcRendererEvent, value: HostEvent) => listener(value);
      ipcRenderer.on("pix:host:event", handler);
      return () => ipcRenderer.removeListener("pix:host:event", handler);
    },
  },
  workspace: {
    getCwd: () => ipcRenderer.invoke("pix:workspace:get-cwd"),
    listRecent: () => ipcRenderer.invoke("pix:workspace:list-recent"),
    openPath: (cwd, options) => ipcRenderer.invoke("pix:workspace:open-path", cwd, options),
    pickFolder: () => ipcRenderer.invoke("pix:workspace:pick-folder"),
    pickAttachments: () => ipcRenderer.invoke("pix:workspace:pick-attachments"),
    searchPaths: (query, options) =>
      ipcRenderer.invoke("pix:workspace:search-paths", query ?? "", options),
    ensureDefault: () => ipcRenderer.invoke("pix:workspace:ensure-default"),
    ensureConversation: () => ipcRenderer.invoke("pix:workspace:ensure-conversation"),
    removeRecent: (cwd) => ipcRenderer.invoke("pix:workspace:remove-recent", cwd),
    revealInFolder: (cwd) => ipcRenderer.invoke("pix:workspace:reveal-in-folder", cwd),
    openFile: (path, location) => ipcRenderer.invoke("pix:workspace:open-file", path, location),
    openExternal: (url) => ipcRenderer.invoke("pix:workspace:open-external", url),
    clearActive: () => ipcRenderer.invoke("pix:workspace:clear-active"),
    getGitContext: (cwd) => ipcRenderer.invoke("pix:workspace:get-git-context", cwd),
    listGitBranches: (cwd) => ipcRenderer.invoke("pix:workspace:list-git-branches", cwd),
    checkoutGitBranch: (branch, cwd) =>
      ipcRenderer.invoke("pix:workspace:checkout-git-branch", branch, cwd),
    createGitBranch: (branch, options) =>
      ipcRenderer.invoke("pix:workspace:create-git-branch", branch, options),
    listGitWorktrees: (cwd) => ipcRenderer.invoke("pix:workspace:list-git-worktrees", cwd),
    createGitWorktree: (options) =>
      ipcRenderer.invoke("pix:workspace:create-git-worktree", options),
    getWorktreePrefs: (cwd) => ipcRenderer.invoke("pix:workspace:get-worktree-prefs", cwd),
    setWorktreePrefs: (patch) => ipcRenderer.invoke("pix:workspace:set-worktree-prefs", patch),
    getGitPrefs: () => ipcRenderer.invoke("pix:workspace:get-git-prefs"),
    setGitPrefs: (patch) => ipcRenderer.invoke("pix:workspace:set-git-prefs", patch),
    gitStatus: (cwd) => ipcRenderer.invoke("pix:workspace:git-status", cwd),
    gitCommit: (message, cwd) => ipcRenderer.invoke("pix:workspace:git-commit", message, cwd),
    gitPull: (cwd) => ipcRenderer.invoke("pix:workspace:git-pull", cwd),
    gitPush: (cwd) => ipcRenderer.invoke("pix:workspace:git-push", cwd),
    gitCommitAndPush: (message, cwd) =>
      ipcRenderer.invoke("pix:workspace:git-commit-and-push", message, cwd),
    gitGenerateCommitMessage: (cwd) =>
      ipcRenderer.invoke("pix:workspace:git-generate-commit-message", cwd),
    openCreatePullRequest: (cwd) => ipcRenderer.invoke("pix:workspace:open-create-pr", cwd),
    listOpenTargets: (cwd) => ipcRenderer.invoke("pix:workspace:list-open-targets", cwd),
    openInApp: (appId, cwd) => ipcRenderer.invoke("pix:workspace:open-in-app", appId, cwd),
  },
  trust: {
    get: () => ipcRenderer.invoke("pix:trust:get"),
    set: (trusted) => ipcRenderer.invoke("pix:trust:set", trusted),
  },
  models: {
    list: () => ipcRenderer.invoke("pix:models:list"),
    set: (provider, id) => ipcRenderer.invoke("pix:models:set", provider, id),
    getConfig: () => ipcRenderer.invoke("pix:models:get-config"),
    upsertCustomProvider: (input) => ipcRenderer.invoke("pix:models:upsert-custom", input),
    removeCustomProvider: (provider) => ipcRenderer.invoke("pix:models:remove-custom", provider),
    openConfig: () => ipcRenderer.invoke("pix:models:open-config"),
    revealConfig: () => ipcRenderer.invoke("pix:models:reveal-config"),
    listScoped: () => ipcRenderer.invoke("pix:models:list-scoped"),
    refreshCatalog: () => ipcRenderer.invoke("pix:models:refresh-catalog"),
  },
  thinking: {
    set: (level) => ipcRenderer.invoke("pix:thinking:set", level),
  },
  providers: {
    list: () => ipcRenderer.invoke("pix:providers:list"),
    usage: () => ipcRenderer.invoke("pix:providers:usage"),
    setApiKey: (provider, apiKey) =>
      ipcRenderer.invoke("pix:providers:set-api-key", provider, apiKey),
    clearAuth: (provider) => ipcRenderer.invoke("pix:providers:clear-auth", provider),
    startOAuth: (provider, operationId) =>
      ipcRenderer.invoke("pix:providers:oauth-start", provider, operationId),
    respondOAuth: (operationId, promptId, value, cancelled) =>
      ipcRenderer.invoke("pix:providers:oauth-respond", operationId, promptId, value, cancelled),
    cancelOAuth: (operationId) => ipcRenderer.invoke("pix:providers:oauth-cancel", operationId),
    onOAuthEvent(listener) {
      const handler = (_event: Electron.IpcRendererEvent, value: HostEvent) => {
        if (value.type !== "providers.oauth") return;
        listener({
          operationId: value.requestId,
          provider: value.provider,
          update: value.update,
        });
      };
      ipcRenderer.on("pix:host:event", handler);
      return () => ipcRenderer.removeListener("pix:host:event", handler);
    },
  },
  settings: {
    get: () => ipcRenderer.invoke("pix:settings:get"),
    patch: (patch) => ipcRenderer.invoke("pix:settings:patch", patch),
  },
  agent: {
    prompt: (message, streamingBehavior) =>
      ipcRenderer.invoke("pix:agent:prompt", message, streamingBehavior),
    clearQueue: () => ipcRenderer.invoke("pix:agent:queue-clear"),
    abort: () => ipcRenderer.invoke("pix:agent:abort"),
  },
  session: {
    list: () => ipcRenderer.invoke("pix:session:list"),
    listForCwd: (cwd) => ipcRenderer.invoke("pix:session:list-for-cwd", cwd),
    create: () => ipcRenderer.invoke("pix:session:new"),
    switch: (sessionPath) => ipcRenderer.invoke("pix:session:switch", sessionPath),
    fork: (entryId) => ipcRenderer.invoke("pix:session:fork", entryId),
    tree: () => ipcRenderer.invoke("pix:session:tree"),
    navigateTree: (targetId, options) =>
      ipcRenderer.invoke("pix:session:navigate-tree", targetId, options),
    compact: (instructions) => ipcRenderer.invoke("pix:session:compact", instructions),
    setName: (name) => ipcRenderer.invoke("pix:session:set-name", name),
    clone: () => ipcRenderer.invoke("pix:session:clone"),
    info: () => ipcRenderer.invoke("pix:session:info"),
    export: (format, outputPath) => ipcRenderer.invoke("pix:session:export", format, outputPath),
    exportPick: (format) => ipcRenderer.invoke("pix:session:export-pick", format),
    import: (inputPath) => ipcRenderer.invoke("pix:session:import", inputPath),
    importPick: () => ipcRenderer.invoke("pix:session:import-pick"),
    bash: (command, options) => ipcRenderer.invoke("pix:session:bash", command, options),
    copyLastAssistant: () => ipcRenderer.invoke("pix:session:copy-last"),
  },
  runtime: {
    reload: () => ipcRenderer.invoke("pix:runtime:reload"),
  },
  packages: {
    list: () => ipcRenderer.invoke("pix:packages:list"),
    install: (source, scope) => ipcRenderer.invoke("pix:packages:install", source, scope),
    remove: (source, scope) => ipcRenderer.invoke("pix:packages:remove", source, scope),
    update: (source) => ipcRenderer.invoke("pix:packages:update", source),
    searchCatalog: (query, size, from) =>
      ipcRenderer.invoke("pix:packages:search-catalog", query, size, from),
  },
  resources: {
    list: () => ipcRenderer.invoke("pix:resources:list"),
  },
  extensionUi: {
    respond: (response) => ipcRenderer.invoke("pix:extension-ui:respond", response),
  },
  test: {
    crashHost: () => ipcRenderer.invoke("pix:test:crash-host"),
  },
  notifications: {
    show: (payload) =>
      ipcRenderer.invoke("pix:notifications:show", {
        title: payload?.title ?? "",
        ...(payload?.body !== undefined ? { body: payload.body } : {}),
        ...(payload?.silent !== undefined ? { silent: payload.silent } : {}),
        ...(payload?.force !== undefined ? { force: payload.force } : {}),
        ...(payload?.requireUnfocused !== undefined
          ? { requireUnfocused: payload.requireUnfocused }
          : {}),
      }),
    openSystemSettings: () => ipcRenderer.invoke("pix:notifications:open-system-settings"),
  },
};

contextBridge.exposeInMainWorld("pix", api);
