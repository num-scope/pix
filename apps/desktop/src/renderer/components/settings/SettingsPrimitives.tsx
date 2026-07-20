/**
 * Codex / ChatGPT–aligned settings chrome: section title, cards, rows, toggles.
 */
import type { ReactNode } from "react";
import { cn } from "../../lib/utils.ts";

export function SettingsPageShell(props: {
  title: string;
  testId?: string;
  titleAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="settings-page-shell" data-testid={props.testId}>
      <div className="settings-page-title-row">
        <h1 className="settings-page-title">{props.title}</h1>
        {props.titleAction ? (
          <div className="settings-page-title-action">{props.titleAction}</div>
        ) : null}
      </div>
      <div className="settings-page-sections">{props.children}</div>
    </div>
  );
}

export function SettingsSectionBlock(props: {
  label: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section-block" data-testid={props.testId}>
      <h2 className="settings-section-label">{props.label}</h2>
      <div className="settings-card">{props.children}</div>
    </section>
  );
}

function hasSettingsDescription(description: ReactNode | undefined): boolean {
  if (description == null || description === false || description === true) return false;
  if (typeof description === "string") return description.trim().length > 0;
  if (typeof description === "number") return true;
  // Empty fragments / arrays should not reserve description space.
  if (Array.isArray(description)) return description.some((item) => hasSettingsDescription(item));
  return true;
}

export function SettingsRow(props: {
  title: string;
  description?: ReactNode;
  control: ReactNode;
  testId?: string;
  last?: boolean;
}) {
  const withDescription = hasSettingsDescription(props.description);
  return (
    <div
      className={cn(
        "settings-row",
        !withDescription && "settings-row-compact",
        props.last && "settings-row-last",
      )}
      data-testid={props.testId}
    >
      <div className="settings-row-copy min-w-0 flex-1">
        <div className="settings-row-title">{props.title}</div>
        {withDescription ? <div className="settings-row-desc">{props.description}</div> : null}
      </div>
      <div
        className={cn(
          "settings-row-control shrink-0",
          withDescription && "settings-row-control-multiline",
        )}
      >
        {props.control}
      </div>
    </div>
  );
}

export function SettingsToggle(props: {
  checked: boolean;
  onChange: (next: boolean) => void;
  testId?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props["aria-label"]}
      data-testid={props.testId}
      data-on={props.checked ? "true" : "false"}
      disabled={props.disabled}
      className={cn(
        "settings-toggle",
        props.checked ? "settings-toggle-on" : "settings-toggle-off",
        props.disabled && "opacity-40",
      )}
      onClick={() => {
        if (!props.disabled) props.onChange(!props.checked);
      }}
    >
      <span className="settings-toggle-knob" />
    </button>
  );
}

export function SettingsSelect(props: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <select
      data-testid={props.testId}
      className="settings-select"
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value)}
    >
      {props.options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export function SettingsPillButton(props: {
  label: string;
  onClick?: () => void;
  testId?: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={props.testId}
      disabled={props.disabled}
      className={cn("settings-pill-btn", props.danger && "settings-pill-btn-danger")}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

export function SettingsLink(props: { children: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" className="settings-inline-link" onClick={props.onClick}>
      {props.children}
    </button>
  );
}
