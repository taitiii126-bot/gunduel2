# GUN DUEL サーバー

`index.html`（ゲーム本体）のオンライン対戦用サーバーです。Node.js だけで動きます（npm パッケージ不要）。

## 全体の構成

```text
ゲームのページ   GitHub Pages   https://あなたのユーザー名.github.io/gunduel/
対戦サーバー     Railway        wss://〇〇.up.railway.app（地域：Singapore）
ログイン         Discord        （サーバーがDiscordと直接やり取りする）
```

ページを開くときだけ GitHub Pages からファイルを受け取り、**対戦中は Railway のサーバーとだけ通信**します。設定はすべてブラウザで完結します。

---

## 1. GitHub にアップして、ゲームを公開する

1. github.com の右上「＋」→ **New repository** → 名前を `gunduel`、**Public** で作成
2. 「uploading an existing file」を開き、パソコンの `Downloads\GUNDUEL` フォルダの**中身**（`index.html` と `server` フォルダ）をドラッグ → **Commit changes**
3. リポジトリの **Settings → Pages** で、Branch を `main`、フォルダを `/ (root)` にして Save

1〜2分で `https://あなたのユーザー名.github.io/gunduel/` でゲームが開けるようになります。公開リポジトリで問題ありません（秘密の情報はファイルに入っておらず、Railwayの設定にだけ置きます）。

## 2. Railway にサーバーを載せる

### サービスを作る（または今のサービスを差し替える）

- **今のサービス（gun-duel-server）を使う場合**：サービスを開き **Settings → Source** で「Connect Repo」から `gunduel` リポジトリを選びます。アドレスが今と同じまま使えます
- **新しく作る場合**：プロジェクトで **＋ New → GitHub Repo** → `gunduel` を選びます

### Settings で設定する項目

| 項目 | 設定 |
|---|---|
| Source → **Root Directory** | `server` |
| Deploy → **Region** | **Southeast Asia (Singapore)** |
| Deploy → Healthcheck Path（任意） | `/health` |
| Networking → **Public Networking** | 「Generate Domain」でアドレスを作る（すでにあればそのまま） |

起動コマンドは自動で `npm start`（= `node server.js`）になります。ポートもRailwayが自動で渡します。

### Variables（環境変数）

| 変数 | 値 |
|---|---|
| `TRUST_PROXY` | `1` |
| `DATA_DIR` | `/data` |
| `DISCORD_CLIENT_ID` | DiscordのClient ID（3.で取得） |
| `DISCORD_CLIENT_SECRET` | DiscordのClient Secret（3.で取得） |
| `ALLOWED_ORIGINS` | `https://あなたのユーザー名.github.io`（パスは付けない） |

### Volume（アカウントの保存先）

サービスを右クリック（またはコマンドパレット）→ **Add Volume** → Mount Path を **`/data`** にします。これがないと、再デプロイのたびにアカウントと戦績が消えます。

### 動作確認

ブラウザで `https://〇〇.up.railway.app/health` を開きます。

- `{"ok":true,...}` と出れば起動しています
- **`yourIp` があなたの本当のIPになっているか**確認してください（`10.` や `100.` で始まる場合は、IPごとの制限が正しく働かないので教えてください）

## 3. Discord ログインを有効にする

1. https://discord.com/developers/applications でアプリを作る（New Application）
2. **OAuth2** で **Client ID** をコピーし、**Reset Secret** で **Client Secret** を作ってコピー（一度しか表示されません）
3. 同じ画面の **Redirects** に `https://あなたのユーザー名.github.io/gunduel/` を追加して **Save Changes**（末尾の `/` まで完全一致）
4. RailwayのVariablesに2つの値を入れる（入れると自動で再起動します）

`https://〇〇.up.railway.app/api/config` が `{"login":true,...}` を返せばOKです。**シークレットはGitHubやHTMLには絶対に置かないでください。**

## 4. ゲーム側の設定

ゲームのタイトル画面下の「SERVER」欄に `wss://〇〇.up.railway.app` を入れると、オンライン対戦とログインが使えます。全員に反映するには、`index.html` の `id="server-url"` の `value` を書き換えてGitHubに上げ直します（今のRailwayサービスを使うなら書き換え不要です）。

## 更新するとき

GitHubのWebでファイルを差し替えるだけです。Railwayが自動で再デプロイし、GitHub Pagesにも自動で反映されます。

---

## チート対策

### 自動で行われること

| 対策 | 内容 |
|---|---|
| サーバー権威 | 移動・弾・当たり判定・ダメージ・回復・リロードは全部サーバーが計算。HP改ざん・速度改ざん・連射ツールは効かない |
| 本人確認 | ログイン中の人の名前はDiscordのものに差し替えるので、なりすまし不可 |
| 自動射撃BOTの検知 | 「狙いが合った瞬間に撃つ」を人間には無理な精度で続けたら検知 |
| 自動回避の検知 | 自分を狙った弾が出てから0.1秒以内に跳んで避けるのを、人間には無理な割合で続けたら検知 |
| マクロの検知 | 左右・しゃがみの切り替えが1秒30回以上、3秒続いたら検知 |
| コンソール・ブックマークレット対策 | ゲームの中身（武器の数値・敵の位置・戦績の記録処理）を外から見えない形に閉じ込め、基本数値は書き換え不可。「拾ったコードを貼るだけ」のチートは動かない |
| 戦績の水増し防止 | 次の場合は記録しない：ゲストが混ざっている／同じアカウント同士／同じネットワーク同士（サブ垢対策）／どちらかが放置／疑わしい操作を検知／同じ2人の対戦が1日10回を超えた |
| 途中退出 | 1ラウンド以上終わったあとに抜けたら負けとして記録（負けを逃げられない） |
| PING偽装防止 | 相手に見せるPINGはサーバーが自分で測った値 |
| 荒らし対策 | 部屋番号の入力ミスは10分で10回まで／同じIPからの接続は8本まで／同じIPが同時に作れる部屋は3つまで／1接続あたりのメッセージ数制限 |

検知しても本人には知らせません（対策を調整されないため）。ログとアカウントに記録されるので、BANするかはあなたが判断します。

### 怪しい人を見つけて BAN する

1. Railwayのサービス → **Deployments → View Logs** で `SUSPECT` を検索
2. `SUSPECT discord=123456789 name=〇〇 ip=… 理由` の形で出ているので、`discord=` の数字をコピー
3. Variables の `BANNED_DISCORD_IDS` に入れる（複数ならカンマ区切り）

BANされた人はログインもできず、保存されていたログイン状態も使えなくなります。ゲストで荒らす人は `BANNED_IPS` にIPを入れます。

**BANを確実に効かせたい場合**は `REQUIRE_LOGIN=1` にしてください。オンライン対戦がDiscordログイン必須になり、ゲストでは入れなくなります。

### 注意

- **ブラウザの中で動くものは、原理的に100%は守れません。** デバッガを使いこなす人なら、CPU戦の改造やティア表示の偽装はできます。ただしオンライン対戦の勝敗と戦績はサーバーが決めるので、改造しても結果は変わりません

- **同じ家のWi-Fiから2人で遊ぶと、同じネットワーク扱いで戦績が記録されません。** 記録したい場合は `ALLOW_SAME_IP_RECORDS=1` にしてください（サブ垢での水増しは防げなくなります）
- ティア（LT/HT）はCPU戦の結果から計算していて検証できないため、自己申告のまま表示されます
- CPU戦の成績は各端末に保存されるだけで、公式記録には入りません

## 設定（環境変数）一覧

| 変数 | 既定値 | 内容 |
|---|---|---|
| `PORT` | Railwayが自動設定 | 待ち受けポート |
| `TRUST_PROXY` | Railwayなら自動で有効 | プロキシが付ける接続元IPを信用する |
| `DATA_DIR` | サーバーのフォルダ | アカウント情報（users.json）の保存先。Railwayでは Volume の `/data` |
| `ALLOWED_ORIGINS` | なし（全許可） | 接続を許可するゲームページのURL（カンマ区切り） |
| `DISCORD_CLIENT_ID` | なし | Discordログイン用。未設定ならログイン機能は無効 |
| `DISCORD_CLIENT_SECRET` | なし | 同上。外に出さないこと |
| `REQUIRE_LOGIN` | オフ | `1` でオンライン対戦をログイン必須にする |
| `BANNED_DISCORD_IDS` | なし | 利用停止するDiscordユーザーID（カンマ区切り） |
| `BANNED_IPS` | なし | 利用停止するIP（カンマ区切り） |
| `ALLOW_SAME_IP_RECORDS` | オフ | `1` で同じネットワーク同士の対戦も記録する |
| `PAIR_DAILY_CAP` | `10` | 同じ2人の対戦を1日に記録する上限 |
| `MAX_CONNS_PER_IP` | `8` | 同じIPからの同時接続数 |
| `MAX_ROOMS_PER_IP` | `3` | 同じIPが同時に作れる部屋の数 |
| `MAX_ROOMS` | `100` | 同時に作れる部屋の数 |
| `MAX_CONNS` | `300` | 同時接続数の上限 |
| `BOT_MIN_SHOTS` | `20` | 自動射撃の判定を始めるまでの攻撃回数 |
| `DODGE_MIN_THREATS` | `8` | 自動回避の判定を始めるまでに狙われた回数 |

## 仕組み

- 60Hzで計算して、60Hzで状態を配信します。ゲーム側は相手の位置を速度から先読みして表示するので、通信の遅れが見えにくくなっています
- ログインはDiscordのOAuth2。サーバーがDiscordと直接やり取りし、ゲームには自前のトークンだけを渡します
- 部屋番号は6桁のランダム。相手が10分来なければ部屋は自動で閉じます
- HP・武器性能・足場などの数値は `game.js` にも同じ値を持っています。`index.html` 側でバランスを変えたら `game.js` もそろえてください
- `gunduel.service` はラズパイなど自前のLinuxで動かす場合の自動起動設定です（Railwayでは使いません）
