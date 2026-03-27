# 📊 市場回撤監控儀表板 — 部署說明

> VOO · 那斯達克 · 費半 SOX · WTI 油價 · 黃金 · 006208

---

## 📁 專案結構

```
market-drawdown-monitor/
│
├── drawdown-dashboard.html      ← ① 純 HTML 單頁應用（可直接開啟或部署）
│
├── pages/
│   └── api/
│       └── prices.js            ← ② Next.js 後端 API（串接真實數據）
│
├── scripts/
│   └── send-report.js           ← ③ 每日 Email 報表腳本
│
├── .github/
│   └── workflows/
│       └── daily-report.yml     ← ④ GitHub Actions 自動排程
│
├── package.json
└── README.md
```

---

## 🚀 方案一：純 HTML（最快，5 分鐘上線）

只需要 `drawdown-dashboard.html` 一個檔案，目前顯示模擬數據。

### 部署到 Vercel（免費）

```bash
# 1. 安裝 Vercel CLI
npm i -g vercel

# 2. 登入
vercel login

# 3. 部署（在專案資料夾執行）
vercel --prod
```

或直接去 [vercel.com](https://vercel.com)：
1. **New Project** → Import GitHub Repo
2. Framework Preset 選 **Other**
3. 完成，取得 URL 如 `https://drawdown-xxx.vercel.app`

---

## 🔌 方案二：串接真實數據（Next.js）

### Step 1：安裝依賴

```bash
npm install next react react-dom yahoo-finance2 @sendgrid/mail
```

### Step 2：建立 Next.js 結構

```bash
mkdir -p pages/api scripts .github/workflows
```

把以下檔案放到對應位置：
- `pages/api/prices.js` — 後端 API
- `drawdown-dashboard.html` → 改名為 `pages/index.html` 或轉成 React

### Step 3：修改前端設定

在 `drawdown-dashboard.html` 中，找到這行並改為 `true`：

```javascript
const USE_REAL_DATA = false;  // ← 改成 true
const API_BASE = '/api';      // ← 保持不變（本機）或改成完整 URL
```

### Step 4：本機測試

```bash
npm run dev
# 開啟 http://localhost:3000
```

### Step 5：部署到 Vercel

```bash
vercel --prod
```

**Vercel 會自動處理 `pages/api/` 的 Serverless Functions！**

---

## 📧 方案三：每日 Email 報表

### 前置作業

#### A. 申請 SendGrid（免費每日 100 封）

1. 去 [sendgrid.com](https://sendgrid.com) 免費註冊
2. **Settings → API Keys → Create API Key**（Full Access）
3. 複製 API Key（`SG.xxxxx`）
4. **Settings → Sender Authentication** → 驗證你的寄件 Email

#### B. 手動測試

```bash
SENDGRID_KEY="SG.your_key" \
RECIPIENT="you@gmail.com" \
FROM_EMAIL="sender@yourdomain.com" \
node scripts/send-report.js
```

---

## ⚙️ GitHub Actions 自動排程

### Step 1：Push 到 GitHub

```bash
git init
git add .
git commit -m "feat: market drawdown monitor"
git remote add origin https://github.com/你的帳號/market-drawdown-monitor.git
git push -u origin main
```

### Step 2：設定 GitHub Secrets

去 `GitHub Repo → Settings → Secrets and variables → Actions → New repository secret`

| Secret 名稱     | 值               | 說明                     |
|----------------|-----------------|--------------------------|
| `SENDGRID_KEY` | `SG.xxxxxxxx`   | SendGrid API Key         |
| `RECIPIENT`    | `a@b.com,c@d.com` | 收件人，逗號分隔多人     |
| `FROM_EMAIL`   | `no-reply@xxx.com` | 已驗證的寄件 Email     |

### Step 3：確認 Workflow 啟用

1. 去 GitHub Repo → **Actions**
2. 看到 `每日市場回撤報表` workflow
3. 點 **Enable workflow**

### 排程時間

| Cron | UTC 時間 | 台灣時間（UTC+8）|
|------|---------|----------------|
| `30 23 * * 1-5` | 23:30 | 🌅 隔天 07:30（早報）|
| `0 12 * * 1-5`  | 12:00 | 🌙 20:00（晚報）|

---

## 🔧 常見問題

**Q：006208 抓不到數據？**
A：Yahoo Finance 代號是 `0068.TW`，注意不是 `006208.TW`。

**Q：WTI 和黃金用的是期貨？**
A：是的，`CL=F`（原油近月期貨）、`GC=F`（黃金近月期貨）。

**Q：那斯達克為什麼用 QQQ？**
A：Yahoo Finance 的那斯達克指數（`^IXIC`）不提供完整歷史週線，改用 QQQ ETF（追蹤那斯達克100）。費半同理用 SOXX ETF。

**Q：Vercel 免費方案夠用嗎？**
A：完全夠用。Serverless Function 每月有 100GB 流量，每日 API 請求遠低於限制。

**Q：如何加入更多指數？**
A：在 `pages/api/prices.js` 的 `SYMBOLS` 物件中加入新的 Yahoo Finance 代號即可。

---

## 📝 環境變數總覽

```bash
# .env.local（本機開發用）
SENDGRID_KEY=SG.your_api_key_here
RECIPIENT=your@email.com
FROM_EMAIL=noreply@yourdomain.com
DD_THRESHOLD=10
```

---

*數據來源：Yahoo Finance · 自動化：GitHub Actions · 部署：Vercel*
*⚠️ 僅供參考，不構成投資建議*
