import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { ShellCommand } from "../lib/commands.ts";

export function CommandPalette(props: {
  open: boolean;
  commands: ShellCommand[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return props.commands;
    return props.commands.filter(
      (command) => command.label.toLowerCase().includes(q) || command.id.toLowerCase().includes(q),
    );
  }, [props.commands, query]);

  useEffect(() => {
    if (!props.open) {
      setQuery("");
      setIndex(0);
    }
  }, [props.open]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  if (!props.open) return null;

  async function run(command: ShellCommand) {
    props.onClose();
    await command.run();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndex((current) => Math.min(current + 1, Math.max(filtered.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const selected = filtered[index];
      if (selected) void run(selected);
    }
  }

  return (
    <div className="palette-backdrop" data-testid="command-palette" onClick={props.onClose}>
      <div
        className="palette-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          className="palette-input"
          data-testid="command-palette-input"
          placeholder="Type a command…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul className="palette-list" data-testid="command-palette-list">
          {filtered.length === 0 ? (
            <li className="palette-empty">No matching commands</li>
          ) : (
            filtered.map((command, itemIndex) => (
              <li key={command.id}>
                <button
                  type="button"
                  className="palette-item"
                  data-active={itemIndex === index ? "true" : "false"}
                  data-testid={`command-${command.id}`}
                  onMouseEnter={() => setIndex(itemIndex)}
                  onClick={() => void run(command)}
                >
                  <span>{command.label}</span>
                  {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
