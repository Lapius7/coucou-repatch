# リリースの手順

公開するバージョンごとに、変更点を GitHub の Releases に載せます。インストーラーは載せません
(名前・キャラクター・アイコン・サウンドは配布できないため。[LICENSE-ASSETS.md](../../LICENSE-ASSETS.md))。
ソースコードの zip は GitHub が自動で付けます。

1. **変更を書く**: `windows/CHANGELOG.md` (日本語) と `windows/CHANGELOG.en.md` (英語) の先頭に、新しい
   `## [x.y.z] — 見出し` を足す。元との違いの一覧 (`RELEASE_NOTES.md` / `.en.md`) も、変わったなら直す。
2. **番号を上げる**: 次の4か所の `version` を同じ番号にする。
   `windows/Cargo.toml`、`windows/package.json`、`windows/src-tauri/tauri.conf.json`、`windows/package-lock.json` (先頭の2か所)。
   そのあと `cargo check` を1回通して `Cargo.lock` を更新する。
3. **コミットしてタグを付ける**:
   ```bash
   git commit -am "Release x.y.z"
   git tag -a vx.y.z -m "x.y.z"
   git push fork windows-fork --follow-tags
   ```
4. **リリースを作る**: CHANGELOG の該当の節 (日本語、英語の順) をファイルに写して、渡します。
   ```bash
   gh release create vx.y.z --repo Lapius7/coucou-repatch --title "x.y.z" --notes-file notes.md
   ```

## 変更点を書くときの目安

- 使う人から見て何が変わったかを書く (ファイル名や関数名は書かない)。
- 追加 / 変更 / 削除 / 修正 に分ける。
- 日本語と英語で、同じ内容にする。
