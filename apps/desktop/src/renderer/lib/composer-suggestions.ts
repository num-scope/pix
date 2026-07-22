import type { SlashCommandSummary } from "@pix/contracts";

export function slashCommandQuery(value: string): string | undefined {
  const match = /^\/([^\s]*)$/.exec(value);
  return match?.[1];
}

export function addResourceQuery(value: string): string | undefined {
  const match = /^@([^\s]*)$/.exec(value);
  return match?.[1];
}

export function filterSlashCommands(
  commands: SlashCommandSummary[],
  query: string,
  limit = 18,
): SlashCommandSummary[] {
  const needle = query.trim().toLocaleLowerCase();
  return commands
    .filter((command) => {
      if (!needle) return true;
      return (
        command.name.toLocaleLowerCase().includes(needle) ||
        command.description.toLocaleLowerCase().includes(needle)
      );
    })
    .sort((a, b) => {
      const aPrefix = a.name.toLocaleLowerCase().startsWith(needle) ? 0 : 1;
      const bPrefix = b.name.toLocaleLowerCase().startsWith(needle) ? 0 : 1;
      return aPrefix - bPrefix || a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

export function filterResourceCommands(
  commands: SlashCommandSummary[],
  query: string,
  limit = 12,
): SlashCommandSummary[] {
  return filterSlashCommands(
    commands.filter((command) => command.source !== "skill"),
    query,
    limit,
  );
}

export function attachmentLabel(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").pop() || path;
}

export type AttachmentKind =
  | "archive"
  | "code"
  | "document"
  | "file"
  | "folder"
  | "image"
  | "pdf"
  | "presentation"
  | "spreadsheet"
  | "text";

export interface AttachmentPresentation {
  kind: AttachmentKind;
  typeLabel: string;
}

const ATTACHMENT_TYPES: Record<string, AttachmentPresentation> = {
  xls: { kind: "spreadsheet", typeLabel: "Excel" },
  xlsx: { kind: "spreadsheet", typeLabel: "Excel" },
  xlsm: { kind: "spreadsheet", typeLabel: "Excel" },
  csv: { kind: "spreadsheet", typeLabel: "CSV" },
  ods: { kind: "spreadsheet", typeLabel: "Spreadsheet" },
  png: { kind: "image", typeLabel: "PNG" },
  jpg: { kind: "image", typeLabel: "JPEG" },
  jpeg: { kind: "image", typeLabel: "JPEG" },
  gif: { kind: "image", typeLabel: "GIF" },
  webp: { kind: "image", typeLabel: "WebP" },
  svg: { kind: "image", typeLabel: "SVG" },
  bmp: { kind: "image", typeLabel: "Bitmap" },
  tif: { kind: "image", typeLabel: "TIFF" },
  tiff: { kind: "image", typeLabel: "TIFF" },
  heic: { kind: "image", typeLabel: "HEIC" },
  avif: { kind: "image", typeLabel: "AVIF" },
  pdf: { kind: "pdf", typeLabel: "PDF" },
  ppt: { kind: "presentation", typeLabel: "PowerPoint" },
  pptx: { kind: "presentation", typeLabel: "PowerPoint" },
  odp: { kind: "presentation", typeLabel: "Presentation" },
  key: { kind: "presentation", typeLabel: "Keynote" },
  doc: { kind: "document", typeLabel: "Word" },
  docx: { kind: "document", typeLabel: "Word" },
  odt: { kind: "document", typeLabel: "Document" },
  rtf: { kind: "document", typeLabel: "RTF" },
  zip: { kind: "archive", typeLabel: "ZIP" },
  rar: { kind: "archive", typeLabel: "RAR" },
  "7z": { kind: "archive", typeLabel: "7-Zip" },
  tar: { kind: "archive", typeLabel: "TAR" },
  gz: { kind: "archive", typeLabel: "Gzip" },
  tgz: { kind: "archive", typeLabel: "Gzip" },
  bz2: { kind: "archive", typeLabel: "Bzip2" },
  xz: { kind: "archive", typeLabel: "XZ" },
  txt: { kind: "text", typeLabel: "Text" },
  log: { kind: "text", typeLabel: "Log" },
  md: { kind: "text", typeLabel: "Markdown" },
  mdx: { kind: "text", typeLabel: "MDX" },
  markdown: { kind: "text", typeLabel: "Markdown" },
  java: { kind: "code", typeLabel: "Java" },
  js: { kind: "code", typeLabel: "JavaScript" },
  mjs: { kind: "code", typeLabel: "JavaScript" },
  cjs: { kind: "code", typeLabel: "JavaScript" },
  jsx: { kind: "code", typeLabel: "JavaScript" },
  ts: { kind: "code", typeLabel: "TypeScript" },
  tsx: { kind: "code", typeLabel: "TypeScript" },
  py: { kind: "code", typeLabel: "Python" },
  pyw: { kind: "code", typeLabel: "Python" },
  json: { kind: "code", typeLabel: "JSON" },
  html: { kind: "code", typeLabel: "HTML" },
  css: { kind: "code", typeLabel: "CSS" },
  xml: { kind: "code", typeLabel: "XML" },
  yaml: { kind: "code", typeLabel: "YAML" },
  yml: { kind: "code", typeLabel: "YAML" },
};

export function attachmentPresentation(path: string): AttachmentPresentation {
  const name = attachmentLabel(path);
  const extension = /\.([^.]+)$/.exec(name)?.[1]?.toLocaleLowerCase();
  if (!extension) return { kind: "folder", typeLabel: "Folder" };
  return (
    ATTACHMENT_TYPES[extension] ?? {
      kind: "file",
      typeLabel: extension.toLocaleUpperCase(),
    }
  );
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function promptWithAttachedPaths(message: string, paths: string[]): string {
  if (paths.length === 0) return message;
  const rows = paths.map((path) => `  <path>${escapeXml(path)}</path>`).join("\n");
  return `${message}\n\n<attached-paths>\n${rows}\n</attached-paths>`;
}
