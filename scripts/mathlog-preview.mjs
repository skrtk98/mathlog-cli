#!/usr/bin/env node

import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { exec, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { tex2svgHtml } from "mathxyjax3";

const require = createRequire(import.meta.url);
const MarkdownIt = require("markdown-it");
const markdownItDeflist = require("markdown-it-deflist");
const hljs = require("highlight.js");
const multimdTable = require("markdown-it-multimd-table");

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_FILE);
const DOCS_ROOT = path.resolve(SCRIPT_DIR, "..");
const HIGHLIGHT_THEME_FILE = require.resolve("highlight.js/styles/github.css");
const MATHJAX_DIST_DIR = path.join(DOCS_ROOT, "node_modules", "mathjax-full", "es5");
const DEFAULT_CONTENT_DIR = "public";
const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = 8888;
const CONFIG_FILE_NAME = "mathlog.config.json";
const OFFICIAL_LINKS = [
  ["Mathlog", "https://mathlog.info/"],
  ["公式リファレンス", "https://opthub.notion.site/1ca318bcf9ac8195ad0af2a1ae8319e0"],
];
const MATHLOG_BOX_TYPES = new Map([
  ["axm", "公理"],
  ["def", "定義"],
  ["thm", "定理"],
  ["cor", "系"],
  ["lem", "補題"],
  ["conj", "予想"],
  ["prop", "命題"],
  ["fml", "公式"],
  ["prf", "証明"],
  ["ex", "例"],
  ["exc", "問題"],
  ["rem", "注意"],
]);
let highlightCssPromise;
let packageVersion;

function usage() {
  return [
    "Usage:",
    "  mathlog init [content-dir]",
    "  mathlog preview [content-dir] [--host localhost] [--port 8888]",
    "  mathlog new <basename> [content-dir]",
    "  mathlog version",
  ].join("\n");
}

function loadPackageVersion() {
  if (!packageVersion) {
    packageVersion = require(path.join(DOCS_ROOT, "package.json")).version || "0.0.0";
  }
  return packageVersion;
}

function printServeSummary({ contentRoot, url, interactive }) {
  console.log(`Mathlog preview: ${url}`);
  console.log(`Content directory: ${contentRoot}`);
  if (interactive) {
    console.log("Shortcuts: r restart, o open, e edit, q quit");
  }
}

function ensureInsidePath(parentPath, childPath) {
  const relativePath = path.relative(parentPath, childPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Path must be inside ${parentPath}: ${childPath}`);
  }
}

function isInsidePath(parentPath, childPath) {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function parseServeArgs(args) {
  const config = loadConfig();
  const port = parsePort(args, config.port);
  const host = parseHost(args, config.host);
  const positionalArgs = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--port" || args[index] === "--host") {
      index += 1;
      continue;
    }
    positionalArgs.push(args[index]);
  }
  if (positionalArgs.length > 1) {
    throw new Error(usage());
  }
  return {
    contentRoot: path.resolve(process.cwd(), positionalArgs[0] || config.contentDir || DEFAULT_CONTENT_DIR),
    host,
    port,
  };
}

function loadConfig() {
  try {
    const config = require(path.join(process.cwd(), CONFIG_FILE_NAME));
    return typeof config === "object" && config ? config : {};
  } catch {
    return {};
  }
}

function parseHost(args, configuredHost) {
  const flagIndex = args.findIndex((arg) => arg === "--host");
  if (flagIndex === -1) {
    return configuredHost || DEFAULT_HOST;
  }
  const value = args[flagIndex + 1] || "";
  if (!value) {
    throw new Error("Invalid --host value.");
  }
  return value;
}

function sanitizeArticleBasename(value) {
  const basename = String(value || "")
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  if (!basename) {
    throw new Error("Article basename is required.");
  }
  if (basename === "." || basename === ".." || basename.includes("..")) {
    throw new Error(`Invalid article basename: ${value}`);
  }
  return basename;
}

function createArticleTemplate(basename) {
  return [
    "---",
    `title: ${basename}`,
    "tags:",
    '  - ""',
    "private: false",
    "---",
    "",
    `# ${basename}`,
    "",
    "ここに本文を書きます。",
    "",
  ].join("\n");
}

function createWelcomeTemplate() {
  return [
    "---",
    "title: welcome",
    "tags:",
    '  - ""',
    "private: false",
    "---",
    "",
    "# welcome",
    "",
    "Mathlog の記事をここに書きます。",
    "",
    "$x^2+y^2=z^2$",
    "",
  ].join("\n");
}

async function createArticleFile(contentRoot, basename) {
  const safeBasename = sanitizeArticleBasename(basename);
  await fsp.mkdir(contentRoot, { recursive: true });
  const filePath = path.join(contentRoot, `${safeBasename}.md`);
  ensureInsidePath(contentRoot, filePath);
  try {
    const handle = await fsp.open(filePath, "wx");
    try {
      await handle.writeFile(createArticleTemplate(safeBasename), "utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Article already exists: ${path.relative(DOCS_ROOT, filePath)}`);
    }
    throw error;
  }
  return {
    filePath,
    relativePath: path.relative(contentRoot, filePath).split(path.sep).join("/"),
  };
}

async function initializeContentRoot(contentRoot) {
  await fsp.mkdir(contentRoot, { recursive: true });
  const configFile = path.join(process.cwd(), CONFIG_FILE_NAME);
  try {
    await fsp.writeFile(
      configFile,
      `${JSON.stringify(
        {
          contentDir: path.relative(process.cwd(), contentRoot).split(path.sep).join("/") || ".",
          host: DEFAULT_HOST,
          port: DEFAULT_PORT,
        },
        null,
        2,
      )}\n`,
      { flag: "wx" },
    );
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
  }
  const articles = await listMarkdownFiles(contentRoot);
  if (articles.length === 0) {
    const filePath = path.join(contentRoot, "welcome.md");
    await fsp.writeFile(filePath, createWelcomeTemplate(), { flag: "wx" });
    return { contentRoot, createdSample: filePath };
  }
  return { contentRoot, createdSample: "" };
}

async function ensureContentRoot(contentRoot) {
  try {
    const stats = await fsp.stat(contentRoot);
    if (!stats.isDirectory()) {
      throw new Error(`Content path must be a directory: ${contentRoot}`);
    }
  } catch {
    throw new Error(`Content directory not found: ${contentRoot}`);
  }
}

function parsePort(args, configuredPort) {
  const flagIndex = args.findIndex((arg) => arg === "--port");
  if (flagIndex === -1) {
    return configuredPort || DEFAULT_PORT;
  }
  const value = Number.parseInt(args[flagIndex + 1] || "", 10);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error(`Invalid --port value: ${args[flagIndex + 1] || ""}`);
  }
  return value;
}

function resetRenderState() {
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
  console.error(`[mathlog-preview] ${details}`);
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
    process.env.MATHLOG_PREVIEW_OPENER ||
    process.env.BROWSER ||
    "xdg-open"
  );
}

function resolveEditorCommand() {
  return (
    process.env.MATHLOG_PREVIEW_EDITOR ||
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
      "No editor configured. Set MATHLOG_PREVIEW_EDITOR, VISUAL, or EDITOR.",
    );
  }
  await execShellCommand(editorCommand, inputFile);
}

function bindServeShortcuts({ contentRoot, url, onQuit }) {
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
          printServeSummary({ contentRoot, url, interactive: true });
        });
        break;
      case "o":
        runShortcut(async () => {
          await openPreview(url);
        });
        break;
      case "e":
        runShortcut(async () => {
          await openEditor(contentRoot);
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

function parseHeadingLabel(text) {
  const match = text.match(/\s+\[([^\]]+)\]\s*$/);
  if (!match) {
    return { text, label: "" };
  }
  return {
    text: text.slice(0, match.index).trimEnd(),
    label: match[1].trim(),
  };
}

function stripHeadingLabel(inlineToken, label) {
  if (!inlineToken || !label) {
    return;
  }

  const pattern = new RegExp(`\\s+\\[${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\s*$`);
  inlineToken.content = inlineToken.content.replace(pattern, "");
  const children = inlineToken.children || [];
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (child.type !== "text") {
      continue;
    }
    child.content = child.content.replace(pattern, "");
    if (child.content.length === 0) {
      children.splice(index, 1);
    }
    break;
  }
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

function isEscapedDelimiter(source, index) {
  let slashCount = 0;
  for (let pos = index - 1; pos >= 0 && source[pos] === "\\"; pos -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function findClosingDollar(source, start, max) {
  for (let pos = start; pos < max; pos += 1) {
    if (source[pos] === "$" && !isEscapedDelimiter(source, pos)) {
      return pos;
    }
  }
  return -1;
}

function mathInlineRule(state, silent) {
  const start = state.pos;
  const source = state.src;

  if (source[start] !== "$" || source[start + 1] === "$" || isEscapedDelimiter(source, start)) {
    return false;
  }

  const end = findClosingDollar(source, start + 1, state.posMax);
  if (end === -1 || end === start + 1) {
    return false;
  }

  if (!silent) {
    const token = state.push("math_inline", "span", 0);
    token.content = source.slice(start + 1, end);
  }
  state.pos = end + 1;
  return true;
}

function getLineText(state, line) {
  return state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
}

function getRawLineText(state, line) {
  return state.src.slice(state.bMarks[line], state.eMarks[line]);
}

function parseMathAlignment(content) {
  const match = content.match(/^\s*\\Text(Center|Right|Left)\b\s*/);
  if (!match) {
    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const lineMatch =
        lines[index].match(/^\s*\\Text(Center|Right|Left)\b\s*/) ||
        lines[index].match(/^(\s*\\begin\{[^}]+\})\s*\\Text(Center|Right|Left)\b\s*/);
      if (!lineMatch) {
        continue;
      }

      const nextLines = [...lines];
      const beginPrefix = lineMatch[2] ? lineMatch[1] : "";
      const align = lineMatch[2] || lineMatch[1];
      const remainingLine = `${beginPrefix}${lines[index].slice(lineMatch[0].length)}`;
      if (remainingLine.trim().length === 0) {
        nextLines.splice(index, 1);
      } else {
        nextLines[index] = remainingLine;
      }
      return {
        align: align.toLowerCase(),
        content: nextLines.join("\n").trim(),
      };
    }
    return { align: "left", content };
  }
  return {
    align: match[1].toLowerCase(),
    content: content.slice(match[0].length),
  };
}

function mathBlockRule(state, startLine, endLine, silent) {
  const firstLine = getLineText(state, startLine);
  if (!firstLine.trimStart().startsWith("$$")) {
    return false;
  }

  const openerIndex = firstLine.indexOf("$$");
  const afterOpener = firstLine.slice(openerIndex + 2);
  const collected = [];
  let nextLine = startLine + 1;
  let foundClose = false;

  if (afterOpener.trimEnd().endsWith("$$") && afterOpener.trim().length > 2) {
    collected.push(afterOpener.replace(/\$\$\s*$/, ""));
    foundClose = true;
  } else {
    if (afterOpener.trim().length > 0) {
      collected.push(afterOpener);
    }
    for (; nextLine < endLine; nextLine += 1) {
      const line = getLineText(state, nextLine);
      if (line.trim() === "$$") {
        foundClose = true;
        nextLine += 1;
        break;
      }
      collected.push(line);
    }
  }

  if (!foundClose) {
    return false;
  }

  if (!silent) {
    const token = state.push("math_block", "div", 0);
    const parsed = parseMathAlignment(collected.join("\n").trim());
    token.content = parsed.content;
    token.meta = { align: parsed.align };
    token.map = [startLine, nextLine];
  }

  state.line = nextLine;
  return true;
}

function singleDollarBlockRule(state, startLine, endLine, silent) {
  const firstLine = getLineText(state, startLine);
  const trimmedFirstLine = firstLine.trimStart();
  if (!trimmedFirstLine.startsWith("$") || trimmedFirstLine.startsWith("$$")) {
    return false;
  }

  const afterOpener = trimmedFirstLine.slice(1);
  const collected = [];
  let nextLine = startLine + 1;
  let foundClose = false;

  if (afterOpener.trimEnd().endsWith("$") && afterOpener.trim().length > 1) {
    collected.push(afterOpener.replace(/\$\s*$/, ""));
    foundClose = true;
  } else {
    if (afterOpener.trim().length > 0) {
      collected.push(afterOpener);
    }
    for (; nextLine < endLine; nextLine += 1) {
      const line = getLineText(state, nextLine);
      if (line.trim() === "$") {
        foundClose = true;
        nextLine += 1;
        break;
      }
      collected.push(line);
    }
  }

  if (!foundClose || !containsXyPic(collected.join("\n"))) {
    return false;
  }

  if (!silent) {
    const token = state.push("math_block", "div", 0);
    const parsed = parseMathAlignment(collected.join("\n").trim());
    token.content = parsed.content;
    token.meta = { align: parsed.align };
    token.map = [startLine, nextLine];
  }

  state.line = nextLine;
  return true;
}

function beginEnvironmentRule(state, startLine, endLine, silent) {
  const firstLine = getLineText(state, startLine);
  const beginMatch = firstLine.trimStart().match(/^\\begin\{([^}]+)\}/);
  if (!beginMatch) {
    return false;
  }

  const environmentName = beginMatch[1];
  const endPattern = new RegExp(`\\\\end\\{${environmentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}`);
  const collected = [firstLine.trimStart()];
  let nextLine = startLine + 1;
  let foundClose = endPattern.test(firstLine);

  for (; !foundClose && nextLine < endLine; nextLine += 1) {
    const line = getLineText(state, nextLine);
    collected.push(line);
    if (endPattern.test(line)) {
      foundClose = true;
      nextLine += 1;
      break;
    }
  }

  if (!foundClose) {
    return false;
  }

  if (!silent) {
    const token = state.push("math_block", "div", 0);
    const parsed = parseMathAlignment(collected.join("\n").trim());
    token.content = parsed.content;
    token.meta = { align: parsed.align };
    token.map = [startLine, nextLine];
  }

  state.line = nextLine;
  return true;
}

function containsXyPic(content) {
  return /\\begin\{xy\}|\\xymatrix\b/.test(content);
}

function renderServerMath(content, { display, inline = false }) {
  try {
    const html = tex2svgHtml(content, { display });
    const tag = inline ? "span" : "div";
    const className = inline
      ? "mathlog-math mathlog-math--inline mathlog-math--server"
      : "mathlog-math mathlog-math--block mathlog-math--left mathlog-math--server mathlog-math__server-svg";
    return `<${tag} class="${className}">${html}</${tag}>`;
  } catch {
    const delimiter = inline ? ["\\(", "\\)"] : ["\\[", "\\]"];
    const tag = inline ? "span" : "div";
    return `<${tag} class="mathlog-math mathlog-math--${inline ? "inline" : "block"}">${delimiter[0]}${escapeHtml(content)}${delimiter[1]}</${tag}>`;
  }
}

function renderMathInline(tokens, idx) {
  const content = tokens[idx].content;
  if (containsXyPic(content)) {
    return renderServerMath(content, { display: false, inline: true });
  }
  return `<span class="mathlog-math mathlog-math--inline">\\(${escapeHtml(content)}\\)</span>`;
}

function renderMathBlock(tokens, idx) {
  const align = tokens[idx].meta?.align || "left";
  const content = tokens[idx].content;
  if (containsXyPic(content)) {
    return `<div class="mathlog-math mathlog-math--block mathlog-math--${escapeAttribute(align)} mathlog-math--server">${renderServerMath(content, { display: true })}</div>\n`;
  }
  return `<div class="mathlog-math mathlog-math--block mathlog-math--${escapeAttribute(align)}">\\[${escapeHtml(content)}\\]</div>\n`;
}

function parseMathlogBoxInfo(info) {
  const labelMatch = info.match(/\s+\[([^\]]+)\]\s*$/);
  const label = labelMatch ? labelMatch[1].trim() : "";
  const withoutLabel = labelMatch ? info.slice(0, labelMatch.index).trim() : info.trim();
  const [maybeType = "", ...titleParts] = withoutLabel.split(/\s+/);
  const type = MATHLOG_BOX_TYPES.has(maybeType) ? maybeType : "";
  const title = type ? titleParts.join(" ") : withoutLabel;
  return { type, title, label };
}

function mathlogBoxRule(state, startLine, endLine, silent) {
  const firstLine = getLineText(state, startLine);
  const openMatch = firstLine.trimStart().match(/^&&&(.*)$/);
  if (!openMatch) {
    return false;
  }

  let nextLine = startLine + 1;
  let foundClose = false;
  for (; nextLine < endLine; nextLine += 1) {
    if (getLineText(state, nextLine).trim() === "&&&") {
      foundClose = true;
      break;
    }
  }

  if (!foundClose) {
    return false;
  }

  if (silent) {
    return true;
  }

  const parsed = parseMathlogBoxInfo(openMatch[1] || "");
  const openToken = state.push("mathlog_box_open", "section", 1);
  openToken.block = true;
  openToken.meta = parsed;
  openToken.map = [startLine, nextLine + 1];

  state.md.block.tokenize(state, startLine + 1, nextLine);

  const closeToken = state.push("mathlog_box_close", "section", -1);
  closeToken.block = true;

  state.line = nextLine + 1;
  return true;
}

function mathlogReferenceRule(state, silent) {
  const start = state.pos;
  const source = state.src;
  if (source[start] !== "[" || source[start + 1] !== "[") {
    return false;
  }
  const end = source.indexOf("]]", start + 2);
  if (end === -1 || end === start + 2) {
    return false;
  }

  if (!silent) {
    const token = state.push("mathlog_reference", "a", 0);
    token.content = source.slice(start + 2, end).trim();
  }
  state.pos = end + 2;
  return true;
}

function assignMathlogBoxMetadata(tokens, env) {
  const counters = new Map();
  const references = {};
  let anonymousIndex = 0;

  for (const token of tokens) {
    if (token.type === "mathlog_box_open") {
      const meta = token.meta || {};
      const type = meta.type || "";
      const typeLabel = type ? MATHLOG_BOX_TYPES.get(type) : "";
      const count = type ? (counters.get(type) || 0) + 1 : 0;
      if (type) {
        counters.set(type, count);
      }

      const numberLabel = typeLabel ? `${typeLabel} ${count}` : "";
      const title = meta.title || "";
      const referenceText = [numberLabel, title].filter(Boolean).join(" ");
      anonymousIndex += 1;
      token.meta = {
        ...meta,
        id: meta.label || `mathlog-box-${anonymousIndex}`,
        numberLabel,
        referenceText: referenceText || title || "囲み枠",
      };

      if (meta.label) {
        references[meta.label] = token.meta.referenceText;
      }
    }

    if (Array.isArray(token.children) && token.children.length > 0) {
      assignMathlogBoxMetadata(token.children, env);
    }
  }

  env.mathlogReferences = {
    ...(env.mathlogReferences || {}),
    ...references,
  };
}

function renderMathlogBoxOpen(tokens, idx) {
  const meta = tokens[idx].meta || {};
  const classes = ["mathlog-box", meta.type ? `mathlog-box--${meta.type}` : "mathlog-box--plain"];
  const heading = [meta.numberLabel, meta.title].filter(Boolean).join(" ");
  const id = meta.id ? ` id="${escapeAttribute(meta.id)}"` : "";
  const titleHtml = heading
    ? `<div class="mathlog-box__title">${escapeHtml(heading)}</div>\n`
    : "";
  return `<section class="${classes.map(escapeAttribute).join(" ")}"${id}>\n${titleHtml}<div class="mathlog-box__body">\n`;
}

function renderMathlogBoxClose() {
  return "</div>\n</section>\n";
}

function normalizeArticleRelativePath(currentDir, target) {
  return path.posix
    .normalize(path.posix.join(currentDir || "", target))
    .replace(/^\/+/, "");
}

function isExternalResource(value) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value);
}

function renderMathlogReference(tokens, idx, options, env) {
  const label = tokens[idx].content;
  const text = env.mathlogReferences?.[label] || label;
  return `<a class="mathlog-reference" href="#${escapeAttribute(label)}">${escapeHtml(text)}</a>`;
}

function parseMathlogListMarker(line) {
  const markerPatterns = [
    { type: "paren-roman", pattern: /^\s*\(R(\d+)\)\s+(.+)$/ },
    { type: "bracket-roman", pattern: /^\s*\[R(\d+)\]\s+(.+)$/ },
    { type: "roman", pattern: /^\s*R(\d+)\.\s+(.+)$/ },
    { type: "paren-decimal", pattern: /^\s*\((\d+)\)\s+(.+)$/ },
    { type: "bracket-decimal", pattern: /^\s*\[(\d+)\]\s+(.+)$/ },
  ];

  for (const { type, pattern } of markerPatterns) {
    const match = line.match(pattern);
    if (match) {
      const markerByType = {
        "paren-roman": `(R${match[1]})`,
        "bracket-roman": `[R${match[1]}]`,
        roman: `R${match[1]}.`,
        "paren-decimal": `(${match[1]})`,
        "bracket-decimal": `[${match[1]}]`,
      };
      return {
        type,
        ordinal: match[1],
        marker: markerByType[type],
        content: match[2],
      };
    }
  }

  return null;
}

function parseIndentedListMarker(line) {
  const unorderedMatch = line.match(/^\s+[-*+]\s+(.+)$/);
  if (unorderedMatch) {
    return { ordered: false, content: unorderedMatch[1] };
  }

  const orderedMatch = line.match(/^\s+\d+\.\s+(.+)$/);
  if (orderedMatch) {
    return { ordered: true, content: orderedMatch[1] };
  }

  return null;
}

function pushInlineToken(state, content) {
  const inlineToken = state.push("inline", "", 0);
  inlineToken.content = content;
  inlineToken.children = [];
}

function pushNestedStandardList(state, items, ordered) {
  const listOpen = state.push(ordered ? "ordered_list_open" : "bullet_list_open", ordered ? "ol" : "ul", 1);
  listOpen.block = true;
  if (ordered) {
    listOpen.attrSet("start", "1");
  }

  for (const item of items) {
    const itemOpen = state.push("list_item_open", "li", 1);
    itemOpen.block = true;
    pushInlineToken(state, item);
    const itemClose = state.push("list_item_close", "li", -1);
    itemClose.block = true;
  }

  const listClose = state.push(ordered ? "ordered_list_close" : "bullet_list_close", ordered ? "ol" : "ul", -1);
  listClose.block = true;
}

function mathlogListRule(state, startLine, endLine, silent) {
  const firstLine = getLineText(state, startLine);
  const firstMarker = parseMathlogListMarker(firstLine);
  if (!firstMarker) {
    return false;
  }

  if (silent) {
    return true;
  }

  const openToken = state.push("mathlog_list_open", "ol", 1);
  openToken.block = true;
  openToken.meta = { type: firstMarker.type };
  openToken.map = [startLine, startLine + 1];

  let nextLine = startLine;
  for (; nextLine < endLine; nextLine += 1) {
    const line = getLineText(state, nextLine);
    const marker = parseMathlogListMarker(line);
    if (!marker || marker.type !== firstMarker.type) {
      break;
    }

    const itemOpen = state.push("mathlog_list_item_open", "li", 1);
    itemOpen.block = true;
    itemOpen.meta = { marker: marker.marker };

    pushInlineToken(state, marker.content);

    nextLine += 1;

    let nestedItems = [];
    let nestedOrdered = null;
    for (; nextLine < endLine; nextLine += 1) {
      const rawLine = getRawLineText(state, nextLine);
      const line = getLineText(state, nextLine);
      const nextMarker = parseMathlogListMarker(line);
      if (nextMarker) {
        break;
      }
      if (line.trim() === "") {
        continue;
      }
      if (!/^\s+/.test(rawLine)) {
        break;
      }

      const nestedMarker = parseIndentedListMarker(rawLine);
      if (!nestedMarker) {
        break;
      }

      if (nestedOrdered === null) {
        nestedOrdered = nestedMarker.ordered;
      }
      if (nestedMarker.ordered !== nestedOrdered) {
        if (nestedItems.length > 0) {
          pushNestedStandardList(state, nestedItems, nestedOrdered);
        }
        nestedItems = [];
        nestedOrdered = nestedMarker.ordered;
      }
      nestedItems.push(nestedMarker.content);
    }

    if (nestedItems.length > 0) {
      pushNestedStandardList(state, nestedItems, Boolean(nestedOrdered));
    }

    const itemClose = state.push("mathlog_list_item_close", "li", -1);
    itemClose.block = true;
    nextLine -= 1;
  }

  const closeToken = state.push("mathlog_list_close", "ol", -1);
  closeToken.block = true;
  openToken.map = [startLine, nextLine];
  state.line = nextLine;
  return true;
}

function renderMathlogListOpen(tokens, idx) {
  const type = tokens[idx].meta?.type || "custom";
  return `<ol class="mathlog-list mathlog-list--${escapeAttribute(type)}">\n`;
}

function renderMathlogListItemOpen(tokens, idx) {
  const marker = tokens[idx].meta?.marker || "";
  return `<li><span class="mathlog-list__marker">${escapeHtml(marker)}</span><div class="mathlog-list__content">`;
}

function renderMathlogListItemClose() {
  return "</div></li>\n";
}

function resolvePreviewAssetPath(src, currentDir) {
  if (!src || isExternalResource(src)) {
    return src;
  }
  const assetPath = normalizeArticleRelativePath(currentDir || "", src);
  return `/content/${assetPath.split("/").map(encodeURIComponent).join("/")}`;
}

function readBalancedTeXCommand(source, start) {
  const openIndex = source.indexOf("{", start);
  if (openIndex === -1) {
    return null;
  }

  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\" && index + 1 < source.length) {
      index += 1;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          end: index + 1,
          tex: source.slice(start, index + 1),
        };
      }
    }
  }
  return null;
}

function readXyPicSnippet(source, start) {
  if (source.startsWith("\\begin{xy}", start)) {
    const close = "\\end{xy}";
    const end = source.indexOf(close, start + "\\begin{xy}".length);
    if (end === -1) {
      return null;
    }
    return {
      end: end + close.length,
      tex: source.slice(start, end + close.length),
    };
  }

  if (source.startsWith("\\xymatrix", start)) {
    return readBalancedTeXCommand(source, start);
  }

  return null;
}

function pushHtmlPlaceholder(htmlBlocks, html) {
  const index = htmlBlocks.push(html) - 1;
  return `\n<!--MATHLOG_HTML_${index}-->\n`;
}

function restoreHtmlPlaceholders(html, htmlBlocks) {
  return html.replace(/<!--MATHLOG_HTML_(\d+)-->/g, (_match, index) => htmlBlocks[Number(index)] || "");
}

function replaceXyPicSnippets(markdown, htmlBlocks) {
  let output = "";
  for (let index = 0; index < markdown.length;) {
    if (markdown[index] === "$") {
      const snippet = readXyPicSnippet(markdown, index + 1);
      if (snippet) {
        const hasClosingDollar = markdown[snippet.end] === "$";
        output += pushHtmlPlaceholder(htmlBlocks, renderServerMath(snippet.tex, { display: true }));
        index = snippet.end + (hasClosingDollar ? 1 : 0);
        continue;
      }
    }

    const snippet = readXyPicSnippet(markdown, index);
    if (snippet) {
      output += pushHtmlPlaceholder(htmlBlocks, renderServerMath(snippet.tex, { display: true }));
      index = snippet.end;
      continue;
    }

    output += markdown[index];
    index += 1;
  }
  return output;
}

function preprocessMathlogMarkdown(markdown, { currentDir = "", htmlBlocks = [] } = {}) {
  return replaceXyPicSnippets(markdown, htmlBlocks)
    .replace(/([^\s&])&&&(\s*)(?=\r?\n|$)/g, "$1\n&&&$2")
    .replace(
      /!\[([^\]]*)\]\((\S+)\s+=(\d+)\)/g,
      (_match, alt, src, width) =>
        `<img src="${escapeAttribute(resolvePreviewAssetPath(src, currentDir))}" alt="${escapeAttribute(alt)}" style="max-width: ${escapeAttribute(width)}px; width: 100%;">`,
    );
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

  md.inline.ruler.before("escape", "math_inline", mathInlineRule);
  md.block.ruler.before("fence", "single_dollar_math_block", singleDollarBlockRule, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
  md.block.ruler.before("fence", "math_block", mathBlockRule, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
  md.block.ruler.before("fence", "begin_environment", beginEnvironmentRule, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
  md.block.ruler.before("fence", "mathlog_box", mathlogBoxRule, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
  md.block.ruler.before("list", "mathlog_list", mathlogListRule, {
    alt: ["paragraph", "reference", "blockquote"],
  });
  md.inline.ruler.before("link", "mathlog_reference", mathlogReferenceRule);

  const seenIds = new Map();
  const defaultLinkOpen =
    md.renderer.rules.link_open ??
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  const defaultImage =
    md.renderer.rules.image ??
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const inlineToken = tokens[idx + 1];
    const rawText = inlineToken?.type === "inline" ? inlineToken.content : "";
    const { text, label } = parseHeadingLabel(rawText);
    stripHeadingLabel(inlineToken, label);
    let slug = label || slugifyHeading(text) || `section-${idx}`;
    const count = seenIds.get(slug) ?? 0;
    seenIds.set(slug, count + 1);
    if (count > 0) {
      slug = `${slug}-${count + 1}`;
    }
    token.tag = `h${Math.min(Number.parseInt(token.tag.slice(1), 10) + 1, 6)}`;
    token.attrSet("id", slug);
    return self.renderToken(tokens, idx, options);
  };

  md.renderer.rules.heading_close = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    token.tag = `h${Math.min(Number.parseInt(token.tag.slice(1), 10) + 1, 6)}`;
    return self.renderToken(tokens, idx, options);
  };

  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const href = token.attrGet("href") || "";
    if (/^https?:\/\//i.test(href)) {
      token.attrSet("target", "_blank");
      token.attrSet("rel", "noreferrer noopener");
    } else if (!isExternalResource(href) && path.posix.extname(href).toLowerCase() === ".md") {
      const [targetPath, hash = ""] = href.split("#", 2);
      const articlePath = normalizeArticleRelativePath(env.currentDir || "", targetPath);
      token.attrSet("href", `/?file=${encodeURIComponent(articlePath)}${hash ? `#${escapeAttribute(hash)}` : ""}`);
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet("src") || "";
    const widthMatch = src.match(/^(.*?)\s+=(\d+)$/);
    if (widthMatch) {
      token.attrSet("src", widthMatch[1]);
      token.attrSet("style", `max-width: ${widthMatch[2]}px; width: 100%;`);
    } else if (!token.attrGet("style")) {
      token.attrSet("style", "width: 100%;");
    }
    const normalizedSrc = token.attrGet("src") || "";
    token.attrSet("src", resolvePreviewAssetPath(normalizedSrc, env.currentDir || ""));
    return defaultImage(tokens, idx, options, env, self);
  };

  md.renderer.rules.table_open = () => '<div class="table-scroll">\n<table>\n';
  md.renderer.rules.table_close = () => "</table>\n</div>\n";
  md.renderer.rules.math_inline = renderMathInline;
  md.renderer.rules.math_block = renderMathBlock;
  md.renderer.rules.mathlog_box_open = renderMathlogBoxOpen;
  md.renderer.rules.mathlog_box_close = renderMathlogBoxClose;
  md.renderer.rules.mathlog_reference = renderMathlogReference;
  md.renderer.rules.mathlog_list_open = renderMathlogListOpen;
  md.renderer.rules.mathlog_list_close = () => "</ol>\n";
  md.renderer.rules.mathlog_list_item_open = renderMathlogListItemOpen;
  md.renderer.rules.mathlog_list_item_close = renderMathlogListItemClose;

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const language = getFenceLanguage(token.info);
    return renderCodeBlock(token.content, language);
  };

  return md;
}

async function renderMarkdown(markdown, { currentDir = "" } = {}) {
  const md = createMarkdownIt();
  const env = { currentDir };
  const htmlBlocks = [];
  const tokens = md.parse(preprocessMathlogMarkdown(markdown, { currentDir, htmlBlocks }), env);
  assignMathlogBoxMetadata(tokens, env);
  return restoreHtmlPlaceholders(md.renderer.render(tokens, md.options, env), htmlBlocks);
}

function parseFrontMatter(markdown) {
  const frontMatterMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!frontMatterMatch) {
    return { markdown, meta: {} };
  }

  const raw = frontMatterMatch[1].trim();
  const body = markdown.slice(frontMatterMatch[0].length);
  const meta = {};
  const lines = raw.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[1];
    const value = match[2].trim();
    if (value === "") {
      const values = [];
      for (let next = index + 1; next < lines.length; next += 1) {
        const itemMatch = lines[next].match(/^\s*-\s*(.*)$/);
        if (!itemMatch) {
          break;
        }
        values.push(itemMatch[1].replace(/^["']|["']$/g, ""));
        index = next;
      }
      meta[key] = values;
    } else if (/^\[.*\]$/.test(value)) {
      meta[key] = value
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else if (value === "true" || value === "false") {
      meta[key] = value === "true";
    } else {
      meta[key] = value.replace(/^["']|["']$/g, "");
    }
  }

  return { markdown: body, meta };
}

async function readArticleFile(filePath) {
  const source = await fsp.readFile(filePath, "utf8");
  return parseFrontMatter(source);
}

async function listMarkdownFiles(contentRoot, currentDir = contentRoot) {
  const entries = await fsp.readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const entryPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(contentRoot, entryPath));
      continue;
    }

    if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") {
      const relativePath = path.relative(contentRoot, entryPath).split(path.sep).join("/");
      const { meta } = await readArticleFile(entryPath);
      files.push({
        relativePath,
        title: meta.title || path.parse(entry.name).name,
        meta,
        filePath: entryPath,
      });
    }
  }

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function collectContentState(contentRoot, currentDir = contentRoot) {
  const entries = await fsp.readdir(currentDir, { withFileTypes: true });
  let latestMtimeMs = 0;
  let fileCount = 0;

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const entryPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      const childState = await collectContentState(contentRoot, entryPath);
      latestMtimeMs = Math.max(latestMtimeMs, childState.latestMtimeMs);
      fileCount += childState.fileCount;
      continue;
    }

    if (entry.isFile()) {
      const stats = await fsp.stat(entryPath);
      latestMtimeMs = Math.max(latestMtimeMs, stats.mtimeMs);
      fileCount += 1;
    }
  }

  return {
    latestMtimeMs,
    fileCount,
    version: `${fileCount}:${Math.floor(latestMtimeMs)}`,
  };
}

function renderOfficialLinks() {
  return OFFICIAL_LINKS
    .map(([label, href]) => `<a href="${escapeAttribute(href)}" target="_blank" rel="noreferrer noopener">${escapeHtml(label)}</a>`)
    .join("");
}

function renderArticleNav(articles, selectedPath) {
  if (articles.length === 0) {
    return '<p class="article-nav__empty">No markdown files.</p>';
  }

  return `<ol class="article-nav__list">
${articles
  .map((article) => {
    const active = article.relativePath === selectedPath ? " article-nav__link--active" : "";
    const privateMark = article.meta?.private ? '<span class="article-nav__badge">private</span>' : "";
    return `<li><a class="article-nav__link${active}" href="/?file=${encodeURIComponent(article.relativePath)}"><span>${escapeHtml(article.title)}${privateMark}</span><small>${escapeHtml(article.relativePath)}</small></a></li>`;
  })
  .join("\n")}
</ol>`;
}

function renderArticleMeta(selectedPath, meta) {
  if (!selectedPath) {
    return "No article selected";
  }
  const tags = Array.isArray(meta?.tags) ? meta.tags.filter(Boolean) : [];
  const badges = [
    meta?.private ? '<span class="preview-meta__badge">private</span>' : "",
    ...tags.map((tag) => `<span class="preview-meta__badge">${escapeHtml(tag)}</span>`),
  ].filter(Boolean);
  return `${escapeHtml(selectedPath)}${badges.length > 0 ? ` ${badges.join(" ")}` : ""}`;
}

async function loadHighlightCss() {
  if (!highlightCssPromise) {
    highlightCssPromise = fsp.readFile(HIGHLIGHT_THEME_FILE, "utf8");
  }
  return highlightCssPromise;
}

function createHtmlDocument({
  title,
  body,
  highlightCss,
  articles = [],
  selectedPath = "",
  contentRoot = "",
}) {
  const fontFamily = '"Segoe UI", "Yu Gothic UI", system-ui, sans-serif';
  const monoFontFamily = 'Consolas, ui-monospace, monospace';

  return `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeAttribute(title)}</title>
    <style>
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
        background: #f6f8fa;
        line-height: 1.7;
        font-family: ${fontFamily};
        font-synthesis: none;
      }

      .app-header {
        position: sticky;
        top: 0;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        min-height: 56px;
        padding: 0 20px;
        border-bottom: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.96);
      }

      .app-header__brand {
        display: flex;
        flex-direction: column;
        gap: 0.05rem;
        min-width: 0;
        font-weight: 700;
        line-height: 1.2;
      }

      .app-header__brand small {
        color: var(--muted);
        font-weight: 400;
      }

      .app-header__links {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        white-space: nowrap;
      }

      .app-header__actions {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .new-article-button {
        appearance: none;
        border: 1px solid #1f883d;
        border-radius: 6px;
        background: #1f883d;
        color: #fff;
        padding: 0.38rem 0.75rem;
        font: inherit;
        font-weight: 700;
        line-height: 1.2;
        cursor: pointer;
      }

      .new-article-button:hover {
        background: #1a7f37;
      }

      .app-shell {
        display: grid;
        grid-template-columns: 280px minmax(0, 1fr);
        min-height: calc(100vh - 56px);
      }

      .article-nav {
        position: sticky;
        top: 56px;
        align-self: start;
        height: calc(100vh - 56px);
        overflow: auto;
        border-right: 1px solid var(--border);
        background: #fff;
      }

      .article-nav__header {
        padding: 16px 16px 10px;
        border-bottom: 1px solid var(--border);
      }

      .article-nav__header strong {
        color: var(--fg);
      }

      .article-nav__header small {
        display: block;
        color: var(--muted);
        overflow-wrap: anywhere;
      }

      .article-nav__list {
        list-style: none;
        margin: 0;
        padding: 8px;
      }

      .article-nav__link {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        padding: 0.55rem 0.65rem;
        border-radius: 6px;
        color: var(--fg);
        text-decoration: none;
      }

      .article-nav__link:hover,
      .article-nav__link--active {
        background: #eef2f6;
      }

      .article-nav__link small,
      .article-nav__empty {
        color: var(--muted);
      }

      .article-nav__badge {
        display: inline-block;
        margin-left: 0.4rem;
        padding: 0.05rem 0.35rem;
        border: 1px solid var(--border);
        border-radius: 999px;
        color: var(--muted);
        font-size: 0.72rem;
        font-weight: 400;
      }

      .article-nav__empty {
        padding: 16px;
      }

      .preview-pane {
        min-width: 0;
        padding: 32px 24px 80px;
      }

      .preview-meta {
        max-width: 980px;
        margin: 0 auto 16px;
        color: var(--muted);
        font-size: 0.9rem;
        overflow-wrap: anywhere;
      }

      .preview-meta__badge {
        display: inline-block;
        margin-left: 0.4rem;
        padding: 0.05rem 0.4rem;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: #fff;
      }

      main.markdown-body {
        max-width: 980px;
        margin: 0 auto;
        padding: 32px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: #fff;
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

      p, ul, ol, blockquote, pre, table, .table-scroll, .code-block {
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

      strong {
        color: #d1242f;
        font-weight: 700;
      }

      s {
        text-decoration-thickness: 0.08em;
      }

      .fw-bold {
        color: inherit;
        font-weight: 700;
      }

      .border,
      .box {
        border: 1px solid var(--border);
        border-radius: 8px;
      }

      .p-4 {
        padding: 1.5rem;
      }

      .box .title {
        margin-bottom: 0.5rem;
        font-weight: 700;
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

      .mathlog-box {
        margin: 1.2rem 0;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: #fff;
        overflow: hidden;
      }

      .mathlog-box__title {
        padding: 0.55rem 0.85rem;
        border-bottom: 1px solid var(--border);
        background: #f6f8fa;
        font-weight: 700;
      }

      .mathlog-box__body {
        padding: 0.85rem;
      }

      .mathlog-box__body > :last-child {
        margin-bottom: 0;
      }

      .mathlog-box--def,
      .mathlog-box--thm,
      .mathlog-box--lem,
      .mathlog-box--prop,
      .mathlog-box--cor,
      .mathlog-box--fml,
      .mathlog-box--axm {
        border-color: #8c959f;
      }

      .mathlog-box--prf {
        border-color: #6e7781;
        background: #fbfbfc;
      }

      .mathlog-reference {
        font-weight: 700;
        text-decoration-thickness: 0.08em;
      }

      .mathlog-list {
        list-style: none;
        padding-left: 0;
      }

      .mathlog-list li {
        display: grid;
        grid-template-columns: max-content minmax(0, 1fr);
        gap: 0.55rem;
        margin: 0.25rem 0;
      }

      .mathlog-list__marker {
        color: var(--muted);
        font-variant-numeric: tabular-nums;
      }

      .mathlog-list__content > :first-child {
        margin-top: 0;
      }

      .mathlog-list__content > :last-child {
        margin-bottom: 0;
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

      .mathlog-math--block {
        overflow-x: auto;
        margin: 1rem 0;
      }

      .mathlog-math--center {
        text-align: center;
      }

      .mathlog-math--right {
        text-align: right;
      }

      svg text,
      svg foreignObject,
      svg foreignObject div {
        font-family: ${fontFamily};
      }

      @page {
        size: A3;
        margin: 10mm;
      }

      @media print {
        body {
          background: #fff;
        }

        .app-header,
        .article-nav {
          display: none;
        }

        .app-shell {
          display: block;
        }

        .preview-pane {
          padding: 0;
        }

        main.markdown-body {
          max-width: none;
          padding: 0;
          border: 0;
        }

        .action-button {
          display: none !important;
        }
      }

      @media (max-width: 760px) {
        .app-header {
          align-items: flex-start;
          flex-direction: column;
          padding: 12px 16px;
        }

        .app-header__links {
          flex-wrap: wrap;
          white-space: normal;
        }

        .app-shell {
          display: block;
        }

        .article-nav {
          position: static;
          height: auto;
          max-height: 38vh;
          border-right: 0;
          border-bottom: 1px solid var(--border);
        }

        .preview-pane {
          padding: 20px 12px 56px;
        }

        main.markdown-body {
          padding: 20px;
        }
      }
    </style>
    <script>
      window.MathJax = {
        tex: {
          inlineMath: [["\\\\(", "\\\\)"]],
          displayMath: [["\\\\[", "\\\\]"]],
          processEscapes: true,
          tags: "ams"
        },
        svg: {
          fontCache: "global"
        },
        startup: {
          typeset: false
        }
      };
    </script>
    <script src="/vendor/mathjax/tex-svg-full.js"></script>
    <script type="module">
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

      function attachNewArticleAction() {
        const button = document.querySelector("[data-new-article]");
        if (!button) {
          return;
        }
        button.addEventListener("click", async () => {
          const basename = window.prompt("記事ファイルのベース名");
          if (!basename) {
            return;
          }
          button.disabled = true;
          try {
            const response = await fetch("/api/articles", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ basename }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
              throw new Error(payload.error || "記事を作成できませんでした。");
            }
            window.location.href = "/?file=" + encodeURIComponent(payload.relativePath);
          } catch (error) {
            window.alert(error?.message || String(error));
          } finally {
            button.disabled = false;
          }
        });
      }

      function attachAutoReload() {
        let currentVersion = "";
        const check = async () => {
          try {
            const response = await fetch("/api/state", { cache: "no-store" });
            if (!response.ok) {
              return;
            }
            const state = await response.json();
            if (!currentVersion) {
              currentVersion = state.version || "";
              return;
            }
            if (state.version && state.version !== currentVersion) {
              window.location.reload();
            }
          } catch {
            // Keep preview usable even while files are being edited.
          }
        };
        window.setInterval(check, 1500);
        check();
      }

      async function main() {
        if (window.MathJax?.typesetPromise) {
          await window.MathJax.typesetPromise([document.querySelector(".markdown-body")]);
        }

        attachCodeActions();
        attachNewArticleAction();
        attachAutoReload();

        window.__markdownItRenderReady__ = true;
        document.documentElement.dataset.renderReady = "true";
      }

      main().catch((error) => {
        console.error("[mathlog-preview] preview failed", error);
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
    <header class="app-header">
      <div class="app-header__brand">
        <span>mathlog-preview</span>
        <small>local Mathlog article preview</small>
      </div>
      <div class="app-header__actions">
        <button class="new-article-button" type="button" data-new-article>新規記事作成</button>
        <nav class="app-header__links" aria-label="official links">
          ${renderOfficialLinks()}
        </nav>
      </div>
    </header>
    <div class="app-shell">
      <aside class="article-nav">
        <div class="article-nav__header">
          <strong>Articles</strong>
          <small>${escapeHtml(path.relative(DOCS_ROOT, contentRoot) || ".")}</small>
        </div>
        ${renderArticleNav(articles, selectedPath)}
      </aside>
      <div class="preview-pane">
        <div class="preview-meta">${renderArticleMeta(selectedPath, articles.find((article) => article.relativePath === selectedPath)?.meta || {})}</div>
        <main class="markdown-body">
${body}
        </main>
      </div>
    </div>
  </body>
</html>
`;
}

async function renderHtml(contentRoot, selectedPath) {
  const articles = await listMarkdownFiles(contentRoot);
  const selectedArticle =
    articles.find((article) => article.relativePath === selectedPath) || articles[0] || null;
  const article = selectedArticle
    ? await readArticleFile(selectedArticle.filePath)
    : { markdown: "# 記事がありません\n\n「新規記事作成」から Markdown ファイルを作成できます。", meta: {} };
  const currentDir = selectedArticle ? path.posix.dirname(selectedArticle.relativePath) : "";
  const [body, highlightCss] = await Promise.all([
    renderMarkdown(article.markdown, { currentDir: currentDir === "." ? "" : currentDir }),
    loadHighlightCss(),
  ]);
  return createHtmlDocument({
    title: selectedArticle ? selectedArticle.title : "mathlog-preview",
    body,
    highlightCss,
    articles,
    selectedPath: selectedArticle?.relativePath || "",
    contentRoot,
  });
}

function getContentType(filePath) {
  if (filePath.endsWith(".png")) {
    return "image/png";
  }
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (filePath.endsWith(".gif")) {
    return "image/gif";
  }
  if (filePath.endsWith(".svg")) {
    return "image/svg+xml; charset=utf-8";
  }
  if (filePath.endsWith(".webp")) {
    return "image/webp";
  }
  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".mjs")) {
    return "text/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".ttc") || filePath.endsWith(".ttf")) {
    return "font/ttf";
  }
  return "application/octet-stream";
}

async function createServer({ contentRoot, host = DEFAULT_HOST, port = DEFAULT_PORT }) {
  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || "/", "http://localhost");
    const pathname = requestUrl.pathname;

    try {
      if (pathname === "/api/articles" && req.method === "POST") {
        let rawBody = "";
        req.setEncoding("utf8");
        for await (const chunk of req) {
          rawBody += chunk;
          if (rawBody.length > 8192) {
            throw new Error("Request body is too large.");
          }
        }
        const payload = JSON.parse(rawBody || "{}");
        const article = await createArticleFile(contentRoot, payload.basename);
        res.writeHead(201, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(article));
        return;
      }

      if (pathname === "/api/state" && req.method === "GET") {
        const state = await collectContentState(contentRoot);
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(JSON.stringify(state));
        return;
      }

      if (pathname === "/") {
        const html = await renderHtml(contentRoot, requestUrl.searchParams.get("file") || "");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (pathname.startsWith("/content/")) {
        const relativeAssetPath = decodeURIComponent(pathname.replace(/^\/content\//, ""));
        const assetFile = path.join(contentRoot, relativeAssetPath);
        const normalized = path.normalize(assetFile);
        if (!isInsidePath(contentRoot, normalized)) {
          res.writeHead(403);
          res.end("Forbidden");
          return;
        }
        const body = await fsp.readFile(normalized);
        res.writeHead(200, { "content-type": getContentType(normalized) });
        res.end(body);
        return;
      }

      if (pathname.startsWith("/vendor/")) {
        if (pathname.startsWith("/vendor/mathjax/")) {
          const mathJaxFile = path.join(MATHJAX_DIST_DIR, pathname.replace(/^\/vendor\/mathjax\//, ""));
          const normalized = path.normalize(mathJaxFile);
          if (!normalized.startsWith(MATHJAX_DIST_DIR)) {
            res.writeHead(403);
            res.end("Forbidden");
            return;
          }
          const body = await fsp.readFile(normalized);
          res.writeHead(200, { "content-type": getContentType(normalized) });
          res.end(body);
          return;
        }

        res.writeHead(404);
        res.end("Not found");
        return;
      }

      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not Found");
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(`[mathlog-preview] ${error.message}`);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to determine server address.");
  }

  return {
    server,
    url: `http://${host}:${address.port}/`,
  };
}

async function runServe(args) {
  if (args.length > 5) {
    throw new Error(usage());
  }
  const { contentRoot, host, port } = parseServeArgs(args);
  await ensureContentRoot(contentRoot);
  const { server, url } = await createServer({ contentRoot, host, port });

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
      console.error(`[mathlog-preview] ${error.message}`);
      process.exitCode = 1;
    });
  };

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  shortcutBinding = bindServeShortcuts({
    contentRoot,
    url,
    onQuit: async () => {
      await closeServer();
    },
  });

  printServeSummary({ contentRoot, url, interactive: shortcutBinding.interactive });

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

async function runNew(args) {
  if (args.length < 1 || args.length > 2) {
    throw new Error(usage());
  }
  const contentRoot = path.resolve(process.cwd(), args[1] || DEFAULT_CONTENT_DIR);
  const article = await createArticleFile(contentRoot, args[0]);
  console.log(`Created article: ${article.filePath}`);
}

async function runInit(args) {
  if (args.length > 1) {
    throw new Error(usage());
  }
  const contentRoot = path.resolve(process.cwd(), args[0] || DEFAULT_CONTENT_DIR);
  const result = await initializeContentRoot(contentRoot);
  console.log("Initialized Mathlog preview project.");
  console.log(`Content directory: ${result.contentRoot}`);
  if (result.createdSample) {
    console.log(`Created sample article: ${result.createdSample}`);
  }
  console.log("Next: npm run preview");
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "init":
      await runInit(args);
      return;
    case "preview":
    case "serve":
      await runServe(args);
      return;
    case "new":
      await runNew(args);
      return;
    case "version":
    case "--version":
    case "-v":
      console.log(loadPackageVersion());
      return;
    case "help":
    case "--help":
    case "-h":
      console.log(usage());
      return;
    default:
      throw new Error(usage());
  }
}

main().catch(async (error) => {
  await printFatalError(error);
  process.exit(1);
});
