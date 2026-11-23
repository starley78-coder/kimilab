export interface CodeBlock {
  language: string;
  code: string;
}

const FENCE = /^```([^\n`]*)\n([\s\S]*?)^```[ \t]*$/gm;

/** Fenced code blocks of a Markdown answer, in order. */
export function extractCodeBlocks(markdown: string): CodeBlock[] {
  const out: CodeBlock[] = [];
  for (const m of markdown.matchAll(FENCE)) {
    const language = (m[1] ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    const code = (m[2] ?? "").replace(/\n$/, "");
    if (code.trim()) out.push({ language, code });
  }
  return out;
}

const EXT_BY_LANGUAGE: Record<string, string> = {
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  javascript: "js",
  js: "js",
  jsx: "jsx",
  python: "py",
  py: "py",
  json: "json",
  bash: "sh",
  sh: "sh",
  shell: "sh",
  zsh: "sh",
  html: "html",
  css: "css",
  scss: "scss",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  markdown: "md",
  md: "md",
  go: "go",
  rust: "rs",
  rs: "rs",
  java: "java",
  kotlin: "kt",
  swift: "swift",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  csharp: "cs",
  cs: "cs",
  ruby: "rb",
  php: "php",
  xml: "xml",
  csv: "csv",
  dockerfile: "Dockerfile",
  vue: "vue",
  svelte: "svelte",
  graphql: "graphql",
  ini: "ini",
};

/** File name for downloading a block, with the extension matching its language. */
export function fileNameForBlock(block: CodeBlock, index: number): string {
  const ext = EXT_BY_LANGUAGE[block.language] ?? "txt";
  if (ext === "Dockerfile") return "Dockerfile";
  return `snippet-${index + 1}.${ext}`;
}
