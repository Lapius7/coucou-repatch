<div align="center">

<p align="center"><b>日本語</b> | <a href="README.en.md">English</a></p>

<h1 align="center">Coucou Windows Fork</h1>

<h3 align="center">Claude Code の作業を、画面の上の小さな島で見守る Windows アプリ。</h3>

<p align="center">
  <a href="https://github.com/Lapius7/coucou-repatch/releases"><img alt="Release" src="https://img.shields.io/github/v/release/Lapius7/coucou-repatch?label=release&style=flat-square&color=e8833a&logo=github"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/Lapius7/coucou-repatch?style=flat-square&color=97ca00"></a>
  <a href="https://tauri.app/"><img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24c8db?style=flat-square&logo=tauri&logoColor=white"></a>
  <a href="https://github.com/Lapius7/coucou-repatch/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/Lapius7/coucou-repatch?style=flat-square&color=e3b341&logo=github"></a>
  <a href="https://github.com/Lapius7/coucou-repatch/commits/windows-fork"><img alt="Last commit" src="https://img.shields.io/github/last-commit/Lapius7/coucou-repatch?label=last%20commit&style=flat-square&color=2f81f7"></a>
</p>

<p align="center"><a href="#できること">できること</a> · <a href="#はじめかた">はじめかた</a> · <a href="#このリポジトリの中身">このリポジトリの中身</a> · <a href="#ライセンス">ライセンス</a></p>

</div>

---

Claude Code の作業を、画面の上に出る小さな島で見守る Windows アプリです。権限確認に答える、ファイルの
編集差分を見る、プランの上限を確認する、といったことが、今やっている作業から離れずにできます。

[Louis-CFM/coucou](https://github.com/Louis-CFM/coucou) の Fork で、Windows 版 (`windows/`) を大きく作り込んでいます。
WSL の Claude Code にも対応しています。

> [!IMPORTANT]
> **公開しているのはソースコードだけです。** 「Coucou」の名前、Mochi のキャラクター、アイコン、サウンドは
> Louis Raillé のもので ([LICENSE-ASSETS.md](LICENSE-ASSETS.md))、これらを含むビルドは配布できません。
> インストーラーは配布しないので、**自分でビルド**してください (コマンド1つです)。

## できること

- **ファイル編集の差分**: Claude が何を変えたかを、色つき・行番号つきで。直前のコマンドの出力 (テスト結果など) も並べて。
- **プランの上限**: 5時間と週間の使用率を島に表示。Windows と WSL のアカウントを分けて扱います。
- **アプリ内のセットアップ**: 1つの画面で、Windows と**すべての WSL** の Claude Code をつなぎます。
  変更内容 (差分) を確認してから書き込み、バックアップも取ります。アンインストールで、きれいに解除もできます。
- **履歴**: セッションの発言と作業を読み返せます (Markdown で描画)。島を大きく広げることもできます。
- **権限**: 「常に許可」のルール、危険なコマンドの検出、押し間違いに強いボタン、ホットキー、島から Claude の質問に答える。
- **そのほか**: セッションごとのピル、通知、使用量、島の中の設定パネル、全画面アプリの判定、English / 日本語。

元との違いのすべて: **[windows/RELEASE_NOTES.md](windows/RELEASE_NOTES.md)**

## はじめかた

必要なもの: Node 20 以上、Rust (Visual Studio の C++ ビルドツール込み)、Git。

```powershell
git clone https://github.com/Lapius7/coucou-repatch.git
cd coucou-repatch\windows
powershell -ExecutionPolicy Bypass -File install-from-source.ps1
```

遅い PC では `-Light` を付けてください。インストールが終わると Coucou が起動し、初回は**セットアップ画面**が開きます。
「適用」を押すだけで、Claude Code につながります。

詳しい手順、困ったとき、アンインストール、開発のしかた: **[windows/README.md](windows/README.md)**

## このリポジトリの中身

| 場所 | 内容 |
|---|---|
| `windows/` | この Fork の本体: Windows / WSL 版のアプリ (Tauri 2、Rust と TypeScript)。Linux でもビルドできます |
| `windows/docs/` | WSL での動作確認の手順 ([TESTING_WSL.md](windows/docs/TESTING_WSL.md))、リリースの手順 ([RELEASING.md](windows/docs/RELEASING.md)) |
| `NotchBuddy/Resources/sounds/` | アプリが使うサウンド。元の作者のもので、MIT の対象外です ([LICENSE-ASSETS.md](LICENSE-ASSETS.md))。Windows 版のビルドがこの場所を読みます |

## ライセンス

ソースコードは MIT ライセンスです ([LICENSE](LICENSE))。元の著作権は Louis Raillé、この Fork での変更は Lapius7 です。
名前、キャラクター、アイコン、サウンドは対象外です ([LICENSE-ASSETS.md](LICENSE-ASSETS.md))。自分のアプリとして出すときは、
自分の名前、アイコン、キャラクター、サウンドにしてください。
