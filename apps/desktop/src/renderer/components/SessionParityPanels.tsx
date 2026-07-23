/**
 * Session tree + session info surfaces (pi parity).
 * List is flat (no tree indentation/connectors) — order is still branch walk order.
 */
import type {
  SessionInfoView,
  SessionTreeNodeView,
  SessionTreeRoleKind,
  SessionTreeView,
} from "@pix/contracts";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Bot, GitBranch, Minimize2, Settings2, Tag, User, Wrench } from "lucide-react";
import { t, type Locale, type MessageKey } from "../lib/i18n.ts";
import { cn } from "../lib/utils.ts";

function roleLabel(locale: Locale, kind: SessionTreeRoleKind | undefined): string {
  const key: MessageKey =
    kind === "user"
      ? "sessionTree.role.user"
      : kind === "assistant"
        ? "sessionTree.role.assistant"
        : kind === "tool"
          ? "sessionTree.role.tool"
          : kind === "compaction"
            ? "sessionTree.role.compaction"
            : kind === "branch_summary"
              ? "sessionTree.role.branch"
              : kind === "system"
                ? "sessionTree.role.system"
                : "sessionTree.role.other";
  return t(locale, key);
}

function roleIcon(kind: SessionTreeRoleKind | undefined): ReactNode {
  const props = { className: "size-3 shrink-0", strokeWidth: 2.25 } as const;
  switch (kind) {
    case "user":
      return <User {...props} />;
    case "assistant":
      return <Bot {...props} />;
    case "tool":
      return <Wrench {...props} />;
    case "compaction":
      return <Minimize2 {...props} />;
    case "branch_summary":
      return <GitBranch {...props} />;
    case "system":
      return <Settings2 {...props} />;
    default:
      return <Tag {...props} />;
  }
}

export function SessionTreePanel(props: {
  open: boolean;
  locale: Locale;
  tree: SessionTreeView | undefined;
  loading?: boolean | undefined;
  error?: string | undefined;
  mode?: "navigate" | "fork";
  onClose: () => void;
  onNavigate: (
    node: SessionTreeNodeView,
    options?: { summarize?: boolean; customInstructions?: string },
  ) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}) {
  const [summaryMode, setSummaryMode] = useState<"none" | "auto" | "custom">("none");
  const [customInstructions, setCustomInstructions] = useState("");
  if (!props.open) return null;
  const tr = (key: MessageKey, vars?: Record<string, string>) => t(props.locale, key, vars);
  const forkMode = props.mode === "fork";
  const fileLabel = props.tree?.sessionFile
    ? props.tree.sessionFile.split(/[/\\]/).pop() || props.tree.sessionFile
    : props.tree?.sessionId?.slice(0, 8);

  return (
    <div
      className="palette-backdrop !items-center !pt-0"
      data-testid="session-tree-panel"
      onClick={props.onClose}
    >
      <div
        className="palette-panel session-tree-panel"
        role="dialog"
        aria-modal="true"
        aria-label={tr(forkMode ? "sessionTree.forkTitle" : "sessionTree.title")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="session-tree-header">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold tracking-tight">
              {tr(forkMode ? "sessionTree.forkTitle" : "sessionTree.title")}
            </div>
            <div
              className="mt-0.5 truncate text-[11px] text-[var(--text-subtle)]"
              title={props.tree?.sessionFile ?? props.tree?.sessionId}
            >
              {fileLabel ?? "—"}
              {props.tree
                ? ` · ${tr("sessionTree.nodes", { count: String(props.tree.nodes.length) })}`
                : ""}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="settings-pill-btn"
              onClick={() => void props.onRefresh()}
            >
              {tr("sessionTree.refresh")}
            </button>
            <button type="button" className="settings-pill-btn" onClick={props.onClose}>
              {tr("sessionTree.close")}
            </button>
          </div>
        </div>

        {props.error ? (
          <div className="px-4 py-2 text-sm text-red-500" data-testid="session-tree-error">
            {props.error}
          </div>
        ) : null}

        <div className="px-4 py-2 text-xs text-[var(--text-subtle)]">
          {tr(forkMode ? "sessionTree.forkHint" : "sessionTree.hint")}
        </div>

        {!forkMode ? (
          <div className="flex flex-col gap-2 border-y border-[var(--border-subtle)] px-4 py-2">
            <label className="flex items-center justify-between gap-3 text-xs">
              <span>{tr("sessionTree.summary")}</span>
              <select
                className="palette-input max-w-[240px] py-1"
                value={summaryMode}
                onChange={(event) =>
                  setSummaryMode(event.target.value as "none" | "auto" | "custom")
                }
              >
                <option value="none">{tr("sessionTree.summary.none")}</option>
                <option value="auto">{tr("sessionTree.summary.auto")}</option>
                <option value="custom">{tr("sessionTree.summary.custom")}</option>
              </select>
            </label>
            {summaryMode === "custom" ? (
              <input
                className="palette-input py-1"
                value={customInstructions}
                onChange={(event) => setCustomInstructions(event.target.value)}
                placeholder={tr("sessionTree.summary.placeholder")}
              />
            ) : null}
          </div>
        ) : null}

        <ul className="session-tree-list" data-testid="session-tree-list">
          {props.loading ? (
            <li className="session-tree-empty">{tr("sessionTree.loading")}</li>
          ) : !props.tree || props.tree.nodes.length === 0 ? (
            <li className="session-tree-empty">{tr("sessionTree.empty")}</li>
          ) : (
            props.tree.nodes.map((node) => {
              const kind = node.roleKind ?? "other";
              const roleText = roleLabel(props.locale, kind);
              const customLabel = node.label?.trim();
              const fullText = (node.preview || node.id).trim();
              return (
                <li key={node.id}>
                  <button
                    type="button"
                    className={cn(
                      "session-tree-item",
                      node.active && "session-tree-item-active",
                      node.onActivePath && !node.active && "session-tree-item-path",
                    )}
                    data-testid={`session-tree-node-${node.id}`}
                    data-active={node.active ? "true" : "false"}
                    data-role={kind}
                    disabled={forkMode && kind !== "user"}
                    onClick={() =>
                      void props.onNavigate(
                        node,
                        forkMode
                          ? undefined
                          : summaryMode === "none"
                            ? { summarize: false }
                            : summaryMode === "auto"
                              ? { summarize: true }
                              : {
                                  summarize: true,
                                  customInstructions: customInstructions.trim(),
                                },
                      )
                    }
                    // Native tooltip: full message when the row is ellipsized.
                    title={fullText}
                  >
                    <span
                      className={cn("session-tree-badge", `session-tree-badge-${kind}`)}
                      aria-label={roleText}
                    >
                      {roleIcon(kind)}
                      <span className="session-tree-badge-text">{roleText}</span>
                    </span>
                    {customLabel ? (
                      <span
                        className="session-tree-user-label"
                        title={tr("sessionTree.userLabel", { name: customLabel })}
                      >
                        <Tag className="size-3 shrink-0" strokeWidth={2.25} />
                        <span className="session-tree-user-label-text">{customLabel}</span>
                      </span>
                    ) : null}
                    <span className="session-tree-preview">{fullText || node.id.slice(0, 8)}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}

export function SessionInfoPanel(props: {
  open: boolean;
  locale: Locale;
  info: SessionInfoView | undefined;
  loading?: boolean | undefined;
  error?: string | undefined;
  onClose: () => void;
  onRefresh: () => void | Promise<void>;
  onRename: (name: string) => void | Promise<void>;
  onExport: (format: "html" | "jsonl") => void | Promise<void>;
  onShare?: () => void | Promise<void>;
  onClone: () => void | Promise<void>;
  onCompact: () => void | Promise<void>;
}) {
  const [name, setName] = useState(props.info?.sessionName ?? "");
  useEffect(() => {
    setName(props.info?.sessionName ?? "");
  }, [props.info?.sessionName, props.open]);

  if (!props.open) return null;
  const tr = (key: MessageKey, vars?: Record<string, string>) => t(props.locale, key, vars);
  const tokens = props.info?.tokens;
  return (
    <div className="palette-backdrop" data-testid="session-info-panel" onClick={props.onClose}>
      <div
        className="palette-panel"
        role="dialog"
        aria-modal="true"
        aria-label={tr("sessionInfo.title")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-3 pt-3">
          <div className="text-sm font-medium">{tr("sessionInfo.title")}</div>
          <button type="button" className="settings-pill-btn" onClick={props.onClose}>
            {tr("sessionInfo.close")}
          </button>
        </div>
        {props.error ? (
          <div className="px-3 py-2 text-sm text-red-500">{props.error}</div>
        ) : props.loading || !props.info ? (
          <div className="px-3 py-4 text-sm opacity-60">{tr("sessionInfo.loading")}</div>
        ) : (
          <div className="px-3 py-3 space-y-3 text-sm" data-testid="session-info-body">
            <div>
              <div className="opacity-60 text-xs">{tr("sessionInfo.path")}</div>
              <div className="break-all" data-testid="session-info-path">
                {props.info.path ?? props.info.sessionFile ?? "—"}
              </div>
            </div>
            <div>
              <div className="opacity-60 text-xs">{tr("sessionInfo.id")}</div>
              <div data-testid="session-info-id">{props.info.sessionId}</div>
            </div>
            <div>
              <div className="opacity-60 text-xs">{tr("sessionInfo.name")}</div>
              <div className="mt-1 flex gap-2">
                <input
                  className="palette-input flex-1"
                  data-testid="session-info-name-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={tr("sessionInfo.namePlaceholder")}
                />
                <button
                  type="button"
                  className="settings-pill-btn"
                  data-testid="session-info-name-save"
                  onClick={() => void props.onRename(name.trim())}
                >
                  {tr("sessionInfo.save")}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="opacity-60 text-xs">{tr("sessionInfo.messages")}</div>
                <div data-testid="session-info-messages">{props.info.messageCount}</div>
              </div>
              <div>
                <div className="opacity-60 text-xs">{tr("sessionInfo.cost")}</div>
                <div data-testid="session-info-cost">{props.info.cost.toFixed(4)}</div>
              </div>
              <div>
                <div className="opacity-60 text-xs">{tr("sessionInfo.tokens")}</div>
                <div data-testid="session-info-tokens">{tokens?.total ?? 0}</div>
              </div>
              <div>
                <div className="opacity-60 text-xs">{tr("sessionInfo.context")}</div>
                <div data-testid="session-info-context">
                  {props.info.context?.percent != null
                    ? `${Math.round(props.info.context.percent)}%`
                    : "—"}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {props.onShare ? (
                <button
                  type="button"
                  className="settings-pill-btn"
                  data-testid="session-info-share"
                  onClick={() => void props.onShare?.()}
                >
                  {tr("sessionInfo.share")}
                </button>
              ) : null}
              <button
                type="button"
                className="settings-pill-btn"
                data-testid="session-info-export-jsonl"
                onClick={() => void props.onExport("jsonl")}
              >
                {tr("sessionInfo.exportJsonl")}
              </button>
              <button
                type="button"
                className="settings-pill-btn"
                data-testid="session-info-export-html"
                onClick={() => void props.onExport("html")}
              >
                {tr("sessionInfo.exportHtml")}
              </button>
              <button
                type="button"
                className="settings-pill-btn"
                data-testid="session-info-clone"
                onClick={() => void props.onClone()}
              >
                {tr("sessionInfo.clone")}
              </button>
              <button
                type="button"
                className="settings-pill-btn"
                data-testid="session-info-compact"
                onClick={() => void props.onCompact()}
              >
                {tr("sessionInfo.compact")}
              </button>
              <button
                type="button"
                className="settings-pill-btn"
                onClick={() => void props.onRefresh()}
              >
                {tr("sessionInfo.refresh")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
