/**
 * Settings chrome layout + thin wrappers around default shadcn form controls.
 * Controls intentionally use stock shadcn styling (no custom skins).
 */
import * as React from "react";
import type { ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
  showLabel?: boolean;
  labelVariant?: "default" | "code";
  children: ReactNode;
}) {
  const showLabel = props.showLabel !== false;
  return (
    <section className="settings-section-block" data-testid={props.testId}>
      {showLabel ? (
        <h2
          className={cn(
            "settings-section-label",
            props.labelVariant === "code" && "settings-section-label-code",
          )}
        >
          {props.label}
        </h2>
      ) : null}
      <div className="settings-card">{props.children}</div>
    </section>
  );
}

function hasSettingsDescription(description: ReactNode | undefined): boolean {
  if (description == null || description === false || description === true) return false;
  if (typeof description === "string") return description.trim().length > 0;
  if (typeof description === "number") return true;
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
    <Field
      orientation="horizontal"
      className={cn(
        "settings-row",
        !withDescription && "settings-row-compact",
        props.last && "settings-row-last",
      )}
      data-testid={props.testId}
    >
      <FieldContent className="settings-row-copy min-w-0 flex-1">
        <FieldLabel className="settings-row-title">{props.title}</FieldLabel>
        {withDescription ? (
          <FieldDescription className="settings-row-desc">{props.description}</FieldDescription>
        ) : null}
      </FieldContent>
      <div
        className={cn(
          "settings-row-control shrink-0",
          withDescription && "settings-row-control-multiline",
        )}
      >
        {props.control}
      </div>
    </Field>
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
    <Switch
      checked={props.checked}
      onCheckedChange={props.onChange}
      disabled={props.disabled}
      aria-label={props["aria-label"]}
      data-testid={props.testId}
      data-on={props.checked ? "true" : "false"}
    />
  );
}

export function SettingsSelect(props: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  testId?: string;
  disabled?: boolean;
  /** Layout width only — visual style stays default shadcn Select. */
  size?: "sm" | "md" | "lg" | "default";
  className?: string;
  fullWidth?: boolean;
}) {
  // Radix Select disallows empty string item values.
  const EMPTY = "__pix_settings_empty__";
  const options = props.options.map((opt) => ({
    ...opt,
    value: opt.value === "" ? EMPTY : opt.value,
  }));
  const value = props.value === "" ? EMPTY : props.value;
  const selected = options.find((opt) => opt.value === value);
  const widthClass = props.fullWidth
    ? "w-full min-w-0"
    : props.size === "sm"
      ? "w-28"
      : props.size === "lg"
        ? "w-40"
        : props.size === "md"
          ? "w-36"
          : undefined;
  return (
    <Select
      value={value}
      onValueChange={(next) => props.onChange(next === EMPTY ? "" : next)}
      {...(props.disabled !== undefined ? { disabled: props.disabled } : {})}
    >
      <SelectTrigger
        size="default"
        data-testid={props.testId}
        className={cn(widthClass, props.className)}
      >
        <SelectValue placeholder={selected?.label ?? props.value} />
      </SelectTrigger>
      <SelectContent className="z-[11000]" position="popper" align="end">
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export const SettingsInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input"> & { mono?: boolean }
>(({ className, mono, type = "text", ...props }, ref) => (
  <Input ref={ref} type={type} className={cn(mono && "font-mono", className)} {...props} />
));
SettingsInput.displayName = "SettingsInput";

export const SettingsTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => <Textarea ref={ref} className={cn(className)} {...props} />);
SettingsTextarea.displayName = "SettingsTextarea";

export function SettingsPillButton(props: {
  label: string;
  onClick?: () => void;
  testId?: string;
  disabled?: boolean;
  danger?: boolean;
  type?: "button" | "submit" | "reset";
  className?: string;
}) {
  return (
    <Button
      type={props.type ?? "button"}
      data-testid={props.testId}
      disabled={props.disabled}
      variant={props.danger ? "destructive" : "secondary"}
      size="sm"
      className={props.className}
      onClick={props.onClick}
    >
      {props.label}
    </Button>
  );
}

export function SettingsButton(props: React.ComponentProps<typeof Button> & { testId?: string }) {
  const { testId, className, size = "sm", variant = "secondary", ...rest } = props;
  return (
    <Button
      {...(testId !== undefined ? { "data-testid": testId } : {})}
      size={size}
      variant={variant}
      className={className}
      {...rest}
    />
  );
}

export function SettingsIconButton(
  props: React.ComponentProps<typeof Button> & { testId?: string },
) {
  const { testId, className, size = "icon-sm", variant = "ghost", ...rest } = props;
  return (
    <Button
      {...(testId !== undefined ? { "data-testid": testId } : {})}
      size={size}
      variant={variant}
      className={className}
      {...rest}
    />
  );
}

export function SettingsLink(props: {
  children: ReactNode;
  onClick?: () => void;
  testId?: string;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="link"
      data-testid={props.testId}
      className={cn("h-auto p-0", props.className)}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  );
}

export {
  Button,
  buttonVariants,
  Input,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
};
