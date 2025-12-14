# 長福會考勤系統 - 雲端部署評估

## 技術架構

| 項目 | 技術 |
|------|------|
| 框架 | Next.js 15.4 |
| 運行時 | React 19 |
| 資料庫 | SQLite + Prisma ORM |
| 認證 | JWT + bcrypt |
| 樣式 | Tailwind CSS 4 |

---

## ⚠️ 雲端部署可行性評估

### 🔴 **不建議直接部署** - 需要調整

#### 主要問題：SQLite 資料庫

| 問題 | 說明 |
|------|------|
| **無狀態容器不兼容** | 雲端平台（Vercel/Railway/Render）使用無狀態容器，SQLite 檔案會在重啟後遺失 |
| **無法水平擴展** | SQLite 不支援多實例並發寫入 |
| **備份困難** | 檔案型資料庫難以自動備份 |

#### 內存存儲問題

| 模組 | 問題 |
|------|------|
| Rate Limiting | 使用 `Map` 存儲，重啟後遺失 |
| CSRF Tokens | 使用 `Map` 存儲，重啟後遺失 |
| IP 封鎖記錄 | 使用 `Map` 存儲，重啟後遺失 |

---

## ✅ 雲端部署方案

### 方案一：使用 PostgreSQL/MySQL（推薦）

1. **修改 Prisma schema**
```prisma
datasource db {
  provider = "postgresql"  // 或 "mysql"
  url      = env("DATABASE_URL")
}
```

2. **使用雲端資料庫服務**
   - Supabase（免費 500MB）
   - PlanetScale（免費 5GB）
   - Neon（免費 512MB）
   - Railway PostgreSQL

3. **部署平台選擇**
   - Vercel（最佳 Next.js 支援）
   - Railway
   - Render
   - Fly.io

---

### 方案二：使用 Turso（SQLite 雲端）

保留 SQLite 語法，使用雲端 SQLite 服務：

```prisma
datasource db {
  provider = "sqlite"
  url      = "libsql://your-db.turso.io?authToken=xxx"
}
```

---

### 方案三：VPS 自架（保留現有架構）

如果要保留 SQLite：
- 使用 VPS（阿里雲/AWS EC2/DigitalOcean）
- 使用 Docker 配合持久化卷
- 設定自動備份

---

## 環境變數需求

```bash
# 必須設定
DATABASE_URL=postgresql://...
JWT_SECRET=your-secret-key

# 可選
NODE_ENV=production
```

---

## 部署前檢查清單

- [ ] 將資料庫從 SQLite 遷移至 PostgreSQL
- [ ] 設定環境變數
- [ ] 使用 Redis 替代內存存儲（Rate Limit/CSRF）
- [ ] 配置 HTTPS
- [ ] 設定資料庫備份策略

---

## 結論

| 評估項目 | 狀態 |
|----------|------|
| 程式碼品質 | ✅ 可部署 |
| 安全機制 | ✅ 完善 |
| 資料庫架構 | ⚠️ 需遷移 |
| 內存存儲 | ⚠️ 需改進 |

**建議**：遷移至 PostgreSQL 後可順利部署至任何雲端平台。
