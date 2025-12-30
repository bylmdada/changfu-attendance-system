# 定時排程設定指南

本文件說明如何設定系統的定時排程任務（CRON Jobs）。

## 加班警示定時檢查

系統提供 `/api/cron/overtime-warning` API 端點，用於定期掃描員工加班時數並發送警示通知。

### 警示閾值

| 等級 | 閾值 | 說明 |
|------|------|------|
| 🟡 WARNING | 40 小時/月 | 接近警戒線，提醒注意 |
| 🔴 CRITICAL | 46 小時/月 | 超過法定上限，違反勞基法 |

---

## 設定方式

### 方式一：Linux Crontab

在伺服器上編輯 crontab：

```bash
crontab -e
```

加入以下排程（每週一早上 9 點執行）：

```bash
# 每週一早上 9 點檢查加班時數
0 9 * * 1 curl -X POST https://your-domain.com/api/cron/overtime-warning -H "x-cron-secret: YOUR_CRON_SECRET"

# 每月 1 號早上 8 點執行完整月度檢查
0 8 1 * * curl -X POST https://your-domain.com/api/cron/overtime-warning -H "x-cron-secret: YOUR_CRON_SECRET"
```

### 方式二：Vercel Cron Jobs

如果部署在 Vercel，在 `vercel.json` 中加入：

```json
{
  "crons": [
    {
      "path": "/api/cron/overtime-warning",
      "schedule": "0 9 * * 1"
    }
  ]
}
```

### 方式三：GitHub Actions

建立 `.github/workflows/cron-overtime-warning.yml`：

```yaml
name: Overtime Warning Check

on:
  schedule:
    # 每週一早上 9 點 (UTC+8，即 UTC 1:00)
    - cron: '0 1 * * 1'
  workflow_dispatch: # 允許手動觸發

jobs:
  check-overtime:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Overtime Warning Check
        run: |
          curl -X POST ${{ secrets.APP_URL }}/api/cron/overtime-warning \
            -H "x-cron-secret: ${{ secrets.CRON_SECRET }}" \
            -H "Content-Type: application/json"
```

---

## 安全設定

### 設定 CRON Secret

在 `.env` 中加入：

```bash
CRON_SECRET=your_random_secret_key_here
```

產生隨機金鑰：

```bash
openssl rand -hex 32
```

---

## 手動觸發

可透過以下方式手動觸發檢查：

```bash
# 使用管理員 Token
curl -X POST https://your-domain.com/api/cron/overtime-warning \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"

# 使用 CRON Secret
curl -X POST https://your-domain.com/api/cron/overtime-warning \
  -H "x-cron-secret: YOUR_CRON_SECRET"

# 指定特定年月
curl -X POST https://your-domain.com/api/cron/overtime-warning \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"year": 2024, "month": 12}'
```

---

## 預覽模式（不發送通知）

使用 GET 請求可預覽當月加班狀態，不會發送通知：

```bash
curl https://your-domain.com/api/cron/overtime-warning \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

回傳範例：

```json
{
  "success": true,
  "period": { "year": 2024, "month": 12 },
  "thresholds": { "WARNING": 40, "LEGAL_LIMIT": 46 },
  "summary": {
    "totalEmployees": 40,
    "warningCount": 3,
    "criticalCount": 1,
    "averageHours": 25.5
  },
  "employees": [
    {
      "employeeId": 1,
      "employeeCode": "EMP001",
      "name": "王小明",
      "totalHours": 48.5,
      "alertLevel": "CRITICAL"
    }
  ]
}
```

---

## 其他可用排程

| 排程 | Cron 表達式 | 說明 |
|------|-------------|------|
| 每週一 9:00 | `0 9 * * 1` | 推薦：定期週檢 |
| 每月 1 號 8:00 | `0 8 1 * *` | 月初完整檢查 |
| 每天 18:00 | `0 18 * * *` | 每日下班前檢查 |
| 每月 15 號 9:00 | `0 9 15 * *` | 月中期檢查 |
