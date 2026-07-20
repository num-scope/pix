import * as React from "react";
import { cn } from "../../lib/utils.ts";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        "flex min-h-[44px] w-full resize-none rounded-md border-0 bg-transparent px-3.5 py-2.5 text-[14px]",
        "text-[var(--foreground)] placeholder:text-[var(--text-subtle)]",
        "focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
