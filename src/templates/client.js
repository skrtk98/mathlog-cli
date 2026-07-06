window.__markdownItRenderReady__ = false;
const macroLibrary = window.__mathlogMacroLibrary__ || { packages: [], macros: [] };

function setActionState(button, label) {
  if (button) button.textContent = label;
}

function escapeClientHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeClientAttribute(value) {
  return escapeClientHtml(value).replaceAll('"', "&quot;");
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
    if (!button || !source || button.dataset.bound === "true") continue;
    button.dataset.bound = "true";
    button.addEventListener("click", async () => {
      try {
        const text = code?.textContent ?? source.textContent ?? "";
        const copied = await writeClipboardText(text);
        if (!copied) throw new Error("Copy command was rejected.");
        setActionState(button, "Copied");
        window.setTimeout(() => setActionState(button, "Copy"), 1500);
      } catch {
        setActionState(button, "Failed");
        window.setTimeout(() => setActionState(button, "Copy"), 1500);
      }
    });
  }
}

function attachNewArticleAction() {
  const button = document.querySelector("[data-new-article]");
  if (!button) return;
  button.addEventListener("click", async () => {
    const basename = window.prompt("記事ファイルのベース名");
    if (!basename) return;
    button.disabled = true;
    try {
      const response = await fetch("/api/articles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ basename }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "記事を作成できませんでした。");
      window.location.href = "/?file=" + encodeURIComponent(payload.relativePath);
    } catch (error) {
      window.alert(error?.message || String(error));
    } finally {
      button.disabled = false;
    }
  });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

function renderMacroManager() {
  const root = document.querySelector("[data-macro-manager]");
  if (!root) return;
  const packageList = root.querySelector("[data-macro-package-list]");
  const macroList = root.querySelector("[data-macro-list]");
  const packageSelect = root.querySelector('select[name="packageId"]');
  const packages = macroLibrary.packages || [];
  const macros = macroLibrary.macros || [];
  packageSelect.innerHTML = '<option value="">指定なし</option>' + packages
    .map((item) => '<option value="' + escapeClientAttribute(item.id) + '">' + escapeClientHtml(item.name) + '</option>')
    .join("");
  packageList.innerHTML = packages.length === 0
    ? '<p>パッケージはありません。</p>'
    : packages.map((item) => '<div class="macro-package-row" data-package-id="' + escapeClientAttribute(item.id) + '"><strong>' + escapeClientHtml(item.name) + '</strong><span>' + (item.enabled ? '有効' : '無効') + '</span><button class="action-button" type="button" data-package-toggle>' + (item.enabled ? '無効化' : '有効化') + '</button><button class="action-button" type="button" data-package-delete>削除</button></div>').join("");
  macroList.innerHTML = macros.length === 0
    ? '<p>マクロはありません。</p>'
    : macros.map((item) => {
        const pkg = packages.find((candidate) => candidate.id === item.packageId);
        const example = item.args > 0 ? item.command + Array.from({ length: item.args }, (_value, index) => "{x" + (index + 1) + "}").join("") : item.command;
        return '<article class="macro-card" data-macro-id="' + escapeClientAttribute(item.id) + '"><strong>' + escapeClientHtml(item.command) + '</strong><div class="macro-card__meta">引数: ' + item.args + ' / パッケージ: ' + escapeClientHtml(pkg?.name || '指定なし') + '</div><code>' + escapeClientHtml(item.body) + '</code><div class="macro-card__meta">使用例: ' + escapeClientHtml(example) + '</div><div class="macro-card__actions"><button class="action-button" type="button" data-macro-edit>編集</button><button class="action-button" type="button" data-macro-delete>削除</button></div></article>';
      }).join("");
}

function attachMacroManager() {
  const root = document.querySelector("[data-macro-manager]");
  if (!root) return;
  const form = root.querySelector("[data-macro-form]");
  const packageForm = root.querySelector("[data-macro-package-form]");
  root.querySelector("[data-macro-reload]")?.addEventListener("click", () => window.location.reload());
  root.querySelector("[data-macro-cancel]")?.addEventListener("click", () => form.reset());
  root.querySelector("[data-macro-import-user-preset]")?.addEventListener("click", async () => {
    await requestJson("/api/macros/import-user-preset", { method: "POST" });
    window.location.reload();
  });
  packageForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = new FormData(packageForm).get("name");
    await requestJson("/api/macro-packages", { method: "POST", body: JSON.stringify({ name }) });
    window.location.reload();
  });
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const id = data.id;
    const url = id ? "/api/macros/" + encodeURIComponent(id) : "/api/macros";
    await requestJson(url, { method: id ? "PATCH" : "POST", body: JSON.stringify(data) });
    window.location.reload();
  });
  root.addEventListener("click", async (event) => {
    const target = event.target;
    const macroCard = target.closest?.("[data-macro-id]");
    const packageRow = target.closest?.("[data-package-id]");
    if (target.matches?.("[data-macro-edit]") && macroCard) {
      const macro = macroLibrary.macros.find((item) => item.id === macroCard.dataset.macroId);
      if (macro) {
        form.elements.id.value = macro.id;
        form.elements.command.value = macro.command;
        form.elements.args.value = String(macro.args);
        form.elements.body.value = macro.body;
        form.elements.packageId.value = macro.packageId || "";
      }
    } else if (target.matches?.("[data-macro-delete]") && macroCard) {
      await requestJson("/api/macros/" + encodeURIComponent(macroCard.dataset.macroId), { method: "DELETE" });
      window.location.reload();
    } else if (target.matches?.("[data-package-toggle]") && packageRow) {
      const pkg = macroLibrary.packages.find((item) => item.id === packageRow.dataset.packageId);
      await requestJson("/api/macro-packages/" + encodeURIComponent(packageRow.dataset.packageId), { method: "PATCH", body: JSON.stringify({ enabled: !pkg?.enabled }) });
      window.location.reload();
    } else if (target.matches?.("[data-package-delete]") && packageRow) {
      await requestJson("/api/macro-packages/" + encodeURIComponent(packageRow.dataset.packageId), { method: "DELETE" });
      window.location.reload();
    }
  });
  renderMacroManager();
}

function attachAutoReload() {
  let currentVersion = "";
  const check = async () => {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (!response.ok) return;
      const state = await response.json();
      if (!currentVersion) {
        currentVersion = state.version || "";
        return;
      }
      if (state.version && state.version !== currentVersion) window.location.reload();
    } catch {
      // Keep preview usable even while files are being edited.
    }
  };
  window.setInterval(check, 1500);
  check();
}

async function main() {
  const mathRoot = document.querySelector(".markdown-body");
  if (mathRoot && window.MathJax?.typesetPromise) {
    await window.MathJax.typesetPromise([mathRoot]);
  }
  attachCodeActions();
  attachNewArticleAction();
  attachMacroManager();
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
