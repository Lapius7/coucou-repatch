<div align="center">

**日本語** · [English](README.en.md)

# Coucou for Windows

**PC にはノッチがないので、Mochi は画面の上に住んでいます。**

Claude Code の権限確認、作業の様子、ファイルの編集差分、プランの上限、Claude とのチャット —— 今やっている作業から離れずに使えます。

![Windows 10/11](https://img.shields.io/badge/Windows-10%2F11-0078D4?logo=windows)
![Tauri 2](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-backend-000?logo=rust)
![Code: MIT](https://img.shields.io/badge/code-MIT-green)

</div>

**元の Coucou と何が違う?** すべて [RELEASE_NOTES.md](RELEASE_NOTES.md) に書いてあります。

---

## インストール

> **この Fork が公開するのはソースコードだけです。** 「Coucou」の名前、Mochi のキャラクター、アイコン、
> サウンドは Louis Raillé のものです ([LICENSE-ASSETS.md](../LICENSE-ASSETS.md))。そのため
> インストーラーは配布しません。**自分でビルドします** (コマンド1つです)。現在のユーザーにだけ入り、
> 管理者権限は要りません。データが PC の外へ出ることもありません。

**1. ツールを入れる (最初の1回だけ)**

| ツール | 入手先 |
|---|---|
| Node 20 以上 | <https://nodejs.org> |
| Rust | <https://rustup.rs> (Visual Studio の **C++ ビルドツール** も求められるので入れる) |
| Git | <https://git-scm.com> |

WebView2 は Windows 10/11 に最初から入っています。

**2. ビルドしてインストール**

```powershell
git clone https://github.com/Lapius7/coucou-repatch.git
cd coucou-repatch\windows
powershell -ExecutionPolicy Bypass -File install-from-source.ps1
```

遅い PC では `-Light` を付けてください。少し時間はかかりますが、PC が重くなりません。

**3. Coucou を起動する** — インストールの最後に自動で起動します。画面の上に Mochi が出て、
初回は**セットアップ画面**が開きます ([セットアップ](#セットアップ)を参照)。

**4. 「適用」を押す。** これで Claude Code につながります。新しい Claude Code のセッションを開くと、島に出ます。

更新するときは、`git pull` をして同じスクリプトをもう一度実行します。設定は残ります。

## セットアップ

初回起動では **設定 → 接続** が開き、つなげられるものは最初からオンになっています。
Claude Code が動いている場所ごとに、カードが1枚出ます。

| カード | 内容 |
|---|---|
| **Windows** | PowerShell、Windows Terminal、VS Code、Git Bash などの Claude Code |
| **WSL · \<ディストリビューション\>** | 各 WSL の中の Claude Code (自動で見つかります) |

各カードにはスイッチが2つあります。

| スイッチ | 内容 |
|---|---|
| **Claude Code** | セッション、ステップ、権限確認とその回答を表示します。Claude Code の*フック*を書き込みます。 |
| **プランの上限** | 5時間と週間の使用率を島に表示します。ステータスラインの前に小さな中継を挟みます。**今のステータスラインの表示は、そのまま変わりません。** |

カードの **「適用…」** を押すと、書き換える予定のファイル (`~/.claude/settings.json`。Windows 側、または
その WSL の中) の**差分そのもの**と、取る予定のバックアップが表示されます。**「この内容で書き込む」**を
押すまで、何も書き込みません。その間にファイルが変わっていたら、何も書かずに、新しい差分を出し直します。

- あなたのフック、あなたのステータスライン、そのほかの設定には触れません。
- 書き込みのたびに、日付つきのバックアップ (`settings.json.bak-YYYYMMDD-HHMMSS`) を取ります。
- 読めない、または JSON として正しくない `settings.json` は**絶対に上書きしません**。エラーが出ます。
- 気が変わったら、同じ画面でスイッチをオフにして「適用…」→ 確認 → 書き込みです。元のステータスラインが戻ります。

Python も、スクリプトも、`.bat` も要りません。

### プランの上限

Claude Code がプランの上限を渡すのはステータスラインだけで、サブスクリプション (Pro / Max) のときだけです。
**「プランの上限」**を適用したら、新しい Claude Code のセッションを開いてください。最初の返答のあとに
数字が出ます。Windows と WSL の両方をつないでいるときは、**設定 → 一般 → 上限を出す Claude** で、
どちらの上限を島に出すか選べます (*自動*は、表示中のセッションに合わせます)。

## アンインストール

**設定 → アプリ → Coucou → アンインストール** (または `%LOCALAPPDATA%\Coucou` のアンインストーラー) を
使います。質問が出ます。

> Claude Code の設定 (Windows と WSL) からも Coucou を外しますか?

- **はい** — Windows と、すべての WSL の `settings.json` から Coucou の項目だけを外します (バックアップは
  残ります。ほかのツールのフックはそのままです)。元のステータスラインも戻ります。
- **いいえ** — Claude Code の設定には触れません。残った項目は害になりません。実行ファイルがなければ、
  フックは何も出さずに終わります。

先に **設定 → 接続** で解除してから、アンインストールしても構いません。
アンインストーラーは、中継、受信ボックス、ログを消します。API キーは Windows の資格情報マネージャーに
あり、**設定 → Claude** から消せます。もう1つ、「設定と保存した API キーも消しますか?」という質問も出ます
(既定は「いいえ」)。

サイレントアンインストール (`/S`) と更新では、Claude Code の設定には触れません。

## 困ったとき

| 症状 | 試すこと |
|---|---|
| Claude Code を動かしても何も出ない | **設定 → 接続**: カードの丸が緑か確認します。そのあと**新しい** Claude Code のセッションを開いてください。すでに動いているセッションは、新しいフックを知りません。 |
| WSL のカードに「Claude Code はまだ見つかっていません」と出る | その WSL の中で `claude` を1回実行して (`~/.claude` が作られます)、設定を開き直します。そのままつなぐこともできます。 |
| WSL のディストリビューションが出ない | `wsl -l -q` に出ている必要があります。Docker 用のものは除いています。 |
| 「停止中」と出る WSL | 見るだけで WSL が起動してしまうのを避けています。「確認する」を押すと起動して調べます。 |
| プランの上限が出ない | サブスクリプションのプランだけが報告し、新しいセッションの最初の返答のあとに出ます。Claude の Windows デスクトップ版は報告しません。ターミナルの版は報告します。 |
| ゲーム中に島が消える | 仕様です。全画面のアプリが前面にあると隠れます。ゲームの前に別のウィンドウがあれば、島は出ます。 |
| 「`settings.json` が正しい JSON ではない」 | そのファイルを直すか移動してください。Coucou は、読めないものを上書きしません。 |
| ログはどこ? | `%LOCALAPPDATA%\Coucou\coucou.log` |

## 使い方

| すること | 起きること |
|---|---|
| 画面の最上部の中央へマウスを動かす | Mochi が顔を出す |
| 小さな島をクリックする | 開く |
| Mochi をクリックする | 嫌がる。3回続けると目を回す |
| Mochi の上でポインターを2秒止める | ハート |
| ファイルを掴んで島の上へ持っていく (島が閉じていても、どの画面でも) | ドロップ画面が開く。ドロップすると、そのファイルについて質問できる画面がすぐ開く |
| `Esc` | 島を閉じる |
| トレイアイコン | 開く、設定…、一時停止、終了 |

あとは自動です。Claude Code の権限確認が来ると、島が**拒否 / 許可**つきで開き、終わったセッションは
何をしたかを出し、セッションは Mochi の隣の色つきのピルに並びます。

## Claude Code

**設定 → 接続** からつなぎます ([セットアップ](#セットアップ)を参照)。

中継は小さな実行ファイル `coucou-hook.exe` で、起動時に `%LOCALAPPDATA%\Coucou\bin\` にコピーされます。
Coucou に届くまでの待ち時間は 300 ms で、アプリが閉じている、遅い、落ちているときは、何も言わずに終わります。
**Claude Code のセッションが、Coucou のせいで止まったり遅くなったりすることはありません。** 権限確認に
誰も答えなければ、Coucou は黙ったままで、Claude Code はいつも通りターミナルで聞きます。

どのターミナルからでも動きます (Windows Terminal、PowerShell、VS Code、Git Bash)。WSL からも動きます。

## チャットとキー

**設定 → Claude** で Anthropic の API キーを入れます。キーは **Windows の資格情報マネージャー**に保存され、
ディスクにも画面にも出ません。島は、キーがあるかどうかを聞けるだけです。
キーがなければ、チャットは `claude` CLI で答えます。

テレメトリはありません。Coucou が通信するのは、あなたが設定したサービスだけです。

## 自分でビルドする

(`install-from-source.ps1` が以下を全部やってくれます。これは手動の手順です。)

[Rust](https://rustup.rs)、[Node 20 以上](https://nodejs.org)、**MSVC のビルドツール** (Visual Studio Build
Tools の「C++ によるデスクトップ開発」) が要ります。WebView2 は Windows 10/11 に入っています。

```powershell
cd windows
npm install
npm run tauri dev      # ライブ更新つきの開発ビルド
npm run pack           # インストーラーを作り、windows/release/ に置く
```

`npm run dev` だけなら、ふつうのブラウザで画面を確認できます。島の見た目を調整するだけなら、これで足ります。

`npm run pack` は、`windows/release/` にインストーラー (`Coucou-Windows-setup.exe` と `.msi`) を作ります。
自分の PC に入れるためのもので、どこにも公開されません。

インストールは必須ではありません。`target/release/coucou.exe` はそのまま動きます。タスクバーにウィンドウは
なく、コンソールも出ません。画面の上の島と、通知領域の Mochi がアプリのすべてで、終了はそのメニューにあります。

28個のサウンドは macOS 版のファイルで、このフォルダには複製しません。場所は `vite.config.ts` の先頭の
`SOUNDS_DIR` に1回だけ書いてあります。`shared/sounds/` に移したら、その1行だけ変えます。

アプリのアイコンとトレイのアイコンは、Mochi と同じようにコードで描いています。

```powershell
npm run icons          # scripts/gen-icons.mjs から src-tauri/icons を作り直す
```

### 開発 (ライブ更新)

```powershell
cd windows
npm run tauri dev
```

画面側 (`src/`) の変更は、保存した瞬間に反映されます。Rust 側の変更は、自動でビルドし直して
再起動します (通常のビルドよりずっと速いです)。先に、インストール済みの Coucou を終了してください
(同時に動けるのは1つだけです)。PC を重くしたくないときは、頭に `CARGO_BUILD_JOBS=4` を付けます。

### 構成

```
windows/
  src/                 島の画面 (TypeScript、フレームワークなし)
    mochi/             Mochi と起動時のあいさつ (Canvas 2D)
    island/            状態遷移、フック
    views/             島のすべての画面
    settings/          設定ウィンドウ
  src-tauri/           Rust の本体: ウィンドウ、名前付きパイプ、Claude API、ポーリング
  hook/                coucou-hook.exe (Claude Code の中継)
  scripts/             アイコン生成
```

### ログ

`%LOCALAPPDATA%\Coucou\coucou.log` — フックのイベント、権限の判断、ポーリングの問題。PC の外には出ません。

## 対応しているエージェント

中継 (`coucou-hook.exe`) は、フックのイベントでコマンドを実行できるツールなら、どれでも使えます。
`--agent <名前>` を付けると、その名前のピルができます。

| エージェント | つなぎ方 | 設定ファイル |
|---|---|---|
| Claude Code | **設定 → 接続** | `%USERPROFILE%\.claude\settings.json` |
| Gemini CLI | 位置引数 `--agent gemini` | `%USERPROFILE%\.gemini\settings.json` |
| Antigravity | 位置引数 `--agent antigravity` | `%USERPROFILE%\.config\antigravity\hooks.json` |
| Cursor | フックが自動で入る | `%USERPROFILE%\.claude\settings.json` |
| Codex | 位置引数 `--agent codex` | `%USERPROFILE%\.codex\hooks.json` |
| Copilot CLI | 位置引数 `--agent copilot` + camelCase のイベント | `%USERPROFILE%\.copilot\hooks\coucou.json` |
| Muse Code | 位置引数 `--agent muse` | `%USERPROFILE%\.config\muse\settings.json` |
| そのほか | 位置引数 `--agent <名前>` | そのツールのフック設定 |

OpenCode と Amp は、Windows と Linux ではまだ対応していません。連携のプラグインが macOS 固有のパスで
`/bin/sh` を呼ぶためで、プラグインのインストーラーは Mac アプリの中にしかありません。

## Mac 版との違い

- ノッチがないので、島は画面の上端の中央にあり、ノッチに隠れる代わりに上端へ引っ込みます。
- 権限確認は**どの**ターミナルからでも動きます。Mac 版は VS Code のセッションだけを聞いています。
- この版にないもの: メールでのファイル送信、Mochi をウィンドウにドラッグして文脈として添付すること、
  特定のターミナルウィンドウへのジャンプ。

## Linux

同じアプリが Linux でもビルドできます。違う部分はすべて `src-tauri/src/platform/` にあり、中継の通信は
`hook/src/unix.rs` にあります。

```bash
sudo apt install build-essential pkg-config \
  libwebkit2gtk-4.1-dev libgtk-layer-shell-dev libayatana-appindicator3-dev \
  librsvg2-dev libssl-dev libdbus-1-dev patchelf \
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good
npm install
npm run tauri dev      # ライブ更新つきの開発ビルド
npm run pack           # AppImage、.deb、.rpm を windows/release/ に作る
```

Linux での違い:

- **島**は、上端に固定した gtk-layer-shell のオーバーレイで、対応するコンポジター (COSMIC、KDE Plasma、
  Hyprland、Sway などの wlroots 系) では、上のパネルより手前に出ます。GNOME には layer-shell がないので、
  ふつうのウィンドウになります。`COUCOU_LAYER_SHELL=0` で、どこでもこのモードにできます。
- **クリックの素通し**は、ウィンドウの入力領域を島の形に合わせることで行い、それ以外のクリックは下に届きます。
- **Mochi の目**がポインターを追うのは、島の上にあるときだけです。Wayland では、それ以外の場所のカーソル位置を
  アプリが知れません。
- **Claude Code のフック**は、`~/.local/share/coucou/bin/coucou-hook` と
  `$XDG_RUNTIME_DIR/coucou.sock` の Unix ソケットを通ります。どちら側も、相手が同じユーザーか確認します。
- **キー**は Secret Service (GNOME Keyring、KWallet) に保存します。
- **ファイル**: 設定は `~/.config/coucou/`、ログは `~/.local/share/coucou/coucou.log` です。
- Windows 版にないものは、こちらにもありません (メールでのファイル送信、Mochi のウィンドウへのドラッグ、
  特定のターミナルウィンドウへのジャンプ)。

## Fork とライセンス

これは [Louis-CFM/coucou](https://github.com/Louis-CFM/coucou) の Fork です。ソースコードは MIT ライセンス
([LICENSE](../LICENSE)) です。この Fork での変更は [RELEASE_NOTES.md](RELEASE_NOTES.md) と
[CHANGELOG.md](CHANGELOG.md) に書いてあります。名前、Mochi のキャラクター、アイコン、
サウンドは MIT ライセンスの**対象外**です ([LICENSE-ASSETS.md](../LICENSE-ASSETS.md))。これらを含むビルドを
配布しないでください。このコードから自分のアプリを出すときは、自分の名前、アイコン、キャラクター、
サウンドにしてください。

WSL から接続を試す手順 (1つずつ): [docs/TESTING_WSL.md](docs/TESTING_WSL.md)
