#!/usr/bin/env node

import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { exec, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const MarkdownIt = require("markdown-it");
const markdownItDeflist = require("markdown-it-deflist");
const markdownItDiagram = require("markdown-it-diagram");
const hljs = require("highlight.js");
const multimdTable = require("markdown-it-multimd-table");
const { instance: createViz } = require("@viz-js/viz");

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_FILE);
const DOCS_ROOT = path.resolve(SCRIPT_DIR, "..");
const HIGHLIGHT_THEME_FILE = require.resolve("highlight.js/styles/github.css");
const MERMAID_MODULE_FILE = path.join(
  DOCS_ROOT,
  "node_modules",
  "mermaid",
  "dist",
  "mermaid.esm.min.mjs",
);
const MERMAID_DIST_DIR = path.join(DOCS_ROOT, "node_modules", "mermaid", "dist");
const DOT_LANGUAGES = new Set(["dot", "graphviz", "gv"]);
const ANSI = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  dim: "\u001B[2m",
  underline: "\u001B[4m",
  white: "\u001B[37m",
  blue: "\u001B[34m",
  cyan: "\u001B[36m",
  yellow: "\u001B[33m",
};

let vizInstancePromise;
let highlightCssPromise;
let packageVersion;

function usage() {
  return [
    "Usage:",
    "  node 01_docs/scripts/markdown-it-render.mjs serve <input.md> [--port 3030]",
    "  node 01_docs/scripts/markdown-it-render.mjs build <input.md> [output.pdf] [--timeout-ms 30000]",
  ].join("\n");
}

function isDecoratedOutput() {
  return Boolean(process.stdout.isTTY);
}

function styleValue(text, ...styles) {
  if (!isDecoratedOutput()) {
    return text;
  }
  return `${styles.join("")}${text}${ANSI.reset}`;
}

function styleDim(text) {
  return styleValue(text, ANSI.dim);
}

function styleWhite(text) {
  return styleValue(text, ANSI.white);
}

function styleBold(text) {
  return styleValue(text, ANSI.bold);
}

function styleBlue(text) {
  return styleValue(text, ANSI.blue);
}

function styleCyan(text) {
  return styleValue(text, ANSI.cyan);
}

function styleYellow(text) {
  return styleValue(text, ANSI.yellow);
}

function styleUnderlineWhite(text) {
  return styleValue(text, ANSI.white, ANSI.underline);
}

function loadPackageVersion() {
  if (!packageVersion) {
    packageVersion = require(path.join(DOCS_ROOT, "package.json")).version || "0.0.0";
  }
  return packageVersion;
}

function formatLabel(label) {
  return `  ${styleDim(label.padEnd(18))} ${styleWhite(">")}`;
}

function formatLabelValue(label, value) {
  return `${formatLabel(label)} ${value}`;
}

function formatPathValue(filePath) {
  if (!isDecoratedOutput()) {
    return filePath;
  }

  const parsed = path.parse(filePath);
  const directory = parsed.dir ? `${parsed.dir}${path.sep}` : "";
  return `${styleDim(directory)}${styleWhite(parsed.base)}`;
}

function formatShortcutValue(interactive) {
  if (!interactive) {
    return "unavailable (non-tty)";
  }
  if (!isDecoratedOutput()) {
    return "restart | open | edit | quit";
  }

  return [
    styleUnderlineWhite("r"),
    styleDim("estart"),
    styleDim(" | "),
    styleUnderlineWhite("o"),
    styleDim("pen"),
    styleDim(" | "),
    styleUnderlineWhite("e"),
    styleDim("dit"),
    styleDim(" | "),
    styleUnderlineWhite("q"),
    styleDim("uit"),
  ].join("");
}

function printBanner() {
  console.log("");
  console.log(`  ${styleCyan("●")}${styleBlue("■")}${styleYellow("▲")}`);
  console.log(`  ${styleBold("markdown-it-render")}  ${styleBlue(`v${loadPackageVersion()}`)}`);
  console.log("");
}

function printServeSummary({ inputFile, url, interactive }) {
  printBanner();
  console.log(formatLabelValue("entry", formatPathValue(inputFile)));
  console.log("");
  console.log(formatLabelValue("preview", styleCyan(url)));
  console.log(formatLabelValue("shortcuts", formatShortcutValue(interactive)));
  console.log("");
}

function printBuildSummary({ inputFile, outputFile }) {
  printBanner();
  console.log(formatLabelValue("entry", formatPathValue(inputFile)));
  console.log(formatLabelValue("output", formatPathValue(outputFile)));
  console.log("");
}

function resolveInputFile(inputArg) {
  if (!inputArg) {
    throw new Error(usage());
  }
  return path.resolve(process.cwd(), inputArg);
}

function ensureDocsFile(inputFile) {
  const relativePath = path.relative(DOCS_ROOT, inputFile);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Input file must be inside ${DOCS_ROOT}: ${inputFile}`);
  }
}

async function ensureInputFile(inputFile) {
  ensureDocsFile(inputFile);
  if (path.extname(inputFile).toLowerCase() !== ".md") {
    throw new Error(`Input file must be a markdown file: ${inputFile}`);
  }
  try {
    await fsp.access(inputFile);
  } catch {
    throw new Error(`Input file not found: ${inputFile}`);
  }
}

function resolvePdfOutputFile(inputFile, outputArg) {
  if (outputArg) {
    return path.resolve(process.cwd(), outputArg);
  }
  const parsed = path.parse(inputFile);
  return path.join(parsed.dir, `${parsed.name}.pdf`);
}

function parsePort(args) {
  const flagIndex = args.findIndex((arg) => arg === "--port");
  if (flagIndex === -1) {
    return 3030;
  }
  const value = Number.parseInt(args[flagIndex + 1] || "", 10);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error(`Invalid --port value: ${args[flagIndex + 1] || ""}`);
  }
  return value;
}

function parseTimeoutMs(args) {
  const flagIndex = args.findIndex((arg) => arg === "--timeout-ms");
  if (flagIndex === -1) {
    return 0;
  }
  const value = Number.parseInt(args[flagIndex + 1] || "", 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid --timeout-ms value: ${args[flagIndex + 1] || ""}`);
  }
  return value;
}

function stripFlag(args, flagName) {
  const flagIndex = args.findIndex((arg) => arg === flagName);
  if (flagIndex === -1) {
    return [...args];
  }

  const nextArgs = [...args];
  nextArgs.splice(flagIndex, 2);
  return nextArgs;
}

function resetRenderState() {
  vizInstancePromise = undefined;
  highlightCssPromise = undefined;
}

function printServeError(message) {
  console.error("");
  console.error(`  ${message}`);
  console.error("");
}

function formatStackFrameLocation(line) {
  const patterns = [
    /\((file:\/\/[^:]+:\d+:\d+)\)$/,
    /\(([^()]+:\d+:\d+)\)$/,
    /at (file:\/\/[^:]+:\d+:\d+)$/,
    /at ([^()]+:\d+:\d+)$/,
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return "";
}

async function readSourceExcerpt(location) {
  const match = location.match(/^(.*):(\d+):(\d+)$/);
  if (!match) {
    return "";
  }

  let [, filePath, lineText] = match;
  if (filePath.startsWith("file://")) {
    filePath = fileURLToPath(filePath);
  }

  const lineNumber = Number.parseInt(lineText, 10);
  if (!Number.isInteger(lineNumber) || lineNumber < 1) {
    return "";
  }

  try {
    const source = await fsp.readFile(filePath, "utf8");
    const lines = source.split("\n");
    const targetLine = lines[lineNumber - 1];
    if (typeof targetLine !== "string") {
      return "";
    }
    return `  at ${filePath}:${lineNumber}\n  > ${targetLine}`;
  } catch {
    return "";
  }
}

async function formatErrorDetails(error) {
  const message = error?.message || String(error);
  const stack = typeof error?.stack === "string" ? error.stack : "";
  const stackLines = stack ? stack.split("\n").map((line) => line.trimEnd()) : [];
  const firstFrame = stackLines.find((line) => line.trim().startsWith("at "));
  const location = firstFrame ? formatStackFrameLocation(firstFrame.trim()) : "";
  const excerpt = location ? await readSourceExcerpt(location) : "";

  return [message, location ? `  location: ${location}` : "", excerpt]
    .filter(Boolean)
    .join("\n");
}

async function printFatalError(error) {
  const details = await formatErrorDetails(error);
  console.error(`[markdown-it-render] ${details}`);
}

function shellEscape(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function runDetachedShell(command, target) {
  return new Promise((resolve, reject) => {
    const shellCommand = `${command} ${shellEscape(target)}`;
    const child = spawn("/bin/bash", ["-lc", shellCommand], {
      detached: true,
      stdio: "ignore",
    });

    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function execShellCommand(command, target) {
  return new Promise((resolve, reject) => {
    const shellCommand = `${command} ${shellEscape(target)}`;
    const child = exec(shellCommand, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });

    child.once("error", reject);
  });
}

function resolveOpenCommand() {
  return (
    process.env.MARKDOWN_IT_RENDER_OPENER ||
    process.env.BROWSER ||
    "xdg-open"
  );
}

function resolveEditorCommand() {
  return (
    process.env.MARKDOWN_IT_RENDER_EDITOR ||
    process.env.VISUAL ||
    process.env.EDITOR ||
    (process.env.TERM_PROGRAM === "vscode" ? "code" : "") ||
    ""
  );
}

async function openPreview(url) {
  const normalizedUrl = url.replace("127.0.0.1", "localhost");
  await runDetachedShell(resolveOpenCommand(), normalizedUrl);
}

async function openEditor(inputFile) {
  const editorCommand = resolveEditorCommand();
  if (!editorCommand) {
    throw new Error(
      "No editor configured. Set MARKDOWN_IT_RENDER_EDITOR, VISUAL, or EDITOR.",
    );
  }
  await execShellCommand(editorCommand, inputFile);
}

function bindServeShortcuts({ inputFile, url, onQuit }) {
  if (!process.stdin.isTTY) {
    return {
      interactive: false,
      dispose() {},
    };
  }

  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode?.(true);

  let disposed = false;
  let running = Promise.resolve();

  const runShortcut = (action) => {
    running = running
      .catch(() => {})
      .then(action)
      .catch((error) => {
        printServeError(`shortcut failed: ${error.message}`);
      });
  };

  const onKeyPress = (str, key) => {
    if (disposed) {
      return;
    }
    if (key?.ctrl && key.name === "c") {
      runShortcut(onQuit);
      return;
    }

    switch (str) {
      case "r":
        runShortcut(async () => {
          resetRenderState();
          printServeSummary({ inputFile, url, interactive: true });
        });
        break;
      case "o":
        runShortcut(async () => {
          await openPreview(url);
        });
        break;
      case "e":
        runShortcut(async () => {
          await openEditor(inputFile);
        });
        break;
      case "q":
        runShortcut(onQuit);
        break;
      default:
        break;
    }
  };

  process.stdin.on("keypress", onKeyPress);

  return {
    interactive: true,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      process.stdin.off("keypress", onKeyPress);
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
    },
  };
}

function slugifyHeading(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function getFenceLanguage(info) {
  return (info || "").trim().split(/\s+/)[0].toLowerCase();
}

function highlightCode(code, language) {
  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  }
  if (language === "dotenv") {
    return hljs.highlight(code, { language: "ini", ignoreIllegals: true }).value;
  }
  return escapeHtml(code);
}

function renderCodeBlock(code, language) {
  const languageLabel = language || "text";
  const highlighted = highlightCode(code, language);
  const languageClass = language ? ` language-${escapeAttribute(language)}` : "";
  return `<div class="code-block" data-language="${escapeAttribute(languageLabel)}">
  <div class="code-block__header">
    <span class="code-block__label">${escapeHtml(languageLabel)}</span>
    <button class="action-button code-block__action" type="button" data-copy-code>Copy</button>
  </div>
  <pre><code class="hljs${languageClass}">${highlighted}</code></pre>
  <template class="code-block__source">${escapeHtml(code)}</template>
</div>\n`;
}

function renderDiagramShell(innerHtml, kind) {
  return `<div class="diagram-shell" data-diagram-kind="${escapeAttribute(kind)}">
  <div class="diagram-actions">
    <button class="action-button diagram-action" type="button" data-save-svg>Save SVG</button>
  </div>
  ${innerHtml}
</div>`;
}

function getVizInstance() {
  if (!vizInstancePromise) {
    vizInstancePromise = createViz();
  }
  return vizInstancePromise;
}

async function renderDotToSvg(source) {
  const viz = await getVizInstance();
  const svg = await viz.renderString(source, {
    format: "svg",
    engine: "dot",
  });
  return svg
    .replace(/^<\?xml[\s\S]*?\?>\s*/i, "")
    .replace(/<!DOCTYPE[\s\S]*?>\s*/i, "")
    .trim();
}

function createMarkdownIt() {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
  });

  md.use(multimdTable, {
    multiline: true,
    rowspan: true,
    headerless: true,
  });

  md.use(markdownItDeflist);

  md.use(markdownItDiagram, {
    showController: false,
    imageFormat: "svg",
  });

  const seenIds = new Map();
  const diagramFence = md.renderer.rules.fence
    ? md.renderer.rules.fence.bind(md.renderer.rules)
    : null;
  const defaultLinkOpen =
    md.renderer.rules.link_open ??
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const inlineToken = tokens[idx + 1];
    const text = inlineToken?.type === "inline" ? inlineToken.content : "";
    let slug = slugifyHeading(text) || `section-${idx}`;
    const count = seenIds.get(slug) ?? 0;
    seenIds.set(slug, count + 1);
    if (count > 0) {
      slug = `${slug}-${count + 1}`;
    }
    token.attrSet("id", slug);
    return self.renderToken(tokens, idx, options);
  };

  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const href = token.attrGet("href") || "";
    if (/^https?:\/\//i.test(href)) {
      token.attrSet("target", "_blank");
      token.attrSet("rel", "noreferrer noopener");
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  md.renderer.rules.table_open = () => '<div class="table-scroll">\n<table>\n';
  md.renderer.rules.table_close = () => "</table>\n</div>\n";

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const language = getFenceLanguage(token.info);
    if (DOT_LANGUAGES.has(language) && token.meta?.renderedHtml) {
      return `${token.meta.renderedHtml}\n`;
    }
    if (language === "mermaid" && diagramFence) {
      return `${renderDiagramShell(diagramFence(tokens, idx, options, env, self), "mermaid")}\n`;
    }
    return renderCodeBlock(token.content, language);
  };

  return md;
}

async function preprocessFenceTokens(tokens) {
  for (const token of tokens) {
    if (token.type === "fence") {
      const language = getFenceLanguage(token.info);
      if (DOT_LANGUAGES.has(language)) {
        try {
          const svg = await renderDotToSvg(token.content);
          token.meta = {
            ...(token.meta || {}),
            renderedHtml: renderDiagramShell(
              `<figure class="diagram diagram-dot">${svg}</figure>`,
              "dot",
            ),
          };
        } catch (error) {
          token.meta = {
            ...(token.meta || {}),
            renderedHtml: `<pre class="diagram diagram-error">${escapeHtml(token.content)}\n\n[dot render error] ${escapeHtml(error.message)}</pre>`,
          };
        }
      }
    }

    if (Array.isArray(token.children) && token.children.length > 0) {
      await preprocessFenceTokens(token.children);
    }
  }
}

async function renderMarkdown(markdown) {
  const md = createMarkdownIt();
  const env = {};
  const tokens = md.parse(markdown, env);
  await preprocessFenceTokens(tokens);
  return md.renderer.render(tokens, md.options, env);
}

async function loadHighlightCss() {
  if (!highlightCssPromise) {
    highlightCssPromise = fsp.readFile(HIGHLIGHT_THEME_FILE, "utf8");
  }
  return highlightCssPromise;
}

function buildFontCss(embedFonts) {
  if (!embedFonts) {
    return "";
  }
  return `
      @font-face {
        font-family: "Docs Latin";
        src: url("/fonts/SegoeUI.ttf") format("truetype");
        font-weight: 400;
        font-style: normal;
        font-display: swap;
      }

      @font-face {
        font-family: "Docs Latin";
        src: url("/fonts/SegoeUI-Bold.ttf") format("truetype");
        font-weight: 700;
        font-style: normal;
        font-display: swap;
      }

      @font-face {
        font-family: "Docs Sans JP";
        src: url("/fonts/YuGothicUI-Regular.ttf") format("truetype");
        font-weight: 400;
        font-style: normal;
        font-display: swap;
      }

      @font-face {
        font-family: "Docs Sans JP";
        src: url("/fonts/YuGothicUI-Bold.ttf") format("truetype");
        font-weight: 700;
        font-style: normal;
        font-display: swap;
      }

      @font-face {
        font-family: "Docs Mono";
        src: url("/fonts/PlemolJPConsole-Regular.ttf") format("truetype");
        font-weight: 400;
        font-style: normal;
        font-display: swap;
      }

      @font-face {
        font-family: "Docs Mono";
        src: url("/fonts/PlemolJPConsole-Bold.ttf") format("truetype");
        font-weight: 700;
        font-style: normal;
        font-display: swap;
      }
`;
}

function createHtmlDocument({ title, body, highlightCss, embedFonts }) {
  const fontCss = buildFontCss(embedFonts);
  const fontFamily = embedFonts
    ? '"Docs Latin", "Docs Sans JP", "Segoe UI", "Yu Gothic UI", system-ui, sans-serif'
    : '"Segoe UI", "Yu Gothic UI", system-ui, sans-serif';
  const monoFontFamily = embedFonts
    ? '"Docs Mono", Consolas, ui-monospace, monospace'
    : 'Consolas, ui-monospace, monospace';

  return `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeAttribute(title)}</title>
    <style>
${fontCss}
${highlightCss}
      :root {
        color-scheme: light;
        --fg: #24292f;
        --muted: #57606a;
        --border: #d0d7de;
        --bg: #ffffff;
        --code-bg: #f6f8fa;
        --code-header-bg: #eef2f6;
        --quote-bg: #f6f8fa;
        --link: #0969da;
      }

      * {
        box-sizing: border-box;
      }

      html {
        scroll-behavior: smooth;
      }

      body {
        margin: 0;
        color: var(--fg);
        background:
          radial-gradient(circle at top, #f4f8ff 0, #ffffff 28rem),
          var(--bg);
        line-height: 1.7;
        font-family: ${fontFamily};
        font-synthesis: none;
      }

      main {
        max-width: 980px;
        margin: 0 auto;
        padding: 40px 24px 80px;
      }

      h1, h2, h3, h4, h5, h6 {
        line-height: 1.25;
        margin-top: 1.8em;
        margin-bottom: 0.7em;
        scroll-margin-top: 24px;
      }

      h1 {
        font-size: 2.1rem;
        border-bottom: 1px solid var(--border);
        padding-bottom: 0.3em;
      }

      h2 {
        font-size: 1.6rem;
        border-bottom: 1px solid var(--border);
        padding-bottom: 0.25em;
      }

      p, ul, ol, blockquote, pre, table, .table-scroll, .code-block, .diagram {
        margin-top: 0;
        margin-bottom: 1rem;
      }

      dl {
        margin-top: 0;
        margin-bottom: 1rem;
      }

      dt {
        font-weight: 700;
        margin-top: 1rem;
      }

      dd {
        margin: 0.35rem 0 0.9rem 1.5rem;
      }

      a {
        color: var(--link);
      }

      code {
        font-family: ${monoFontFamily};
        background: var(--code-bg);
        padding: 0.15em 0.35em;
        border-radius: 6px;
        font-size: 0.92em;
      }

      pre {
        background: var(--code-bg);
        padding: 1rem;
        border-radius: 8px;
        overflow-x: auto;
        border: 1px solid var(--border);
      }

      pre code {
        background: transparent;
        padding: 0;
        border-radius: 0;
      }

      .code-block {
        border: 1px solid var(--border);
        border-radius: 10px;
        overflow: hidden;
        background: var(--code-bg);
      }

      .code-block pre {
        margin: 0;
        border: 0;
        border-radius: 0;
      }

      .code-block__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        min-height: 2.25rem;
        padding: 0.45rem 0.8rem;
        background: var(--code-header-bg);
        border-bottom: 1px solid var(--border);
        color: var(--muted);
        font-family: ${monoFontFamily};
        font-size: 0.85rem;
        text-transform: lowercase;
      }

      .code-block__label {
        min-width: 0;
        font-weight: 700;
      }

      .action-button {
        appearance: none;
        border: 1px solid var(--border);
        background: #fff;
        color: var(--muted);
        border-radius: 999px;
        padding: 0.28rem 0.7rem;
        font: inherit;
        line-height: 1.2;
        cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
      }

      .action-button:hover {
        background: #f6f8fa;
        color: var(--fg);
      }

      .action-button:focus-visible {
        outline: 2px solid #0969da;
        outline-offset: 2px;
      }

      .hljs {
        background: transparent !important;
      }

      blockquote {
        margin-left: 0;
        padding: 0.75rem 1rem;
        color: var(--muted);
        background: var(--quote-bg);
        border-left: 4px solid var(--border);
      }

      .table-scroll {
        overflow-x: auto;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th, td {
        border: 1px solid var(--border);
        padding: 0.55rem 0.8rem;
        vertical-align: top;
      }

      th {
        background: #f6f8fa;
        text-align: left;
      }

      img, svg {
        max-width: 100%;
      }

      svg text,
      svg foreignObject,
      svg foreignObject div {
        font-family: ${fontFamily};
      }

      .diagram {
        overflow-x: auto;
      }

      .diagram svg {
        display: block;
        max-width: 100%;
        height: auto;
      }

      .diagram-dot,
      .diagram-m {
        padding: 1rem;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: #fff;
      }

      .diagram-shell {
        margin-bottom: 1rem;
      }

      .diagram-actions {
        display: flex;
        justify-content: flex-end;
        margin-bottom: 0.45rem;
      }

      .diagram-error {
        border-color: #cf222e;
        color: #cf222e;
        white-space: pre-wrap;
      }

      @page {
        size: A3;
        margin: 10mm;
      }

      @media print {
        body {
          background: #fff;
        }

        main {
          max-width: none;
          padding: 0;
        }

        .action-button,
        .diagram-actions {
          display: none !important;
        }
      }
    </style>
    <script type="module">
      import mermaid from "/vendor/mermaid.esm.min.mjs";

      window.__markdownItRenderReady__ = false;

      function setActionState(button, label) {
        if (button) {
          button.textContent = label;
        }
      }

      function legacyCopy(text) {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "absolute";
        textarea.style.opacity = "0";
        textarea.setAttribute("readonly", "");
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        return copied;
      }

      async function writeClipboardText(text) {
        let useLegacy = !(navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext);
        if (!useLegacy) {
          try {
            await navigator.clipboard.writeText(text);
            return true;
          } catch {
            useLegacy = true;
          }
        }
        return useLegacy ? legacyCopy(text) : false;
      }

      function attachCodeActions() {
        for (const block of document.querySelectorAll(".code-block")) {
          const button = block.querySelector("[data-copy-code]");
          const source = block.querySelector(".code-block__source");
          const code = block.querySelector("code");
          if (!button || !source || button.dataset.bound === "true") {
            continue;
          }
          button.dataset.bound = "true";
          button.addEventListener("click", async () => {
            try {
              const text = code?.textContent ?? source.textContent ?? "";
              const copied = await writeClipboardText(text);
              if (!copied) {
                throw new Error("Copy command was rejected.");
              }
              setActionState(button, "Copied");
              window.setTimeout(() => setActionState(button, "Copy"), 1500);
            } catch (error) {
              setActionState(button, "Failed");
              window.setTimeout(() => setActionState(button, "Copy"), 1500);
            }
          });
        }
      }

      function buildDiagramFilename(container, index) {
        const title = (document.title || "diagram")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9._-]+/g, "-");
        const kind = container.dataset.diagramKind || "diagram";
        const sequence = String(index + 1).padStart(2, "0");
        return (title || "diagram") + "-" + kind + "-" + sequence + ".svg";
      }

      function attachDiagramActions() {
        const containers = Array.from(document.querySelectorAll(".diagram-shell"));
        containers.forEach((container, index) => {
          const button = container.querySelector("[data-save-svg]");
          if (!button || button.dataset.bound === "true") {
            return;
          }
          button.dataset.bound = "true";
          button.addEventListener("click", () => {
            const svg = container.querySelector("svg");
            if (!svg) {
              setActionState(button, "No SVG");
              window.setTimeout(() => setActionState(button, "Save SVG"), 1500);
              return;
            }

            const blob = new Blob([svg.outerHTML], {
              type: "image/svg+xml;charset=utf-8",
            });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = buildDiagramFilename(container, index);
            document.body.append(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            setActionState(button, "Saved");
            window.setTimeout(() => setActionState(button, "Save SVG"), 1500);
          });
        });
      }

      async function main() {
        mermaid.initialize({
          startOnLoad: false,
          theme: "default",
          securityLevel: "loose",
          fontFamily: ${JSON.stringify(fontFamily.replaceAll('"', ""))},
        });

        const nodes = Array.from(document.querySelectorAll(".mermaid"));
        if (nodes.length > 0) {
          await mermaid.run({ nodes });
        }

        attachCodeActions();
        attachDiagramActions();

        window.__markdownItRenderReady__ = true;
        document.documentElement.dataset.renderReady = "true";
      }

      main().catch((error) => {
        console.error("[markdown-it-render] preview failed", error);
        window.__markdownItRenderError__ = {
          message: error?.message || String(error),
          stack: error?.stack || "",
        };
        window.__markdownItRenderReady__ = "error";
        document.documentElement.dataset.renderReady = "error";
      });
    </script>
  </head>
  <body>
    <main class="markdown-body">
${body}
    </main>
  </body>
</html>
`;
}

async function renderHtml(inputFile, { embedFonts = false } = {}) {
  const markdown = await fsp.readFile(inputFile, "utf8");
  const [body, highlightCss] = await Promise.all([
    renderMarkdown(markdown),
    loadHighlightCss(),
  ]);
  return createHtmlDocument({
    title: path.parse(inputFile).name,
    body,
    highlightCss,
    embedFonts,
  });
}

function getContentType(filePath) {
  if (filePath.endsWith(".mjs")) {
    return "text/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".ttc") || filePath.endsWith(".ttf")) {
    return "font/ttf";
  }
  return "application/octet-stream";
}

async function createServer({ inputFile, embedFonts = false, port = 3030 }) {
  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || "/", "http://localhost");
    const pathname = requestUrl.pathname;

    try {
      if (pathname === "/") {
        const html = await renderHtml(inputFile, { embedFonts });
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (pathname === "/vendor/mermaid.esm.min.mjs") {
        const body = await fsp.readFile(MERMAID_MODULE_FILE);
        res.writeHead(200, { "content-type": getContentType(MERMAID_MODULE_FILE) });
        res.end(body);
        return;
      }

      if (pathname.startsWith("/vendor/")) {
        const vendorFile = path.join(MERMAID_DIST_DIR, pathname.replace(/^\/vendor\//, ""));
        const normalized = path.normalize(vendorFile);
        if (!normalized.startsWith(MERMAID_DIST_DIR)) {
          res.writeHead(403);
          res.end("Forbidden");
          return;
        }
        const body = await fsp.readFile(normalized);
        res.writeHead(200, { "content-type": getContentType(normalized) });
        res.end(body);
        return;
      }

      if (pathname.startsWith("/fonts/")) {
        const fontFile = path.join(DOCS_ROOT, pathname.replace(/^\//, ""));
        const normalized = path.normalize(fontFile);
        if (!normalized.startsWith(path.join(DOCS_ROOT, "fonts"))) {
          res.writeHead(403);
          res.end("Forbidden");
          return;
        }
        const body = await fsp.readFile(normalized);
        res.writeHead(200, { "content-type": getContentType(normalized) });
        res.end(body);
        return;
      }

      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not Found");
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(`[markdown-it-render] ${error.message}`);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to determine server address.");
  }

  return {
    server,
    url: `http://localhost:${address.port}/`,
  };
}

function detectChromePath() {
  return process.env.MARKDOWN_IT_RENDER_CHROME_PATH || "";
}

async function exportPdf(inputFile, outputFile, timeoutMs) {
  const chromePath = detectChromePath();
  if (!chromePath) {
    throw new Error(
      [
        "MARKDOWN_IT_RENDER_CHROME_PATH is required for PDF export.",
        "Point it to a Chrome/Chromium executable.",
      ].join(" "),
    );
  }

  const { server, url } = await createServer({
    inputFile,
    embedFonts: true,
    port: 0,
  });

  try {
    const puppeteer = require("puppeteer-core");
    const browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const page = await browser.newPage();
      let pageRuntimeError;
      page.on("pageerror", (error) => {
        pageRuntimeError = error;
      });
      await page.goto(url, { waitUntil: "networkidle0" });
      await page.waitForFunction(
        () => window.__markdownItRenderReady__ === true || window.__markdownItRenderReady__ === "error",
        {
        timeout: timeoutMs,
        },
      );
      if (pageRuntimeError) {
        throw pageRuntimeError;
      }
      const renderError = await page.evaluate(() => window.__markdownItRenderError__ || null);
      if (renderError) {
        const previewError = new Error(renderError.message || "Preview render failed.");
        previewError.stack = renderError.stack || previewError.stack;
        throw previewError;
      }
      await page.emulateMediaType("print");

      await fsp.mkdir(path.dirname(outputFile), { recursive: true });
      await page.pdf({
        path: outputFile,
        format: "A3",
        outline: true,
        printBackground: true,
        preferCSSPageSize: true,
        margin: {
          top: "10mm",
          bottom: "10mm",
          left: "10mm",
          right: "10mm",
        },
      });
    } finally {
      await browser.close();
    }
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function runServe(args) {
  if (args.length < 1 || args.length > 3) {
    throw new Error(usage());
  }
  const inputFile = resolveInputFile(args[0]);
  const port = parsePort(args);
  await ensureInputFile(inputFile);
  const { server, url } = await createServer({ inputFile, port });

  let closing = false;
  let shortcutBinding;

  const closeServer = async () => {
    if (closing) {
      return;
    }
    closing = true;
    shortcutBinding?.dispose();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  };

  const handleSignal = () => {
    closeServer().catch((error) => {
      console.error(`[markdown-it-render] ${error.message}`);
      process.exitCode = 1;
    });
  };

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  shortcutBinding = bindServeShortcuts({
    inputFile,
    url,
    onQuit: async () => {
      await closeServer();
    },
  });

  printServeSummary({ inputFile, url, interactive: shortcutBinding.interactive });

  try {
    await new Promise((resolve, reject) => {
      server.once("close", resolve);
      server.once("error", reject);
    });
  } finally {
    shortcutBinding.dispose();
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
  }
}

async function runBuild(args) {
  const timeoutMs = parseTimeoutMs(args);
  const positionalArgs = stripFlag(args, "--timeout-ms");

  if (positionalArgs.length < 1 || positionalArgs.length > 2) {
    throw new Error(usage());
  }
  const inputFile = resolveInputFile(positionalArgs[0]);
  const outputFile = resolvePdfOutputFile(inputFile, positionalArgs[1]);
  await ensureInputFile(inputFile);
  await exportPdf(inputFile, outputFile, timeoutMs);
  printBuildSummary({ inputFile, outputFile });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "serve":
      await runServe(args);
      return;
    case "build":
      await runBuild(args);
      return;
    default:
      throw new Error(usage());
  }
}

main().catch(async (error) => {
  await printFatalError(error);
  process.exit(1);
});
