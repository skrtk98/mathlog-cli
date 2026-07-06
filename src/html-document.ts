import path from "node:path";
import { buildActiveMathJaxMacros, normalizeMacroLibrary, type MacroLibrary } from "./macro-library.js";
import { DOCS_ROOT } from "./paths.js";
import { loadTemplate } from "./template-loader.js";

type ArticleSummary = {
  relativePath: string;
  title: string;
  meta?: {
    private?: boolean;
    tags?: string[];
  };
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

export function escapeScriptJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("</", "<\\/");
}

export function renderOfficialLinks(officialLinks: string[][]): string {
  return officialLinks
    .map(([label, href]) => `<a href="${escapeAttribute(href)}" target="_blank" rel="noreferrer noopener">${escapeHtml(label)}</a>`)
    .join("");
}

export function renderArticleNav(articles: ArticleSummary[], selectedPath: string): string {
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

export function renderArticleMeta(selectedPath: string, meta: ArticleSummary["meta"]): string {
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

export function renderPreviewHeader(selectedArticle: ArticleSummary | null): string {
  if (!selectedArticle) {
    return "";
  }
  return `<header class="preview-article-header">
          <h1>${escapeHtml(selectedArticle.title)}</h1>
          <div class="preview-meta">${renderArticleMeta(selectedArticle.relativePath, selectedArticle.meta || {})}</div>
        </header>`;
}

export function renderMacroManager(library: MacroLibrary): string {
  const packageOptions = library.packages
    .map((pkg) => `<option value="${escapeAttribute(pkg.id)}">${escapeHtml(pkg.name)}</option>`)
    .join("");
  return `<section class="macro-manager" data-macro-manager>
        <div class="macro-manager__header">
          <div>
            <h1>標準のマクロの設定</h1>
            <p>Mathlog 互換の TeX マクロを登録します。標準マクロは必要なときだけ読み込みます。</p>
          </div>
          <a class="action-button" href="/">プレビューへ戻る</a>
        </div>
        <div class="macro-manager__grid">
          <div class="macro-panel">
            <span class="macro-mode">追加モード</span>
            <form class="macro-form" data-macro-form>
              <input name="id" type="hidden">
              <label>コマンド名<span class="macro-command-input"><span>¥</span><input name="command" type="text" placeholder="abs" required></span></label>
              <label>引数の個数<select name="args">${Array.from({ length: 10 }, (_item, index) => `<option value="${index}">${index}</option>`).join("")}</select></label>
              <label>数式<input name="body" type="text" placeholder="\\left| #1 \\right|" required></label>
              <label>パッケージ<select name="packageId"><option value="">指定なし</option>${packageOptions}</select></label>
              <div class="macro-form__actions">
                <button class="new-article-button" type="submit">保存</button>
                <button class="action-button" type="button" data-macro-cancel>キャンセル</button>
              </div>
            </form>
            <hr>
            <form class="macro-package-form" data-macro-package-form>
              <input name="name" type="text" placeholder="パッケージ名">
              <button class="action-button" type="submit">パッケージ追加</button>
            </form>
            <button class="action-button" type="button" data-macro-import-defaults>スクショの標準マクロを読み込む</button>
          </div>
          <div class="macro-panel">
            <div class="macro-panel__title">
              <h2>追加済みのマクロ</h2>
              <button class="action-button" type="button" data-macro-reload>更新</button>
            </div>
            <div class="macro-package-list" data-macro-package-list></div>
            <div class="macro-list" data-macro-list></div>
          </div>
        </div>
      </section>`;
}

function renderHeader(officialLinks: string[][]): string {
  return `<header class="app-header">
      <div class="app-header__brand">
        <span>mathlog-preview</span>
        <small>local Mathlog article preview</small>
      </div>
      <div class="app-header__actions">
        <button class="new-article-button" type="button" data-new-article>新規記事作成</button>
        <a class="action-button" href="/macros" target="_blank" rel="noreferrer noopener">マクロ設定</a>
        <nav class="app-header__links" aria-label="official links">
          ${renderOfficialLinks(officialLinks)}
        </nav>
      </div>
    </header>`;
}

function renderPageBody({
  body,
  articles,
  selectedPath,
  contentRoot,
  macroLibrary,
  macroOnly,
  officialLinks,
}: {
  body: string;
  articles: ArticleSummary[];
  selectedPath: string;
  contentRoot: string;
  macroLibrary: MacroLibrary;
  macroOnly: boolean;
  officialLinks: string[][];
}): string {
  const header = renderHeader(officialLinks);
  if (macroOnly) {
    return `${header}
    <main class="macro-page">
      ${renderMacroManager(macroLibrary)}
    </main>`;
  }

  return `${header}
    <div class="app-shell">
      <aside class="article-nav">
        <div class="article-nav__header">
          <strong>Articles</strong>
          <small>${escapeHtml(path.relative(DOCS_ROOT, contentRoot) || ".")}</small>
        </div>
        ${renderArticleNav(articles, selectedPath)}
      </aside>
      <div class="preview-pane">
        ${renderPreviewHeader(articles.find((article) => article.relativePath === selectedPath) || null)}
        <main class="markdown-body">
${body}
        </main>
      </div>
    </div>`;
}

export async function createHtmlDocument({
  title,
  body,
  highlightCss,
  articles = [],
  selectedPath = "",
  contentRoot = "",
  macroLibrary = normalizeMacroLibrary(),
  macroOnly = false,
  officialLinks,
}: {
  title: string;
  body: string;
  highlightCss: string;
  articles?: ArticleSummary[];
  selectedPath?: string;
  contentRoot?: string;
  macroLibrary?: MacroLibrary;
  macroOnly?: boolean;
  officialLinks: string[][];
}): Promise<string> {
  const [documentTemplate, appCssTemplate, clientScript] = await Promise.all([
    loadTemplate("document.html"),
    loadTemplate("app.css"),
    loadTemplate("client.js"),
  ]);
  const appCss = appCssTemplate.replace("{{highlightCss}}", highlightCss);
  const pageBody = renderPageBody({ body, articles, selectedPath, contentRoot, macroLibrary, macroOnly, officialLinks });
  const macroLibraryScript = `window.__mathlogMacroLibrary__ = ${escapeScriptJson(macroLibrary)};`;

  return documentTemplate
    .replace("{{title}}", escapeAttribute(title))
    .replace("{{highlightCss}}", "")
    .replace("{{appCss}}", appCss)
    .replace("{{mathJaxMacros}}", escapeScriptJson(buildActiveMathJaxMacros(macroLibrary)))
    .replace("{{clientScript}}", `${macroLibraryScript}\n${clientScript}`)
    .replace("{{body}}", pageBody);
}
