# Schedule breakTime 上線清單

本文件是本次 `Schedule.breakTime` 版本的實際上線步驟，適用於目前正式環境：`DigitalOcean VPS + PM2 + Nginx + Cloudflare`。

適用情境：

- 已完成本機修正與驗證
- 正式站使用 `attendance` PM2 process
- 遠端目錄不是乾淨的 git checkout，平常以本機 build 後同步 artifact 為主
- 本次變更包含 Prisma schema 變更，不能只同步 `.next`

## 變更摘要

- 新增 Prisma migration：`prisma/migrations/20260417_add_schedule_break_time/migration.sql`
- `Schedule` 新增資料欄位：`break_time INTEGER NOT NULL DEFAULT 0`
- 班表 API 已開始讀寫 `breakTime`
- attendance 正常工時/加班工時改為依班表休息時間扣除

重要注意：

- `breakTime` 的業務語意是「每筆班表自己的休息時間」，不是由 `A/B/C` 班別代碼永久推導出的固定值。
- 若要做歷史資料回填，必須先確認來源規則或原始資料；不能把 `A/B/C=60` 當成通用制度直接套用到所有環境。

## 上線前條件

- 本機 Node 版本與 VPS 一致，建議固定 `20.19.6`
- 本機 `npm run build` 已通過
- 本機目標測試已通過
- VPS `deploy` 使用者可正常執行 `source ~/.nvm/nvm.sh && pm2 status`
- VPS 應用路徑確認為 `/home/deploy/apps/changfu-attendance`

## 第 1 步：本機最終驗證

在本機專案根目錄執行：

```bash
source ~/.nvm/nvm.sh
nvm use 20.19.6

npm test -- src/lib/__tests__/work-hours.test.ts src/app/api/attendance/records/__tests__/route.test.ts src/app/api/schedules/__tests__/route.test.ts
npm run build
```

預期結果：

- 3 個 Jest suite 全綠
- `npm run build` 成功

## 第 2 步：VPS 資料庫備份

先建立正式資料庫備份，再做 migration：

```bash
ssh deploy@188.166.229.128 'bash /home/deploy/backup-database.sh && tail -n 6 /home/deploy/backup.log'
```

若要額外做一次 release 專用快照，可執行：

```bash
ssh deploy@188.166.229.128 '
  cp /home/deploy/apps/changfu-attendance/prisma/prod.db \
     /home/deploy/apps/changfu-attendance/prisma/prod.db.pre-breaktime-$(date +%Y%m%d-%H%M%S)
'
```

## 第 3 步：同步這次版本需要的檔案

### 3.1 同步 Next build artifact

```bash
rsync -avz --delete .next/ deploy@188.166.229.128:~/apps/changfu-attendance/.next/
```

### 3.2 同步 Prisma schema 與 migration

這一步是本次版本關鍵。若少了這一步，遠端 Prisma client 與資料庫 migration 會不同步。

```bash
rsync -avz prisma/schema.prisma deploy@188.166.229.128:~/apps/changfu-attendance/prisma/schema.prisma
rsync -avz prisma/migrations/20260417_add_schedule_break_time/ deploy@188.166.229.128:~/apps/changfu-attendance/prisma/migrations/20260417_add_schedule_break_time/
```

## 第 4 步：VPS 上更新 Prisma client 並執行 migration

```bash
ssh deploy@188.166.229.128 '
  cd /home/deploy/apps/changfu-attendance && \
  source ~/.nvm/nvm.sh && \
  npx prisma generate && \
  npx prisma migrate deploy
'
```

預期結果：

- `prisma generate` 成功
- `20260417_add_schedule_break_time` 被套用，或顯示 migration 已存在

## 第 5 步：重啟 PM2 應用

```bash
ssh deploy@188.166.229.128 '
  cd /home/deploy/apps/changfu-attendance && \
  source ~/.nvm/nvm.sh && \
  pm2 restart attendance && \
  pm2 status
'
```

## 第 6 步：上線後健康檢查

```bash
ssh deploy@188.166.229.128 "curl -I http://127.0.0.1:3000/api/health"
curl -I https://changfu.me/api/health
curl -I https://changfu.me
```

預期結果：

- 內網 `http://127.0.0.1:3000/api/health` 回 `200`
- 外網 `https://changfu.me/api/health` 回 `200`
- 首頁不是 `500`

若要看服務狀態：

```bash
ssh deploy@188.166.229.128 '
  source ~/.nvm/nvm.sh && \
  pm2 show attendance
'
```

## 第 7 步：功能 smoke test

建議至少人工驗證以下流程：

- 班表管理頁可以新增或編輯 `breakTime`
- 套用 weekly template 後，休息時間有正確帶入
- 一般打卡下班後，正常工時會扣掉班表休息時間
- 考勤記錄頁的正常工時與加班工時顯示正確
- 今日摘要頁顯示沒有異常

## 回滾方案

若 migration 後或重啟後發生異常，依序執行：

### 方案 A：先回退應用 artifact

- 將上一版 `.next` 還原回去
- `pm2 restart attendance`

### 方案 B：連資料庫一起回退

1. 停止服務
2. 還原本次 release 前備份的 `prod.db`
3. 還原上一版 `.next`
4. 重新啟動 PM2

參考指令：

```bash
ssh deploy@188.166.229.128 '
  cd /home/deploy/apps/changfu-attendance && \
  source ~/.nvm/nvm.sh && \
  pm2 stop attendance
'
```

```bash
ssh deploy@188.166.229.128 '
  cp /home/deploy/apps/changfu-attendance/prisma/prod.db.pre-breaktime-YYYYMMDD-HHMMSS \
     /home/deploy/apps/changfu-attendance/prisma/prod.db
'
```

```bash
ssh deploy@188.166.229.128 '
  cd /home/deploy/apps/changfu-attendance && \
  source ~/.nvm/nvm.sh && \
  pm2 restart attendance
'
```

## 最短執行版

若只需要最短指令順序，可依下列順序執行：

```bash
source ~/.nvm/nvm.sh
nvm use 20.19.6
npm run build

ssh deploy@188.166.229.128 'bash /home/deploy/backup-database.sh'
rsync -avz --delete .next/ deploy@188.166.229.128:~/apps/changfu-attendance/.next/
rsync -avz prisma/schema.prisma deploy@188.166.229.128:~/apps/changfu-attendance/prisma/schema.prisma
rsync -avz prisma/migrations/20260417_add_schedule_break_time/ deploy@188.166.229.128:~/apps/changfu-attendance/prisma/migrations/20260417_add_schedule_break_time/

ssh deploy@188.166.229.128 '
  cd /home/deploy/apps/changfu-attendance && \
  source ~/.nvm/nvm.sh && \
  npx prisma generate && \
  npx prisma migrate deploy && \
  pm2 restart attendance
'

ssh deploy@188.166.229.128 "curl -I http://127.0.0.1:3000/api/health"
curl -I https://changfu.me/api/health
```