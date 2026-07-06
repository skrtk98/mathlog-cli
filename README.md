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

起動すると URL が標準出力に表示されます。既定では `http://localhost:3141/` です。

```text
Mathlog preview: http://localhost:3141/
Content directory: /path/to/mathlog-cli/public
Shortcuts: r restart, o open, e edit, q quit
```

プレビュー内の「新規記事作成」ボタン、または CLI から記事を追加できます。

```bash
npm run new -- my-article
```

別のディレクトリを記事置き場にする場合は、ディレクトリを指定します。

```bash
npm run preview -- path/to/articles --port 3141
npm run new -- my-article path/to/articles
```

`mathlog.config.json` を置くと、`contentDir`、`host`、`port` を既定値として使えます。

```json
{
  "contentDir": "public",
  "host": "localhost",
  "port": 3141
}
```

## コマンド

```bash
npm run init
npm run preview
npm run new -- my-article
npm test
```

GitHub から一回だけ実行する場合は、次の形式も使えます。

```bash
npx github:skrtk98/mathlog-cli version
npx github:skrtk98/mathlog-cli preview
npx github:skrtk98/mathlog-cli new my-article
```

## プレビュー画面

- `public/` 配下の `.md` を一覧表示します。
- Markdown や画像を保存すると、ブラウザ側が自動で再読み込みします。
- 画面上部に Mathlog 公式サイトと公式リファレンスへのリンクを表示します。
- 空のディレクトリでも起動できます。その場合は「新規記事作成」から記事を作れます。
- ヘッダーの「マクロ設定」から、Mathlog 互換のマクロとパッケージを別タブで管理できます。
- PDF 出力機能はありません。

起動中の端末では次のショートカットが使えます。

- `r`: プレビュー状態を再読み込み
- `o`: ブラウザで開く
- `e`: 現在の記事をエディタで開く
- `q`: 終了

## マクロライブラリ

プレビュー画面のヘッダーにある「マクロ設定」を押すと、`/macros` が新規タブで開きます。この画面では、Mathlog のマクロ設定に近い形で TeX マクロを登録できます。

マクロには次の項目を設定します。

- コマンド名: `\abs`、`\reals` のような TeX コマンド
- 引数の個数: `0` から `9`
- 数式: `\left| #1 \right|` のような展開先
- パッケージ: マクロをまとめる任意のグループ

パッケージは追加、削除、有効化、無効化できます。無効化したパッケージに属するマクロは MathJax に渡されないため、プレビュー上でも無効になります。パッケージを削除すると、そのパッケージに属していたマクロは「指定なし」に戻ります。

登録内容はプロジェクト直下の `mathlog.macros.json` に保存されます。clone 直後のデフォルトマクロは空です。スクショ由来のマクロ例は `presets/mathlog-user-macros.json` にあり、`/macros` の「ユーザーマクロ例を読み込む」から明示的に取り込めます。

## 対応している Mathlog 構文

- `$...$`、`$$...$$`、`\begin{...}\end{...}` の MathJax プレビュー
- プレビュー画面で登録した Mathlog 互換マクロ
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
├── presets/                # 明示的に読み込めるマクロプリセット
├── bin/
│   └── mathlog.mjs         # npm bin 用の CLI エントリ
├── src/                    # TypeScript の実装とテスト
├── mathlog.config.json     # npm run init で作成
├── mathlog.macros.json     # マクロ登録時に作成
└── README.md
```

`public/` 内の記事や画像は利用者の作業ファイルです。このリポジトリでは `public/.gitkeep` だけを管理し、記事ファイルは `.gitignore` しています。

`src/sample_data/` は手元で実記事サンプルを使って検証するための任意ディレクトリです。リポジトリには含めません。存在する場合のみ、`npm test` の追加検証で使われます。

## 開発

```bash
npm install
npm test
```

構文エラーだけを確認する場合:

```bash
npm run build
```
