import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ChildProcess } from "node:child_process";

const SCRIPT_FILE = path.resolve("dist/main.js");

async function createRepresentativeContentDir(prefix = "mathlog-representative-") {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  const contentDir = path.join(root, "public");
  await fsp.mkdir(path.join(contentDir, "assets"), { recursive: true });
  await fsp.writeFile(
    path.join(contentDir, "mathlog-syntax.md"),
    [
      "---",
      "title: Mathlog syntax preview",
      "tags:",
      "  - syntax",
      "private: false",
      "---",
      "",
      "# Mathlog syntax preview",
      "",
      "## ラベル付き見出し [heading-label]",
      "",
      "[この見出しへのリンク](#heading-label)",
      "",
      "ここで、$x_i>0$ かつ $a \\ne 0$ とします。",
      "",
      "**太字赤色**、*斜体*、***斜体太字赤色***、~~取り消し~~。",
      "",
      '<span class="fw-bold">赤字にしない太字</span>',
      "",
      '<div class="box p-4"><blockquote>HTML内の引用</blockquote></div>',
      "",
      "![dummy image](https://example.com/image.png =500)",
      "",
      "![local svg](assets/sample.svg =240)",
      "",
      "[関連ページ](related.md)",
      "",
      "https://mathlog.info/",
      "",
      "(1) 丸括弧の番号あり",
      "\t- 下位項目1",
      "\t- 下位項目2",
      "(2) 2つ目",
      "",
      "$$",
      "\\TextCenter",
      "\\sin(\\alpha+\\beta) = \\sin(\\alpha)\\cos(\\beta)+\\cos(\\alpha)\\sin(\\beta)",
      "$$",
      "",
      "\\begin{eqnarray}",
      "f(x)",
      "&=& x^2 - 1 \\\\",
      "&=& (x-1)(x+1)",
      "\\end{eqnarray}",
      "",
      "\\begin{xy}",
      "\\xymatrix{A \\ar[r]^f & B}",
      "\\end{xy}",
      "",
      "&&&def 三角関数 [trig-def]",
      "三角関数は角に対して定まる関数です。",
      "",
      "- $\\sin x$",
      "- $\\cos x$",
      "&&&",
      "",
      "&&&thm 加法定理 [addition-theorem]",
      "任意の実数 $\\alpha,\\beta$ について、[[trig-def]] の記法を使うと次が成り立ちます。",
      "",
      "$$",
      "\\sin(\\alpha+\\beta) = \\sin\\alpha\\cos\\beta+\\cos\\alpha\\sin\\beta",
      "$$",
      "&&&",
      "",
      "&&&prf",
      "[[addition-theorem]] は単位円上の回転から従います。",
      "&&&",
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.writeFile(
    path.join(contentDir, "related.md"),
    [
      "---",
      "title: 関連ページ",
      "tags:",
      "  - example",
      "private: false",
      "---",
      "",
      "# 関連ページ",
      "",
      "これは記事間リンクの確認用です。",
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.writeFile(
    path.join(contentDir, "assets", "sample.svg"),
    [
      '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80" viewBox="0 0 240 80" role="img" aria-label="sample">',
      '  <rect width="240" height="80" rx="8" fill="#f6f8fa"/>',
      '  <path d="M24 56 L64 24 L104 56 L144 24 L184 56 L216 32" fill="none" stroke="#1f883d" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>',
      '  <text x="24" y="22" font-family="sans-serif" font-size="14" fill="#57606a">Mathlog preview asset</text>',
      "</svg>",
      "",
    ].join("\n"),
    "utf8",
  );
  return contentDir;
}

type PreviewServer = {
  child: ChildProcess;
  url: string;
  getStdout(): string;
  writeInput(input: string): void;
  stop(): Promise<void>;
};

type PreviewServerOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: "ignore" | "pipe";
};

async function startPreviewServer(contentDir?: string, options: PreviewServerOptions = {}): Promise<PreviewServer> {
  const args = [SCRIPT_FILE, "serve"];
  if (contentDir) {
    args.push(contentDir);
  }
  args.push("--port", "0");
  const child = spawn(
    process.execPath,
    args,
    {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      stdio: [options.stdin || "ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const match = stdout.match(/http:\/\/localhost:(\d+)\//);
    if (match && /^Content directory: /m.test(stdout)) {
      return {
        child,
        url: match[0],
        getStdout() {
          return stdout;
        },
        writeInput(input) {
          child.stdin?.write(input);
        },
        async stop() {
          if (child.exitCode !== null) {
            return;
          }
          child.kill("SIGTERM");
          await once(child, "exit");
        },
      };
    }
    if (child.exitCode !== null) {
      throw new Error(`preview server exited early\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  child.kill("SIGTERM");
  throw new Error(`preview server did not print a URL\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

test("prints plain preview startup output", async () => {
  const server = await startPreviewServer();
  try {
    const stdout = server.getStdout();
    assert.match(stdout, /^Mathlog preview: http:\/\/localhost:\d+\//m);
    assert.match(stdout, /^Content directory: .+\/public$/m);
    assert.doesNotMatch(stdout, /[●■▲]/);
    assert.doesNotMatch(stdout, /\u001B\[/);
  } finally {
    await server.stop();
  }
});

test("renders representative Mathlog syntax", async () => {
  const contentDir = await createRepresentativeContentDir();
  const server = await startPreviewServer(contentDir);
  try {
    const response = await fetch(server.url);
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.match(html, /<a href="https:\/\/mathlog.info\/"[^>]*>Mathlog<\/a>/);
    assert.match(html, /<a href="https:\/\/opthub.notion.site\/1ca318bcf9ac8195ad0af2a1ae8319e0"[^>]*>公式リファレンス<\/a>/);
    assert.match(html, /class="article-nav__link article-nav__link--active" href="\/\?file=mathlog-syntax.md"/);
    assert.match(html, /<span>Mathlog syntax preview<\/span><small>mathlog-syntax.md<\/small>/);
    assert.match(html, /<header class="preview-article-header">\s*<h1>Mathlog syntax preview<\/h1>/);
    assert.match(html, /<div class="preview-meta">mathlog-syntax.md <span class="preview-meta__badge">syntax<\/span><\/div>/);
    assert.doesNotMatch(html, /title: Mathlog syntax preview/);
    assert.match(html, /<h2 id="mathlog-syntax-preview">Mathlog syntax preview<\/h2>/);
    assert.match(html, /<h3 id="heading-label">ラベル付き見出し<\/h3>/);
    assert.match(html, /class="mathlog-math mathlog-math--inline">\\\(x_i&gt;0\\\)<\/span>/);
    assert.match(html, /\.fw-bold \{\s*color: inherit;\s*font-weight: 700;\s*\}/);
    assert.match(html, /<span class="fw-bold">赤字にしない太字<\/span>/);
    assert.match(html, /<div class="box p-4"><blockquote>HTML内の引用<\/blockquote><\/div>/);
    assert.match(html, /mathlog-math--server/);
    assert.match(html, /<mjx-container/);
    assert.match(html, /class="mathlog-box mathlog-box--def" id="trig-def"/);
    assert.match(html, /class="mathlog-reference" href="#trig-def">定義 1 三角関数<\/a>/);
    assert.match(html, /<img src="https:\/\/example.com\/image.png" alt="dummy image" style="max-width: 500px; width: 100%;">/);
    assert.match(html, /<img src="\/content\/assets\/sample.svg" alt="local svg" style="max-width: 240px; width: 100%;">/);
    assert.match(html, /<a href="\/\?file=related.md">関連ページ<\/a>/);
    assert.match(html, /<a href="https:\/\/mathlog.info\/" target="_blank" rel="noreferrer noopener">https:\/\/mathlog.info\/<\/a>/);
    assert.match(html, /<span class="mathlog-list__marker">\(1\)<\/span>/);
    assert.match(html, /<ul>\s*<li>下位項目1<\/li>\s*<li>下位項目2<\/li>\s*<\/ul>/);

    const assetResponse = await fetch(new URL("/content/assets/sample.svg", server.url));
    assert.equal(assetResponse.status, 200);
    assert.equal(assetResponse.headers.get("content-type"), "image/svg+xml; charset=utf-8");

    const forbiddenResponse = await fetch(new URL("/content/assets%2f..%2f..%2fpackage.json", server.url));
    assert.equal(forbiddenResponse.status, 403);
  } finally {
    await server.stop();
  }
});

test("creates an article from the CLI", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mathlog-cli-"));
  const contentDir = path.join(root, "public");
  const child = spawn(
    process.execPath,
    [SCRIPT_FILE, "new", "newArticle001", contentDir],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const [code] = await once(child, "exit");
  assert.equal(code, 0);
  const markdown = await fsp.readFile(path.join(contentDir, "newArticle001.md"), "utf8");
  assert.match(markdown, /^title: newArticle001/m);
  assert.match(markdown, /^# newArticle001/m);
});

test("creates an article with a Japanese basename", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mathlog-cli-ja-"));
  const contentDir = path.join(root, "public");
  const child = spawn(
    process.execPath,
    [SCRIPT_FILE, "new", "数学 ノート.md", contentDir],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const [code] = await once(child, "exit");
  assert.equal(code, 0);
  const markdown = await fsp.readFile(path.join(contentDir, "数学-ノート.md"), "utf8");
  assert.match(markdown, /^title: 数学-ノート/m);
  assert.match(markdown, /^# 数学-ノート/m);
});

test("initializes a content directory", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mathlog-init-"));
  const contentDir = path.join(root, "public");
  const child = spawn(
    process.execPath,
    [SCRIPT_FILE, "init", "public"],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const [code] = await once(child, "exit");
  assert.equal(code, 0);
  const markdown = await fsp.readFile(path.join(contentDir, "welcome.md"), "utf8");
  const config = JSON.parse(await fsp.readFile(path.join(root, "mathlog.config.json"), "utf8"));
  assert.deepEqual(config, { contentDir: "public", host: "localhost", port: 3141 });
  assert.match(markdown, /^title: welcome/m);
  assert.match(markdown, /^# welcome/m);
});

test("creates an article from the preview API", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mathlog-preview-"));
  const contentDir = path.join(root, "public");
  await fsp.mkdir(contentDir, { recursive: true });
  await fsp.writeFile(path.join(contentDir, "first.md"), "# first\n", "utf8");

  const server = await startPreviewServer(contentDir);
  try {
    const response = await fetch(new URL("/api/articles", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ basename: "second" }),
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.relativePath, "second.md");

    const html = await fetch(new URL("/?file=second.md", server.url)).then((res) => res.text());
    assert.match(html, /<header class="preview-article-header">\s*<h1>second<\/h1>/);
    assert.match(html, /<div class="preview-meta">second.md<\/div>/);
    assert.match(html, /<h2 id="second">second<\/h2>/);
  } finally {
    await server.stop();
  }
});

test("parses CRLF front matter with inline tags", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mathlog-front-matter-"));
  const contentDir = path.join(root, "public");
  await fsp.mkdir(contentDir, { recursive: true });
  await fsp.writeFile(
    path.join(contentDir, "meta.md"),
    [
      "---",
      'title: "CRLF meta"',
      "tags: [math, topology]",
      "private: true",
      "---",
      "# body",
      "",
    ].join("\r\n"),
    "utf8",
  );

  const server = await startPreviewServer(contentDir);
  try {
    const html = await fetch(server.url).then((res) => res.text());
    assert.match(html, /<span>CRLF meta<span class="article-nav__badge">private<\/span><\/span><small>meta.md<\/small>/);
    assert.match(html, /<header class="preview-article-header">\s*<h1>CRLF meta<\/h1>/);
    assert.match(html, /<div class="preview-meta">meta.md <span class="preview-meta__badge">private<\/span> <span class="preview-meta__badge">math<\/span> <span class="preview-meta__badge">topology<\/span><\/div>/);
    assert.doesNotMatch(html, /title: &quot;CRLF meta&quot;/);
  } finally {
    await server.stop();
  }
});

test("serves terminal shortcut input", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mathlog-shortcuts-"));
  const contentDir = path.join(root, "public");
  await fsp.mkdir(contentDir, { recursive: true });
  await fsp.writeFile(path.join(contentDir, "shortcut.md"), "# shortcut\n", "utf8");

  const server = await startPreviewServer(contentDir, {
    stdin: "pipe",
    env: { MATHLOG_PREVIEW_FORCE_SHORTCUTS: "1" },
  });
  server.writeInput("r");
  const deadline = Date.now() + 1000;
  while (!/Restarted preview renderer\./.test(server.getStdout()) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.match(server.getStdout(), /Restarted preview renderer\./);
  server.writeInput("q");
  const [code] = await once(server.child, "exit");
  assert.equal(code, 0);
  assert.match(server.getStdout(), /Shortcuts: r restart, o open, e edit, q quit/);
});

test("manages Mathlog macros and packages through the preview API", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mathlog-macros-"));
  const contentDir = path.join(root, "public");
  await fsp.mkdir(contentDir, { recursive: true });
  await fsp.writeFile(path.join(contentDir, "macro.md"), "Custom macro: $\\abs{x}$\n", "utf8");

  const server = await startPreviewServer(contentDir, { cwd: root });
  try {
    const emptyHtml = await fetch(server.url).then((res) => res.text());
    assert.match(emptyHtml, /href="\/macros" target="_blank"[^>]*>マクロ設定<\/a>/);
    assert.doesNotMatch(emptyHtml, /<section class="macro-manager" data-macro-manager>/);
    assert.doesNotMatch(emptyHtml, /記号/);
    assert.match(emptyHtml, /macros: \{\}/);

    const macrosPage = await fetch(new URL("/macros", server.url)).then((res) => res.text());
    assert.match(macrosPage, /<section class="macro-manager" data-macro-manager>/);
    assert.match(macrosPage, /ユーザーマクロの設定/);
    assert.doesNotMatch(macrosPage, /記号/);

    const packageResponse = await fetch(new URL("/api/macro-packages", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "local" }),
    });
    assert.equal(packageResponse.status, 201);
    const withPackage = await packageResponse.json();
    const localPackage = withPackage.packages.find((item) => item.name === "local");
    assert.equal(localPackage.enabled, true);

    const macroResponse = await fetch(new URL("/api/macros", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "\\abs",
        args: 1,
        body: "\\left| #1 \\right|",
        packageId: localPackage.id,
      }),
    });
    assert.equal(macroResponse.status, 201);
    const withMacro = await macroResponse.json();
    const localMacro = withMacro.macros.find((item) => item.command === "\\abs");
    assert.equal(localMacro.args, 1);

    const html = await fetch(server.url).then((res) => res.text());
    assert.doesNotMatch(html, /<section class="macro-manager" data-macro-manager>/);
    assert.match(html, /macros: \{"abs":\["\\\\left\| #1 \\\\right\|",1\]\}/);

    const disableResponse = await fetch(new URL(`/api/macro-packages/${encodeURIComponent(localPackage.id)}`, server.url), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(disableResponse.status, 200);
    const disabledHtml = await fetch(server.url).then((res) => res.text());
    assert.match(disabledHtml, /macros: \{\}/);

    const deletePackageResponse = await fetch(new URL(`/api/macro-packages/${encodeURIComponent(localPackage.id)}`, server.url), {
      method: "DELETE",
    });
    assert.equal(deletePackageResponse.status, 200);
    const afterPackageDelete = await deletePackageResponse.json();
    assert.equal(afterPackageDelete.packages.length, 0);
    assert.equal(afterPackageDelete.macros[0].packageId, "");

    const deleteMacroResponse = await fetch(new URL(`/api/macros/${encodeURIComponent(localMacro.id)}`, server.url), {
      method: "DELETE",
    });
    assert.equal(deleteMacroResponse.status, 200);
    const afterMacroDelete = await deleteMacroResponse.json();
    assert.equal(afterMacroDelete.macros.length, 0);

    const persisted = JSON.parse(await fsp.readFile(path.join(contentDir, "mathlog.macros.json"), "utf8"));
    assert.deepEqual(persisted, { version: 1, packages: [], macros: [] });
  } finally {
    await server.stop();
  }
});

test("loads project user macros into the Web UI and preview", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mathlog-macros-"));
  const contentDir = path.join(root, "public");
  await fsp.mkdir(contentDir, { recursive: true });
  await fsp.writeFile(path.join(contentDir, "macro.md"), "User macro: $\\abs{x}$\n", "utf8");
  await fsp.writeFile(
    path.join(contentDir, "mathlog.macros.json"),
    JSON.stringify(
      {
        version: 1,
        packages: [{ id: "symbols", name: "記号", enabled: true }],
        macros: [
          {
            id: "abs",
            command: "\\abs",
            args: 1,
            body: "\\left| #1 \\right|",
            packageId: "symbols",
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  const server = await startPreviewServer(contentDir, { cwd: root });
  try {
    const preview = await fetch(server.url).then((res) => res.text());
    assert.match(preview, /macros: \{"abs":\["\\\\left\| #1 \\\\right\|",1\]/);
    assert.doesNotMatch(preview, /<section class="macro-manager" data-macro-manager>/);

    const macrosPage = await fetch(new URL("/macros", server.url)).then((res) => res.text());
    assert.match(macrosPage, /記号/);
    assert.match(macrosPage, /\\abs/);
  } finally {
    await server.stop();
  }
});

test("renders an empty project without a hard-coded public directory message", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mathlog-empty-"));
  const contentDir = path.join(root, "articles");
  await fsp.mkdir(contentDir, { recursive: true });

  const server = await startPreviewServer(contentDir);
  try {
    const html = await fetch(server.url).then((res) => res.text());
    assert.match(html, /No markdown files\./);
    assert.match(html, /<h2 id="記事がありません">記事がありません<\/h2>/);
    assert.match(html, /「新規記事作成」から Markdown ファイルを作成できます。/);
    assert.doesNotMatch(html, /No markdown files in public/);
    assert.doesNotMatch(html, /Create Markdown files under `public`/);
  } finally {
    await server.stop();
  }
});

test("renders non-Mathlog diagram fences as code blocks", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mathlog-code-fence-"));
  const contentDir = path.join(root, "public");
  await fsp.mkdir(contentDir, { recursive: true });
  await fsp.writeFile(
    path.join(contentDir, "diagram.md"),
    ["# diagram", "", "```mermaid", "graph TD", "  A --> B", "```", ""].join("\n"),
    "utf8",
  );

  const server = await startPreviewServer(contentDir);
  try {
    const html = await fetch(server.url).then((res) => res.text());
    assert.match(html, /<div class="code-block" data-language="mermaid">/);
    assert.match(html, /graph TD/);
    assert.doesNotMatch(html, /class="mermaid"/);
    assert.doesNotMatch(html, /data-save-svg/);
  } finally {
    await server.stop();
  }
});

test("applies Mathlog alignment commands inside begin environments", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mathlog-begin-align-"));
  const contentDir = path.join(root, "public");
  await fsp.mkdir(contentDir, { recursive: true });
  await fsp.writeFile(
    path.join(contentDir, "align.md"),
    [
      "# align",
      "",
      "\\begin{eqnarray}\\TextRight",
      "f(x)",
      "&=& x^2 - 1",
      "\\end{eqnarray}",
      "",
    ].join("\n"),
    "utf8",
  );

  const server = await startPreviewServer(contentDir);
  try {
    const html = await fetch(server.url).then((res) => res.text());
    assert.match(html, /class="mathlog-math mathlog-math--block mathlog-math--right"/);
    assert.match(html, /\\begin\{eqnarray\}/);
    assert.doesNotMatch(html, /\\TextRight/);
  } finally {
    await server.stop();
  }
});

test("server-renders XyPic diagrams", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mathlog-xypic-"));
  const contentDir = path.join(root, "public");
  await fsp.mkdir(contentDir, { recursive: true });
  await fsp.writeFile(
    path.join(contentDir, "xypic.md"),
    [
      "# xypic",
      "",
      "\\begin{xy}",
      "\\xymatrix{A \\ar[r]^f & B}",
      "\\end{xy}",
      "",
    ].join("\n"),
    "utf8",
  );

  const server = await startPreviewServer(contentDir);
  try {
    const html = await fetch(server.url).then((res) => res.text());
    assert.match(html, /class="[^"]*mathlog-math--server[^"]*"/);
    assert.match(html, /<mjx-container/);
    assert.match(html, /<svg/);
    assert.doesNotMatch(html, /\\xymatrix/);
  } finally {
    await server.stop();
  }
});

test("renders plain Mathlog boxes with inline closing markers", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mathlog-plain-box-"));
  const contentDir = path.join(root, "public");
  await fsp.mkdir(contentDir, { recursive: true });
  await fsp.writeFile(
    path.join(contentDir, "plain-box.md"),
    [
      "# box",
      "",
      "&&& 補足 [plain-note]",
      "本文末尾で閉じる形式ブロック。&&&",
      "",
      "[[plain-note]]",
      "",
    ].join("\n"),
    "utf8",
  );

  const server = await startPreviewServer(contentDir);
  try {
    const html = await fetch(server.url).then((res) => res.text());
    assert.match(html, /class="mathlog-box mathlog-box--plain" id="plain-note"/);
    assert.match(html, /<div class="mathlog-box__title">補足<\/div>/);
    assert.match(html, /本文末尾で閉じる形式ブロック。/);
    assert.match(html, /class="mathlog-reference" href="#plain-note">補足<\/a>/);
    assert.doesNotMatch(html, /&&&/);
  } finally {
    await server.stop();
  }
});

test("reports content state changes for auto reload", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mathlog-state-"));
  const contentDir = path.join(root, "public");
  await fsp.mkdir(contentDir, { recursive: true });
  const filePath = path.join(contentDir, "state.md");
  await fsp.writeFile(filePath, "# state\n", "utf8");

  const server = await startPreviewServer(contentDir);
  try {
    const before = await fetch(new URL("/api/state", server.url)).then((res) => res.json());
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fsp.writeFile(filePath, "# state\n\nupdated\n", "utf8");
    const after = await fetch(new URL("/api/state", server.url)).then((res) => res.json());
    assert.notEqual(after.version, before.version);
    assert.equal(after.fileCount, before.fileCount);
  } finally {
    await server.stop();
  }
});

test("renders real Mathlog sample articles without visible raw syntax", async (context) => {
  const contentDir = path.resolve("src/sample_data");
  try {
    await fsp.access(contentDir);
  } catch {
    context.skip("src/sample_data is not available");
    return;
  }

  const files = (await fsp.readdir(contentDir))
    .filter((file) => file.endsWith(".md"))
    .sort();
  assert.ok(files.length > 0);

  const server = await startPreviewServer(contentDir);
  try {
    for (const file of files) {
      const html = await fetch(new URL(`/?file=${encodeURIComponent(file)}`, server.url)).then((res) => {
        assert.equal(res.status, 200, file);
        return res.text();
      });
      const visibleHtml = html.replace(/<!--[\s\S]*?-->/g, "");
      assert.doesNotMatch(visibleHtml, /\\xymatrix/, file);
      assert.doesNotMatch(visibleHtml, /\\begin\{xy\}/, file);
      assert.doesNotMatch(visibleHtml, /\\Text(?:Center|Right|Left)/, file);
      assert.doesNotMatch(visibleHtml, /&&&/, file);
      assert.doesNotMatch(visibleHtml, /^title:/m, file);
      assert.doesNotMatch(visibleHtml, /data-mjx-error=/, file);
    }
  } finally {
    await server.stop();
  }
});
