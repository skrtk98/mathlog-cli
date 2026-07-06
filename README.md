# mathlog-cli

Mathlog の記事 Markdown をローカルで確認するための CLI です。Qiita CLI に近い使い勝手で、`public/` 配下の記事を一覧し、ブラウザでプレビューしながら編集できます。

## 必要なもの

- Node.js 20 以上
- npm

## セットアップ

```bash
git clone https://github.com/skrtk98/mathlog-cli
cd mathlog-cli
npm install
```

clone 直後の `public/` は空です。最初の記事と設定ファイルを作る場合は、次を実行します。

```bash
npm run init
```

`npm run init` は次のファイルを作成します。

- `mathlog.config.json`
- `public/welcome.md`

## 使い方

プレビューを起動します。

```bash
npm run preview
```

起動すると URL が標準出力に表示されます。既定では `http://localhost:8888/` です。

```text
Mathlog preview: http://localhost:8888/
Content directory: /path/to/mathlog-cli/public
Shortcuts: r restart, o open, e edit, q quit
```

プレビュー内の「新規記事作成」ボタン、または CLI から記事を追加できます。

```bash
npm run new -- my-article
```

別のディレクトリを記事置き場にする場合は、ディレクトリを指定します。

```bash
npm run preview -- path/to/articles --port 8888
npm run new -- my-article path/to/articles
```

`mathlog.config.json` を置くと、`contentDir`、`host`、`port` を既定値として使えます。

```json
{
  "contentDir": "public",
  "host": "localhost",
  "port": 8888
}
```

## コマンド

```bash
npm run init
npm run preview
npm run new -- my-article
npm test
```

ローカル bin として直接実行する場合は次の形式です。

```bash
npm exec -- mathlog init
npm exec -- mathlog preview
npm exec -- mathlog new my-article
npm exec -- mathlog version
```

## プレビュー画面

- `public/` 配下の `.md` を一覧表示します。
- Markdown や画像を保存すると、ブラウザ側が自動で再読み込みします。
- 画面上部に Mathlog 公式サイトと公式リファレンスへのリンクを表示します。
- 空のディレクトリでも起動できます。その場合は「新規記事作成」から記事を作れます。
- PDF 出力機能はありません。

起動中の端末では次のショートカットが使えます。

- `r`: プレビュー状態を再読み込み
- `o`: ブラウザで開く
- `e`: 現在の記事をエディタで開く
- `q`: 終了

## 対応している Mathlog 構文

- `$...$`、`$$...$$`、`\begin{...}\end{...}` の MathJax プレビュー
- `\begin{xy}...\end{xy}` と `\xymatrix` の XyPic 図式プレビュー
- `\TextCenter`、`\TextRight`、`\TextLeft` によるディスプレイ数式の配置
- `#` から `#####` までの見出し
- `## 見出し [label]` 形式の見出しラベル
- `&&&type title [label] ... &&&` の形式ブロック
- `[[label]]` による形式ブロック参照
- `(1)`、`[1]`、`R1.`、`(R1)`、`[R1]` の箇条書き
- `![alt](url =500)` の画像最大幅指定
- 記事ディレクトリ内の相対画像リンク
- 相対 `.md` 記事リンク
- 太字、斜体、取り消し線、表、引用、コード、HTML
- 公式リファレンスの HTML 例で使われる `fw-bold`、`border`、`box`、`p-4` の簡易 CSS
- `title`、`tags`、`private` の front matter 表示

公式リファレンス: https://opthub.notion.site/1ca318bcf9ac8195ad0af2a1ae8319e0

## ディレクトリ構成

```text
.
├── public/                 # ローカル記事置き場
├── scripts/
│   └── mathlog-preview.mjs # CLI 本体
├── test/                   # 自動テスト
├── mathlog.config.json     # npm run init で作成
└── README.md
```

`public/` 内の記事や画像は利用者の作業ファイルです。このリポジトリでは `public/.gitkeep` だけを管理し、記事ファイルは `.gitignore` しています。

`test/sample_data/` は手元で実記事サンプルを使って検証するための任意ディレクトリです。リポジトリには含めません。存在する場合のみ、`npm test` の追加検証で使われます。

## 開発

```bash
npm install
npm test
```

構文エラーだけを確認する場合:

```bash
node --check scripts/mathlog-preview.mjs
```
