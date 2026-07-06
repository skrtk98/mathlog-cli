import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const SCRIPT_FILE = path.resolve("scripts/mathlog-preview.mjs");

async function startPreviewServer(contentDir) {
  const args = [SCRIPT_FILE, "serve"];
  if (contentDir) {
    args.push(contentDir);
  }
  args.push("--port", "0");
  const child = spawn(
    process.execPath,
    args,
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
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
    if (match) {
      return {
        child,
        url: match[0],
        getStdout() {
          return stdout;
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
  const server = await startPreviewServer();
  try {
    const response = await fetch(server.url);
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.match(html, /<a href="https:\/\/mathlog.info\/"[^>]*>Mathlog<\/a>/);
    assert.match(html, /<a href="https:\/\/opthub.notion.site\/1ca318bcf9ac8195ad0af2a1ae8319e0"[^>]*>公式リファレンス<\/a>/);
    assert.match(html, /class="article-nav__link article-nav__link--active" href="\/\?file=mathlog-syntax.md"/);
    assert.match(html, /<span>Mathlog syntax preview<\/span><small>mathlog-syntax.md<\/small>/);
    assert.match(html, /<div class="preview-meta">mathlog-syntax.md <span class="preview-meta__badge">syntax<\/span><\/div>/);
    assert.doesNotMatch(html, /title: Mathlog syntax preview/);
    assert.match(html, /<h2 id="mathlog-syntax-preview">Mathlog syntax preview<\/h2>/);
    assert.match(html, /<h3 id="heading-label">ラベル付き見出し<\/h3>/);
    assert.match(html, /class="mathlog-math mathlog-math--inline">\\\(x_i&gt;0\\\)<\/span>/);
    assert.match(html, /class="mathlog-box mathlog-box--def" id="trig-def"/);
    assert.match(html, /class="mathlog-reference" href="#trig-def">定義 1 三角関数<\/a>/);
    assert.match(html, /<img src="https:\/\/example.com\/image.png" alt="dummy image" style="max-width: 500px; width: 100%;">/);
    assert.match(html, /<img src="\/content\/assets\/sample.svg" alt="local svg" style="max-width: 240px; width: 100%;">/);
    assert.match(html, /<a href="\/\?file=related.md">関連ページ<\/a>/);
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
  assert.deepEqual(config, { contentDir: "public", host: "localhost", port: 8888 });
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
    assert.match(html, /<div class="preview-meta">second.md<\/div>/);
    assert.match(html, /<h2 id="second">second<\/h2>/);
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
