/**
 * Pix brand mark — white plate + black three-bar π (matches build/icon.svg).
 */
import { cn } from "../lib/utils.ts";

export function PixLogo(props: { className?: string; title?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      fill="none"
      className={cn("size-5 shrink-0", props.className)}
      role="img"
      aria-label={props.title ?? "Pix"}
    >
      <rect width="32" height="32" rx="8" fill="#FFFFFF" />
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="7.5"
        fill="none"
        stroke="#E4E4E7"
        strokeWidth="1"
      />
      <g fill="#0A0A0A">
        <rect x="7.75" y="9.15" width="16.5" height="3.3" rx="1.65" />
        <rect x="9.5" y="10.7" width="3.15" height="12.1" rx="1.575" />
        <rect x="17.1" y="10.7" width="3.15" height="9.6" rx="1.575" />
      </g>
    </svg>
  );
}
