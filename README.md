# 台股投資模擬競賽平台

> 國立臺灣科技大學 — 理財工具實務與應用

一個給課堂使用的台股投資模擬競賽網站。每位同學拿到相同的起始本金，在指定期間內買賣**上市／上櫃真實股票**，系統以**每日收盤價**結算淨值並即時排名。

![tech](https://img.shields.io/badge/React-18-61dafb) ![tech](https://img.shields.io/badge/Vite-6-646cff) ![tech](https://img.shields.io/badge/Firebase-11-ffca28) ![tech](https://img.shields.io/badge/Netlify-Functions-00c7b7)

---

## 功能

| 功能 | 說明 |
|---|---|
| 🔐 **登入／帳號** | 學生用**學號 + 密碼**登入，不用信箱。老師匯入名單後，學生自行「首次啟用帳號」設定密碼 |
| 📋 **名單匯入** | 直接從 Google 試算表複製整塊貼上（或上傳 CSV），自動辨識欄位，可一併匯入初始持股 |
| 💹 **交易下單** | 搜尋代號或中文名稱（上市＋上櫃 12,000+ 檔），以當日收盤價買賣，支援零股 |
| 🧾 **交易紀錄** | 完整買進／賣出歷史，含手續費、證交稅、每筆已實現損益，可匯出 CSV |
| 📊 **每日結算** | 依競賽期間每個交易日的收盤價計算淨值，可永久保存做為成績存證 |
| 🏆 **排行榜** | 個人與分組排名、報酬率走勢比較、與 0050／大盤對照，可匯出成績 CSV |
| ⚙️ **競賽設定** | 起始日、結算日、起始本金、手續費率與折扣、證交稅率、鎖定交易 |

---

## 快速開始（本機）

```bash
npm install
npm run dev
```

打開 <http://localhost:5173> 即可。

**還沒有 Firebase 也能先玩**：沒有設定 Firebase 環境變數時，網站會自動進入「本機示範模式」，資料存在瀏覽器裡。**第一個啟用的帳號會自動成為老師（管理者）**，可以直接測試匯入名單、下單、排行榜等所有功能。

---

## 部署到 Netlify

1. 到 Netlify → **Add new site → Import an existing project**，選這個 GitHub repo
2. 建置設定會自動從 `netlify.toml` 讀取，不用手動填：
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
3. 到 **Site settings → Environment variables**，加入下面「Firebase 設定」那一節的變數
4. Deploy

`netlify/functions/` 內的兩支 Function 負責向證交所／櫃買中心／Yahoo 取報價，
順便解決瀏覽器直接呼叫這些網站會遇到的 CORS 問題。

---

## Firebase 設定

### 1. 建立專案

到 [Firebase 主控台](https://console.firebase.google.com/) 建立專案，然後：

- **Authentication** → 開始使用 → 登入方式 → 啟用 **電子郵件/密碼**
- **Firestore Database** → 建立資料庫 → 選 **asia-east1（台灣）** → 正式版模式

### 2. 取得設定值

專案設定 ⚙️ → 一般 → 你的應用程式 → **網頁應用程式**（沒有就新增一個）→ SDK 設定與配置 → 設定

把值填進 `.env.local`（本機）與 Netlify 環境變數（線上）：

```bash
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=你的專案.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=你的專案
VITE_FIREBASE_STORAGE_BUCKET=你的專案.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123...:web:abc...

# 老師的學號（可多筆，逗號分隔）
VITE_ADMIN_IDS=teacher
```

> 可以先 `cp .env.example .env.local` 再修改。
> `.env.local` 已經在 `.gitignore` 裡，不會被推上 GitHub。

### 3. 部署安全性規則

打開 `firestore.rules`，把裡面的 `adminIds()` 改成你的學號（**要大寫**，且要和 `VITE_ADMIN_IDS` 一致）：

```javascript
function adminIds() {
  return ['TEACHER'];        // ← 改成你的學號
}
```

然後到 **Firestore Database → 規則**，把整份檔案貼上去按「發布」。

> ⚠️ 這一步一定要做。沒做的話會出現「權限不足」，或是任何人都能改別人的資料。

### 4. 老師第一次登入

到網站 → 「首次啟用帳號」→ 輸入你在 `VITE_ADMIN_IDS` 設定的學號 → 設定密碼 → 完成。
系統會自動把你建立成管理者。

### Firestore 資料結構

```
config/contest              競賽設定（期間、本金、費率）
students/{學號}             名單：姓名、組別、身分、是否已啟用
trades/{自動ID}             每一筆買賣紀錄（不可竄改）
prices/{代號}               日收盤價快取，全班共用
settlements/{YYYY-MM-DD}    每日結算的淨值與名次
```

---

## 老師的操作流程

```
1. 管理 → 競賽設定      設定起始日、結算日、起始本金（預設 2,000,000）
2. 管理 → 匯入名單      從 Google 試算表複製貼上 → 確認欄位 → 開始匯入
3. 請同學到登入頁「首次啟用帳號」，用自己的學號設定密碼
4. 競賽期間同學自行下單，排行榜即時更新
5. 管理 → 每日結算      按「執行結算」保存每日淨值（成績存證）
6. 排行榜 → 匯出成績 CSV
```

### 匯入名單的格式

直接把 Google 試算表的範圍選起來 `Ctrl+C`，貼到匯入框就好。系統會自動辨識這些欄位：

| 欄位 | 必要 | 說明 |
|---|---|---|
| 學號 | ✅ | 登入帳號 |
| 姓名 | | |
| 組別 | | 分組排名用 |
| 代號 | | 勾選「同時匯入初始持股」時才需要 |
| 投資金額 / 股數 | | 有股數就用股數，否則用「投資金額 ÷ 收盤價」換算（會預留手續費） |
| 買入日期 | | 沒有就用畫面上選的日期 |
| 起始本金 | | 留空則沿用競賽預設 |

同一位同學有多檔持股時，**分成多列、學號重複填寫**即可（跟現有的試算表一樣）。

---

## 計算規則

### 成交價

- **一律以收盤價成交，不能指定價格**
- 盤中（台北時間 14:00 前）下單，會用**最近一個已收盤交易日**的收盤價
  —— 這樣同一天不同時間下單不會拿到不同價格，競賽才公平
- 當天 14:00 之後，今日收盤價才會生效

### 交易成本（可在競賽設定調整）

| 項目 | 預設 | 說明 |
|---|---|---|
| 手續費 | 0.1425% | 買賣都收，無條件捨去到元 |
| 手續費折扣 | 1（不打折） | 想模擬電子下單折扣可改 0.6 |
| 最低手續費 | 20 元 | |
| 證交稅 | 0.3% | 只有賣出收；ETF 可改 0.1% |

```
買進應付 = 成交價 × 股數 + 手續費
賣出實收 = 成交價 × 股數 − 手續費 − 證交稅
```

### 淨值與報酬率

```
某日淨值 = 現金餘額 + Σ(持股股數 × 該日收盤價)
報酬率   = (淨值 − 起始本金) ÷ 起始本金
```

- 平均成本採**含手續費**的移動平均
- 賣出時的已實現損益 = 實收金額 − 賣出股數 × 平均成本
- 個股當日沒有報價（停牌等）時，沿用前一個交易日的收盤價

### 限制

- 買進不得超過現金餘額，賣出不得超過持股（不能放空、不能融資）
- 交易日必須在競賽期間內
- 學生只能用最新的交易日下單；**老師可以回補歷史日期**（修正用）

---

## 報價資料來源

| 用途 | 來源 |
|---|---|
| 日收盤價（主要） | Yahoo Finance chart API — 上市 `.TW`、上櫃 `.TWO` |
| 日收盤價（備援） | [證交所 STOCK_DAY](https://www.twse.com.tw/) 各日成交資訊 |
| 全市場代號清單 | [證交所 OpenAPI](https://openapi.twse.com.tw/) + [櫃買中心 OpenAPI](https://www.tpex.org.tw/openapi/) |

報價會快取在 Firestore 的 `prices` 集合，全班共用，不會每個人都去打外部 API。

> **關於除權息**：收盤價採未還原價格（和證交所、各大看盤軟體顯示的一致）。
> 個股在競賽期間除權息時，股價會出現帳面上的跳空缺口，但模擬帳戶不會收到股利。
> 秋季班（9～12 月）除權息高峰已過，影響很小；若在意可以避開除權息個股，
> 或在課堂上當作一個可以討論的題目。

---

## 專案結構

```
├── netlify/functions/     Netlify Functions（報價 API）
│   ├── stock-price.mjs        GET /api/stock-price
│   └── stock-list.mjs         GET /api/stock-list
├── server/                Function 與 Vite dev server 共用的後端邏輯
│   ├── twstock.mjs            台股報價抓取（Yahoo／證交所／櫃買）
│   └── api.mjs                API 路由
├── src/
│   ├── lib/                   純計算：投資組合、手續費、格式化、CSV
│   ├── services/              資料層（Firebase／本機雙後端）、報價服務
│   ├── context/               全域狀態
│   ├── components/            圖表、搜尋框等共用元件
│   └── pages/                 登入、儀表板、下單、紀錄、排行榜、管理
├── firestore.rules        Firestore 安全性規則（記得改 adminIds 並部署）
└── netlify.toml           Netlify 建置與路由設定
```

`npm run dev` 會把 `/api/*` 直接掛在 Vite dev server 上（行為與 Netlify Functions 一致），
所以本機開發不需要另外安裝 netlify-cli。

---

## 常用指令

```bash
npm run dev      # 本機開發（含 /api）
npm run build    # 產出 dist/
npm run preview  # 預覽 build 結果
```
