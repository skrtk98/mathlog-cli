# mathlog-cli

Mathlog の記事 Markdown をローカルでプレビューするための CLI です。

## セットアップ

```bash
npm install
```

## 使い方

ローカルプレビュー:

```bash
npm run preview
```

既定では Qiita CLI と同じく `public/` 配下の Markdown を一覧表示します。プレビュー画面の「新規記事作成」ボタンから `public/` に記事を追加できます。

CLI から記事を作成する:

```bash
npm run new -- my-article
```

別ディレクトリを使う場合:

```bash
npm run preview -- path/to/articles --port 8888
```

bin として実行する場合:

```bash
npx mathlog preview
npx mathlog new my-article
npx mathlog version
```

## 対応済みの Mathlog 構文

- `$...$`, `$$...$$`, `\begin{...}\end{...}` の MathJax 3.2.2 プレビュー
- `\TextCenter`, `\TextRight`, `\TextLeft` によるディスプレイ数式の配置
- `#` から `#####` までの見出し、見出しラベル `## 見出し [label]`
- `&&&type title [label] ... &&&` の形式ブロック
- `[[label]]` による形式ブロック参照
- `(1)`, `[1]`, `R1.`, `(R1)`, `[R1]` の箇条書き
- `![alt](url =500)` の画像最大幅指定
- Mathlog に合わせた太字赤色、斜体、取り消し線、表、引用、コード、HTML

公式リファレンス: https://opthub.notion.site/1ca318bcf9ac8195ad0af2a1ae8319e0
