# mathlog-cli

Mathlog の記事 Markdown をローカルでプレビューするための CLI です。

## セットアップ

```bash
npm install
```

## 使い方

ローカルプレビュー:

```bash
npm run preview -- examples/mathlog-syntax.md --port 3030
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
