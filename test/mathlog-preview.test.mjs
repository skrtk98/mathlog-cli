import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";

async function startPreviewServer() {
  const child = spawn(
    process.execPath,
    ["scripts/mathlog-preview.mjs", "serve", "--port", "0"],
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

test("renders representative Mathlog syntax", async () => {
  const server = await startPreviewServer();
  try {
    const response = await fetch(server.url);
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.match(html, /<a href="https:\/\/mathlog.info\/"[^>]*>Mathlog<\/a>/);
    assert.match(html, /<a href="https:\/\/opthub.notion.site\/1ca318bcf9ac8195ad0af2a1ae8319e0"[^>]*>公式リファレンス<\/a>/);
    assert.match(html, /class="article-nav__link article-nav__link--active" href="\/\?file=mathlog-syntax.md"/);
    assert.match(html, /<div class="preview-meta">mathlog-syntax.md<\/div>/);
    assert.match(html, /<h2 id="mathlog-syntax-preview">Mathlog syntax preview<\/h2>/);
    assert.match(html, /<h3 id="heading-label">ラベル付き見出し<\/h3>/);
    assert.match(html, /class="mathlog-math mathlog-math--inline">\\\(x_i&gt;0\\\)<\/span>/);
    assert.match(html, /class="mathlog-box mathlog-box--def" id="trig-def"/);
    assert.match(html, /class="mathlog-reference" href="#trig-def">定義 1 三角関数<\/a>/);
    assert.match(html, /<img src="https:\/\/example.com\/image.png" alt="dummy image" style="max-width: 500px; width: 100%;">/);
    assert.match(html, /<span class="mathlog-list__marker">\(1\)<\/span>/);
    assert.match(html, /<ul>\s*<li>下位項目1<\/li>\s*<li>下位項目2<\/li>\s*<\/ul>/);
  } finally {
    await server.stop();
  }
});
