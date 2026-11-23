/**
 * Text and code files are read in the browser and sent to Kimi as plain text inside the
 * message content, wrapped in <file name="…"> blocks. The UI parses them back into chips.
 */

export const MAX_TEXT_FILE_BYTES = 200 * 1024;
export const MAX_TEXT_FILES_PER_MESSAGE = 5;

const LANGUAGE_BY_EXT: Record<string, string> = {
  txt: "text",
  md: "markdown",
  markdown: "markdown",
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  json: "json",
  csv: "csv",
  tsv: "tsv",
  log: "text",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  env: "text",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  xml: "xml",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  vue: "vue",
  svelte: "svelte",
  dockerfile: "dockerfile",
  graphql: "graphql",
  proto: "protobuf",
};

export const TEXT_FILE_EXTENSIONS = Object.keys(LANGUAGE_BY_EXT);
export const TEXT_FILE_ACCEPT = TEXT_FILE_EXTENSIONS.map((e) => `.${e}`).join(",");

export interface TextFile {
  name: string;
  content: string;
}

function extOf(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "dockerfile") return "dockerfile";
  const i = lower.lastIndexOf(".");
  return i >= 0 ? lower.slice(i + 1) : "";
}

export function isTextFileName(name: string): boolean {
  return extOf(name) in LANGUAGE_BY_EXT;
}

export function languageForFile(name: string): string {
  return LANGUAGE_BY_EXT[extOf(name)] ?? "text";
}

function cleanName(name: string): string {
  return name.replace(/["<>\n\r]/g, "_").slice(0, 200) || "file.txt";
}

/** Combines typed text and attached files into the content sent to the model and stored. */
export function buildMessageContent(text: string, files: TextFile[]): string {
  const blocks = files.map(
    (f) => `<file name="${cleanName(f.name)}">\n${f.content.replace(/\n?$/, "")}\n</file>`,
  );
  return [...blocks, text.trim()].filter(Boolean).join("\n\n");
}

const FILE_BLOCK = /<file name="([^"\n]*)">\n([\s\S]*?)\n<\/file>(?:\n\n|\n|$)/g;

/** Splits stored content back into the typed text and the attached files. */
export function splitMessageContent(content: string): { text: string; files: TextFile[] } {
  const files: TextFile[] = [];
  const text = content.replace(FILE_BLOCK, (_m, name: string, body: string) => {
    files.push({ name, content: body });
    return "";
  });
  return { text: text.trim(), files };
}
