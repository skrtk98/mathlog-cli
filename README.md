# mathlog-cli

Mathlog の記事 Markdown をローカルでプレビューし、必要に応じて PDF 出力するための CLI です。

## セットアップ

```bash
npm install
```

PDF 出力を使う場合は Chrome/Chromium を用意し、`MATHLOG_PREVIEW_CHROME_PATH` に実行ファイルを指定してください。`scripts/build.sh` は `.local-browsers` 配下の `chrome-headless-shell` を自動検出します。

```bash
npx @puppeteer/browsers install chrome-headless-shell@stable --path ./.local-browsers
```

## 使い方

ローカルプレビュー:

```bash
npm run preview -- examples/mathlog-syntax.md --port 3030
```

単一 PDF 出力:

```bash
npm run build -- examples/mathlog-syntax.md
```

複数 Markdown の PDF 出力:

```bash
bash scripts/build.sh "examples/*.md" "exports"
```

## 対応済みの Mathlog 構文

- `$...$`, `$$...$$`, `\begin{...}\end{...}` の MathJax 3.2.2 プレビュー
- `\TextCenter`, `\TextRight`, `\TextLeft` によるディスプレイ数式の配置
- `&&&type title [label] ... &&&` の形式ブロック
- `[[label]]` による形式ブロック参照
- `(1)`, `[1]`, `R1.`, `(R1)`, `[R1]` の箇条書き
- `![alt](url =500)` の画像最大幅指定
- Mathlog に合わせた太字赤色、斜体、取り消し線、表、引用、コード、HTML

公式リファレンス: https://opthub.notion.site/1ca318bcf9ac8195ad0af2a1ae8319e0
