import { useEffect, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ShellCommand } from "../lib/commands.ts";

export function CommandPalette(props: {
  open: boolean;
  commands: ShellCommand[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!props.open) setQuery("");
  }, [props.open]);

  async function run(command: ShellCommand) {
    props.onClose();
    await command.run();
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-w-lg gap-0 overflow-hidden p-0"
        data-testid="command-palette"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Command palette</DialogTitle>
          <DialogDescription>Search and run a command</DialogDescription>
        </DialogHeader>
        <Command shouldFilter className="rounded-none border-0 shadow-none">
          <CommandInput
            autoFocus
            data-testid="command-palette-input"
            placeholder="Type a command…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList data-testid="command-palette-list" className="max-h-[min(360px,50vh)]">
            <CommandEmpty>No matching commands</CommandEmpty>
            <CommandGroup>
              {props.commands.map((command) => (
                <CommandItem
                  key={command.id}
                  value={`${command.label} ${command.id}`}
                  data-testid={`command-${command.id}`}
                  onSelect={() => void run(command)}
                >
                  <span className="min-w-0 flex-1 truncate">{command.label}</span>
                  {command.shortcut ? <CommandShortcut>{command.shortcut}</CommandShortcut> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
