import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { tex2svgHtml } from "mathxyjax3";
import {
  buildActiveMathJaxMacros,
  createId,
  normalizeMacroArgs,
  normalizeMacroCommand,
  normalizeMacroLibrary,
  normalizeMacroPackageId,
  readMacroLibrary,
  writeMacroLibrary,
} from "./macro-library.js";
import {
  CONFIG_FILE_NAME,
  DEFAULT_CONTENT_DIR,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DOCS_ROOT,
  MATHJAX_DIST_DIR,
} from "./paths.js";
import { bindServeShortcuts } from "./shortcuts.js";
import { createHtmlDocument } from "./html-document.js";

const require = createRequire(import.meta.url);
const MarkdownIt = require("markdown-it");
const markdownItDeflist = require("markdown-it-deflist");
const hljs = require("highlight.js");
const multimdTable = require("markdown-it-multimd-table");

const HIGHLIGHT_THEME_FILE = require.resolve("highlight.js/styles/github.css");
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
    "  mathlog preview [content-dir] [--host localhost] [--port 3141]",
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

export async function printFatalError(error) {
  const details = await formatErrorDetails(error);
  console.error(`[mathlog-preview] ${details}`);
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

function escapeScriptJson(value) {
  return JSON.stringify(value).replaceAll("</", "<\\/");
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
        title: (meta as any).title || path.parse(entry.name).name,
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

async function loadHighlightCss() {
  if (!highlightCssPromise) {
    highlightCssPromise = fsp.readFile(HIGHLIGHT_THEME_FILE, "utf8");
  }
  return highlightCssPromise;
}

async function renderHtml(contentRoot, selectedPath) {
  const articles = await listMarkdownFiles(contentRoot);
  const macroLibrary = await readMacroLibrary(contentRoot);
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
  return await createHtmlDocument({
    title: selectedArticle ? selectedArticle.title : "mathlog-preview",
    body,
    highlightCss,
    articles,
    selectedPath: selectedArticle?.relativePath || "",
    contentRoot,
    macroLibrary,
    officialLinks: OFFICIAL_LINKS,
  });
}

async function renderMacrosHtml(contentRoot) {
  const [macroLibrary, highlightCss] = await Promise.all([
    readMacroLibrary(contentRoot),
    loadHighlightCss(),
  ]);
  return await createHtmlDocument({
    title: "ユーザーマクロの設定",
    body: "",
    highlightCss,
    articles: [],
    selectedPath: "",
    contentRoot,
    macroLibrary,
    macroOnly: true,
    officialLinks: OFFICIAL_LINKS,
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

async function createServer({ contentRoot, host = DEFAULT_HOST, port = DEFAULT_PORT }: { contentRoot: string; host?: string; port?: number }) {
  const readJsonBody = async (req) => {
    let rawBody = "";
    req.setEncoding("utf8");
    for await (const chunk of req) {
      rawBody += chunk;
      if (rawBody.length > 16384) {
        throw new Error("Request body is too large.");
      }
    }
    return JSON.parse(rawBody || "{}");
  };

  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || "/", "http://localhost");
    const pathname = requestUrl.pathname;

    try {
      if (pathname === "/api/articles" && req.method === "POST") {
        const payload = await readJsonBody(req);
        const article = await createArticleFile(contentRoot, payload.basename);
        res.writeHead(201, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(article));
        return;
      }

      if (pathname === "/api/macros" && req.method === "GET") {
        const library = await readMacroLibrary(contentRoot);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(library));
        return;
      }

      if (pathname === "/api/macros" && req.method === "POST") {
        const payload = await readJsonBody(req);
        const library = await readMacroLibrary(contentRoot);
        const macro = {
          id: createId("macro"),
          command: normalizeMacroCommand(payload.command),
          args: normalizeMacroArgs(payload.args),
          body: String(payload.body || "").trim(),
          packageId: normalizeMacroPackageId(payload.packageId),
        };
        if (!macro.body) {
          throw new Error("Macro formula is required.");
        }
        if (macro.packageId && !library.packages.some((pkg) => pkg.id === macro.packageId)) {
          throw new Error("Macro package was not found.");
        }
        library.macros = library.macros.filter((item) => item.command !== macro.command);
        library.macros.push(macro);
        const saved = await writeMacroLibrary(contentRoot, library);
        res.writeHead(201, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(saved));
        return;
      }

      const macroMatch = pathname.match(/^\/api\/macros\/([^/]+)$/);
      if (macroMatch && (req.method === "PATCH" || req.method === "DELETE")) {
        const id = decodeURIComponent(macroMatch[1]);
        const library = await readMacroLibrary(contentRoot);
        const index = library.macros.findIndex((macro) => macro.id === id);
        if (index === -1) {
          res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Macro was not found." }));
          return;
        }
        if (req.method === "DELETE") {
          library.macros.splice(index, 1);
        } else {
          const payload = await readJsonBody(req);
          const next = {
            ...library.macros[index],
            command: normalizeMacroCommand(payload.command),
            args: normalizeMacroArgs(payload.args),
            body: String(payload.body || "").trim(),
            packageId: normalizeMacroPackageId(payload.packageId),
          };
          if (!next.body) {
            throw new Error("Macro formula is required.");
          }
          if (next.packageId && !library.packages.some((pkg) => pkg.id === next.packageId)) {
            throw new Error("Macro package was not found.");
          }
          library.macros[index] = next;
        }
        const saved = await writeMacroLibrary(contentRoot, library);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(saved));
        return;
      }

      if (pathname === "/api/macro-packages" && req.method === "POST") {
        const payload = await readJsonBody(req);
        const name = String(payload.name || "").trim();
        if (!name) {
          throw new Error("Package name is required.");
        }
        const library = await readMacroLibrary(contentRoot);
        library.packages.push({ id: createId("pkg"), name, enabled: true });
        const saved = await writeMacroLibrary(contentRoot, library);
        res.writeHead(201, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(saved));
        return;
      }

      const packageMatch = pathname.match(/^\/api\/macro-packages\/([^/]+)$/);
      if (packageMatch && (req.method === "PATCH" || req.method === "DELETE")) {
        const id = decodeURIComponent(packageMatch[1]);
        const library = await readMacroLibrary(contentRoot);
        const index = library.packages.findIndex((pkg) => pkg.id === id);
        if (index === -1) {
          res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Package was not found." }));
          return;
        }
        if (req.method === "DELETE") {
          library.packages.splice(index, 1);
          for (const macro of library.macros) {
            if (macro.packageId === id) {
              macro.packageId = "";
            }
          }
        } else {
          const payload = await readJsonBody(req);
          if (Object.hasOwn(payload, "name")) {
            const name = String(payload.name || "").trim();
            if (!name) {
              throw new Error("Package name is required.");
            }
            library.packages[index].name = name;
          }
          if (Object.hasOwn(payload, "enabled")) {
            library.packages[index].enabled = Boolean(payload.enabled);
          }
        }
        const saved = await writeMacroLibrary(contentRoot, library);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(saved));
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

      if (pathname === "/macros") {
        const html = await renderMacrosHtml(contentRoot);
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
    } catch (error: any) {
      if (pathname.startsWith("/api/")) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: error.message }));
        return;
      }
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(`[mathlog-preview] ${error.message}`);
    }
  });

  await new Promise<void>((resolve, reject) => {
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
    await new Promise<void>((resolve, reject) => {
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
    onRestart: async () => {
      resetRenderState();
      console.log("Restarted preview renderer.");
      printServeSummary({ contentRoot, url, interactive: true });
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

export async function main() {
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
