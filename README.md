# 01_docs

このフォルダは、Markdown 原稿・プレビュー用レンダラ・PDF 出力物を分離して管理する。

## 構成

- `decks/`: Markdown 原稿
- `exports/`: 任意の PDF 出力先
- `scripts/`: `markdown-it-render` と一括出力スクリプト
- `.local-browsers/`: `build.sh` が既定で自動検出する headless Chrome
- `package.json`: `markdown-it-render` 用の Node 環境

## 方針

- 現行ルートは `markdown-it-render` を使う
- `file://` 直開きは非サポート
- HTML は単体配布物ではなく、`localhost` プレビューおよび PDF 出力の中間表現とみなす
- Mermaid は `markdown-it-diagram` + browser-side Mermaid で描画する
- DOT は `@viz-js/viz` で SVG 化して埋め込む
- PDF は preview と同じ描画経路を headless browser で開いて出力する
- `build` は単一 Markdown から単一 PDF を生成する
- 一括出力は `scripts/build.sh` で行う

## セットアップ

```bash
cd 01_docs
npm install
```

Chrome が未配置なら `01_docs` 配下へ入れる。

```bash
cd 01_docs
npx @puppeteer/browsers install chrome-headless-shell@stable --path ./.local-browsers
```

## 使い方

リポジトリルートからプレビューする:

```bash
node 01_docs/scripts/markdown-it-render.mjs serve 01_docs/decks/chapter3.md --port 3030
```

`serve` は `slidev` 風の標準出力で `entry`、`preview` URL、`shortcuts` を表示する。TTY 付き実行では色と下線を使った装飾付きで表示される。

`01_docs` 配下から実行する:

```bash
cd 01_docs
npm run serve -- ./decks/chapter3.md --port 3030
```

単一 PDF を出力する:

```bash
node 01_docs/scripts/markdown-it-render.mjs build 01_docs/decks/chapter3.md
```

`build` は `entry` と `output` を標準出力に表示する。TTY 付き実行では `serve` と同じ装飾ルールを使う。

`build` は `MARKDOWN_IT_RENDER_CHROME_PATH` 必須。`scripts/build.sh` を使う場合は、未指定時に `01_docs/.local-browsers` 配下の `chrome-headless-shell` を自動検出する。

出力先を明示する:

```bash
node 01_docs/scripts/markdown-it-render.mjs build 01_docs/decks/chapter3.md 01_docs/exports/custom-chapter3.pdf
```

入力 Markdown と同じフォルダへ出る既定値:

```bash
node 01_docs/scripts/markdown-it-render.mjs build 01_docs/decks/chapter3.md
```

一括 PDF 出力:

```bash
bash 01_docs/scripts/build.sh "01_docs/decks/*.md"
```

出力先ディレクトリを指定して一括 PDF 出力:

```bash
bash 01_docs/scripts/build.sh "01_docs/decks/*.md" "01_docs/exports"
```

既定の PDF 出力先:

- `build <input.md>`: `<入力Markdownと同じフォルダ>/<basename>.pdf`
- `build.sh "<glob>" "<output_dir>"`: `<output_dir>/<basename>.pdf`

## シェルラッパ

- `scripts/build.sh`: 複数 Markdown をループして `markdown-it-render build` を呼ぶ

## serve shortcuts

TTY 付きで `serve` を起動した場合、次の shortcuts が有効になる。

- `r`: renderer cache をリセットし、summary を再表示する
- `o`: preview URL を既定ブラウザで開く
- `e`: 入力 Markdown を既定エディタで開く
- `q`: `serve` を終了する
- `Ctrl+C`: `serve` を終了する

`stdin` が TTY でない環境では shortcuts は無効になり、標準出力にも `unavailable (non-tty)` と表示される。

エディタ起動は次の優先順で決まる。

- `MARKDOWN_IT_RENDER_EDITOR`
- `VISUAL`
- `EDITOR`
- `TERM_PROGRAM=vscode` の場合は `code`

ブラウザ起動は次の優先順で決まる。

- `MARKDOWN_IT_RENDER_OPENER`
- `BROWSER`
- `xdg-open`

## 補足

- 通常コードブロックは `highlight.js` でシンタックスハイライトする
- 通常コードブロックには `Copy` ボタンが付く
- Mermaid / DOT の表示確認は `serve` で行う
- Mermaid / DOT 図ブロックには `Save SVG` ボタンが付く
- PDF 化はプレビュー DOM の描画完了を待ってから行う
- `build` は glob を受け付けない
