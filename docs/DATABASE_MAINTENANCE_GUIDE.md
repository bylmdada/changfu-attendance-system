# 📊 長福考勤系統 - 資料庫維護完整指南

**維護版本：** v2.0  
**最後更新：** 2025年11月10日  
**資料庫類型：** SQLite with WAL Mode  
**適用環境：** 開發/生產環境  

---

## 📋 目錄

1. [資料庫架構概覽](#資料庫架構概覽)
2. [日常維護任務](#日常維護任務)
3. [性能優化](#性能優化)
4. [備份與恢復](#備份與恢復)
5. [監控與警報](#監控與警報)
6. [故障排除](#故障排除)
7. [自動化維護](#自動化維護)

---

## 🏗️ 資料庫架構概覽

### **資料庫基本資訊**
- **資料庫引擎：** SQLite 3.x
- **檔案位置：** `/prisma/dev.db`
- **連接URL：** `file:./prisma/dev.db`
- **日誌模式：** WAL (Write-Ahead Logging)
- **緩存大小：** 10MB

### **核心資料表結構**
```sql
-- 主要業務表
Employee          -- 員工基本資料 (約500-1000筆)
User              -- 使用者帳戶 (約100-500筆)
AttendanceRecord  -- 出勤記錄 (約10萬-50萬筆/年)
Schedule          -- 排班表 (約5000-2萬筆/月)
PayrollRecord     -- 薪資記錄 (約100-500筆/月)
LeaveRequest      -- 請假申請 (約200-1000筆/月)
OvertimeRequest   -- 加班申請 (約100-500筆/月)

-- 系統管理表
Announcement      -- 公告 (約50-200筆)
AllowedLocation   -- 允許打卡地點 (約5-20筆)
SystemSettings    -- 系統設定 (約20-50筆)
```

---

## 📅 日常維護任務

### **每日維護 (自動執行)**

#### 1. **資料庫清理** - 每日凌晨 2:00
```bash
# 手動執行日常清理
curl -X POST https://localhost:3001/api/system-maintenance \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: YOUR_TOKEN" \
  -d '{"action": "run-maintenance-task", "taskId": "database-cleanup"}'
```

**清理項目：**
- 刪除過期的系統日誌 (保留30天)
- 清理暫存資料表
- 更新統計資訊
- 重建查詢計劃

#### 2. **資料備份** - 每日凌晨 3:00
```bash
# 手動執行資料備份
curl -X POST https://localhost:3001/api/system-maintenance \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: YOUR_TOKEN" \
  -d '{"action": "backup-system"}'
```

### **每週維護 (週日執行)**

#### 1. **完整健康檢查**
```bash
# 執行完整系統健康檢查
curl https://localhost:3001/api/system-maintenance?action=health
```

#### 2. **索引重建與優化**
```bash
# 執行資料庫優化
node optimize-db.js
```

### **補休 IMPORT baseline 修復流程**

若歷史上重複匯入補休基準，資料庫可能同時存在多筆 `referenceType = 'IMPORT'` 交易，造成 frozen baseline 判讀混亂。修復工具會保留最新的 IMPORT baseline，刪除較舊 baseline，並依最新 baseline 重新 upsert `compLeaveBalance`。

#### 1. **先做 dry-run**
```bash
# 使用目前 DATABASE_URL 或 fallback 目標
npm run repair:comp-leave-imports

# 明確指定 production snapshot
npm run repair:comp-leave-imports -- --database=/absolute/path/to/snapshot.db

# 限縮單一員工
npm run repair:comp-leave-imports -- --database=/absolute/path/to/snapshot.db --employeeId=123

# 以 JSON 輸出 dry-run 結果，方便做比對或存檔
npm run repair:comp-leave-imports -- --database=/absolute/path/to/snapshot.db --json
```

#### 2. **確認輸出後再 apply**
```bash
# 單一員工 apply
npm run repair:comp-leave-imports -- --database=/absolute/path/to/snapshot.db --employeeId=123 --apply

# 全庫 apply 需要額外確認字串
npm run repair:comp-leave-imports -- --database=/absolute/path/to/snapshot.db --apply --confirm=REPAIR_ALL_IMPORT_BASELINES
```

#### 3. **資料庫目標規則**
- 若未提供 `DATABASE_URL` 與 `-- --database=...`，fallback 會指向 `file:./prisma/dev.db`。
- `-- --database=...` 可傳原始 SQLite 路徑或 `file:` URL，工具會以「命令列參數」標示來源。
- `--json` 只支援 dry-run，啟用後會輸出純 JSON，適合保存修復前檢查結果。
- 若對全庫做 `--apply`，必須同時帶 `--confirm=REPAIR_ALL_IMPORT_BASELINES`；若限定 `--employeeId=<id>` 則不需要。
- 若資料庫檔案不存在、是空檔，或缺少 `comp_leave_transactions` 資料表，CLI 會輸出可操作的中文錯誤說明。
- 工作區內的 `prisma/prod.db` 是 0-byte 占位檔，不應視為正式資料庫。

#### 4. **建議操作順序**
1. 先取得 production DB 或 production snapshot。
2. 只做 dry-run，確認哪些員工會被修復。
3. 如有需要，先以 `--employeeId=<id>` 對單一員工 apply 驗證。
4. 最後若要全庫 apply，必須顯式帶上 `--confirm=REPAIR_ALL_IMPORT_BASELINES`。

### **每月維護**

#### 1. **資料歸檔**
- 歸檔舊的出勤記錄 (超過1年)
- 歸檔舊的薪資記錄 (超過5年)
- 清理過期的臨時資料

#### 2. **性能統計更新**
- 重新計算資料庫統計
- 更新查詢計劃
- 分析慢查詢日誌

---

## ⚡ 性能優化

### **資料庫配置優化**

當前系統已自動應用以下優化設定：

```sql
-- WAL 模式 (提高並發性能)
PRAGMA journal_mode = WAL;

-- 緩存大小 10MB
PRAGMA cache_size = -10240;

-- 啟用外鍵約束
PRAGMA foreign_keys = ON;

-- 平衡模式同步
PRAGMA synchronous = NORMAL;

-- 記憶體臨時儲存
PRAGMA temp_store = MEMORY;

-- mmap 大小 64MB
PRAGMA mmap_size = 67108864;
```

### **索引優化**

#### 1. **查看現有索引**
```sql
-- 查看所有索引
SELECT name, tbl_name, sql FROM sqlite_master 
WHERE type = 'index' AND name NOT LIKE 'sqlite_%';
```

#### 2. **建立性能索引**
```sql
-- 出勤記錄複合索引 (提升查詢速度)
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date 
ON AttendanceRecord(employeeId, clockInTime);

-- 排班表索引
CREATE INDEX IF NOT EXISTS idx_schedule_employee_date 
ON Schedule(employeeId, date);

-- 薪資記錄索引
CREATE INDEX IF NOT EXISTS idx_payroll_period 
ON PayrollRecord(employeeId, payPeriodStart, payPeriodEnd);

-- 請假記錄索引
CREATE INDEX IF NOT EXISTS idx_leave_request_date 
ON LeaveRequest(employeeId, startDate, endDate);
```

#### 3. **自動執行優化腳本**
```bash
# 使用預建的優化腳本
sqlite3 prisma/dev.db < database-optimize.sql

# 或使用 Node.js 腳本
node optimize-db.js
```

### **查詢優化**

#### 1. **分析慢查詢**
```sql
-- 啟用查詢計劃分析
EXPLAIN QUERY PLAN 
SELECT * FROM AttendanceRecord 
WHERE employeeId = 'EMP001' 
AND DATE(clockInTime) = '2025-11-10';
```

#### 2. **優化常見查詢**
```sql
-- 員工月度出勤統計 (優化版)
SELECT 
    employeeId,
    COUNT(*) as attendance_days,
    AVG(JULIANDAY(clockOutTime) - JULIANDAY(clockInTime)) * 24 as avg_hours
FROM AttendanceRecord 
WHERE DATE(clockInTime) >= '2025-11-01' 
AND DATE(clockInTime) < '2025-12-01'
GROUP BY employeeId;
```

---

## 💾 備份與恢復

### **自動備份策略**

#### 1. **每日增量備份**
```bash
#!/bin/bash
# 每日備份腳本
DATE=$(date +%Y%m%d)
BACKUP_DIR="/backups/daily"

# 創建備份目錄
mkdir -p $BACKUP_DIR

# SQLite 備份
sqlite3 prisma/dev.db ".backup $BACKUP_DIR/attendance_$DATE.db"

# 壓縮備份
gzip $BACKUP_DIR/attendance_$DATE.db

echo "✅ 每日備份完成: attendance_$DATE.db.gz"
```

#### 2. **每週完整備份**
```bash
#!/bin/bash
# 每週完整備份 (包含附件和配置)
WEEK=$(date +%Y%W)
BACKUP_DIR="/backups/weekly"

mkdir -p $BACKUP_DIR

# 備份資料庫
cp prisma/dev.db $BACKUP_DIR/attendance_week_$WEEK.db

# 備份上傳檔案
tar -czf $BACKUP_DIR/uploads_week_$WEEK.tar.gz uploads/

# 備份配置檔案
cp .env $BACKUP_DIR/.env_week_$WEEK

echo "✅ 每週備份完成"
```

### **資料恢復**

#### 1. **從備份恢復資料庫**
```bash
# 停止應用服務
pm2 stop attendance-system

# 恢復資料庫
gunzip -c /backups/daily/attendance_20251110.db.gz > prisma/dev.db

# 重新啟動服務
pm2 start attendance-system

echo "✅ 資料庫恢復完成"
```

#### 2. **部分資料恢復**
```sql
-- 恢復特定表的資料 (從備份資料庫)
ATTACH '/backups/attendance_backup.db' AS backup;

-- 恢復員工資料
DELETE FROM Employee WHERE id IN (SELECT id FROM backup.Employee);
INSERT INTO Employee SELECT * FROM backup.Employee;

DETACH backup;
```

---

## 📊 監控與警報

### **系統監控儀表板**

訪問系統監控頁面：
```
https://localhost:3001/system-monitoring
```

### **資料庫健康指標**

#### 1. **即時健康檢查**
```bash
# API 健康檢查
curl https://localhost:3001/api/system-maintenance?action=health

# 預期回應
{
  "success": true,
  "data": {
    "overall": "healthy",
    "score": 85,
    "components": {
      "database": {
        "status": "healthy",
        "score": 88,
        "responseTime": 45,
        "details": {
          "userCount": 10,
          "employeeCount": 25,
          "walMode": "enabled",
          "cacheSize": "10MB"
        }
      }
    }
  }
}
```

#### 2. **關鍵性能指標 (KPIs)**
- **回應時間:** < 200ms (優秀), < 500ms (良好), > 1000ms (需優化)
- **連接數:** 監控並發連接數
- **資料庫大小:** 監控檔案大小增長
- **查詢性能:** 追蹤慢查詢
- **錯誤率:** < 1% (健康), < 5% (警告), > 5% (嚴重)

### **警報設定**

#### 1. **自動警報觸發條件**
- 資料庫回應時間 > 1秒
- 資料庫連接失敗
- 磁碟空間 < 10%
- 資料庫檔案損毀
- 備份失敗

#### 2. **通知方式**
```javascript
// 系統會自動發送通知
{
  type: 'database_alert',
  severity: 'critical',
  message: '資料庫回應時間超過閾值',
  details: {
    responseTime: 1250,
    threshold: 1000
  }
}
```

---

## 🔧 故障排除

### **常見問題與解決方案**

#### 1. **資料庫鎖定問題**
```bash
# 問題：database is locked
# 解決方案：
echo "BEGIN IMMEDIATE; ROLLBACK;" | sqlite3 prisma/dev.db

# 或重啟應用
pm2 restart attendance-system
```

#### 2. **資料庫損壞**
```bash
# 檢查資料庫完整性
sqlite3 prisma/dev.db "PRAGMA integrity_check;"

# 修復資料庫
sqlite3 prisma/dev.db "PRAGMA quick_check;"
sqlite3 prisma/dev.db "REINDEX;"
```

#### 3. **性能急劇下降**
```bash
# 1. 執行緊急優化
curl -X POST https://localhost:3001/api/system-maintenance \
  -H "Content-Type: application/json" \
  -d '{"action": "optimize-system"}'

# 2. 清理緩存
curl -X POST https://localhost:3001/api/cache-management \
  -H "Content-Type: application/json" \
  -d '{"action": "cleanup"}'

# 3. 重建索引
sqlite3 prisma/dev.db "REINDEX;"
```

#### 4. **磁碟空間不足**
```bash
# 檢查資料庫大小
du -h prisma/dev.db

# 清理 WAL 檔案
sqlite3 prisma/dev.db "PRAGMA wal_checkpoint(TRUNCATE);"

# 壓縮資料庫
sqlite3 prisma/dev.db "VACUUM;"
```

### **緊急恢復程序**

#### 1. **資料庫無法啟動**
```bash
# 1. 檢查檔案權限
ls -la prisma/dev.db*

# 2. 檢查磁碟空間
df -h

# 3. 從備份恢復
cp /backups/latest/attendance.db prisma/dev.db

# 4. 重建資料庫 (最後手段)
npx prisma db push --force-reset
npx prisma db seed
```

#### 2. **資料遺失恢復**
```bash
# 1. 立即停止所有寫入操作
pm2 stop attendance-system

# 2. 備份當前狀態
cp prisma/dev.db prisma/dev.db.emergency

# 3. 從最近備份恢復
cp /backups/daily/latest.db prisma/dev.db

# 4. 檢查資料完整性
sqlite3 prisma/dev.db "PRAGMA integrity_check;"
```

---

## 🤖 自動化維護

### **系統內建維護任務**

系統已配置以下自動維護任務：

#### 1. **資料庫清理** (每日 02:00)
- 清理過期日誌記錄
- 刪除臨時資料
- 更新統計資訊

#### 2. **緩存優化** (每 6 小時)
- 清理過期緩存
- 優化記憶體使用
- 重建熱點資料

#### 3. **安全掃描** (每週日 00:00)
- 檢查異常登入
- 驗證資料完整性
- 更新安全設定

#### 4. **性能報告** (每週一 08:00)
- 生成性能統計
- 分析查詢模式
- 提供優化建議

#### 5. **資料備份** (每日 03:00)
- 自動資料備份
- 驗證備份完整性
- 清理過期備份

### **手動觸發維護任務**

```bash
# 執行特定維護任務
curl -X POST https://localhost:3001/api/system-maintenance \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: YOUR_TOKEN" \
  -d '{
    "action": "run-maintenance-task",
    "taskId": "database-cleanup"
  }'

# 可用任務 ID：
# - database-cleanup    (資料庫清理)
# - cache-optimization  (緩存優化)
# - security-scan      (安全掃描)
# - log-archival       (日誌歸檔)
# - performance-report (性能報告)
# - data-backup        (資料備份)
```

### **維護排程自訂**

```javascript
// 在 system-maintenance.ts 中自訂維護排程
const customTask = {
  name: '自訂資料清理',
  type: 'routine',
  category: 'database',
  description: '清理超過90天的出勤記錄',
  schedule: '0 1 1 * *', // 每月1號凌晨1點
  autoRun: true,
  priority: 'normal'
};
```

---

## 📈 性能監控與調優

### **關鍵性能指標追蹤**

#### 1. **查詢性能統計**
```sql
-- 查看最耗時的查詢類型
SELECT 
  sql,
  COUNT(*) as execution_count,
  AVG(execution_time) as avg_time
FROM query_log 
WHERE created_at >= datetime('now', '-7 days')
GROUP BY sql 
ORDER BY avg_time DESC;
```

#### 2. **資源使用監控**
```bash
# 監控資料庫檔案大小
watch -n 60 'du -h prisma/dev.db*'

# 監控系統資源
htop -p $(pgrep -f "node.*https-server")
```

### **優化建議實施**

系統會根據監控資料自動提供優化建議：

```json
{
  "recommendations": [
    {
      "priority": "high",
      "category": "database",
      "title": "建立複合索引",
      "description": "出勤查詢可通過員工ID和日期複合索引提升50%性能",
      "expectedImprovement": "減少50%查詢時間"
    },
    {
      "priority": "medium", 
      "category": "caching",
      "title": "增加資料庫緩存",
      "description": "常用員工資料可增加緩存層",
      "expectedImprovement": "減少30%資料庫負載"
    }
  ]
}
```

---

## 🎯 最佳實務建議

### **日常操作**

1. **定期檢查系統健康**
   - 每週查看監控儀表板
   - 關注警報通知
   - 執行健康檢查

2. **監控資料增長**
   - 追蹤資料庫大小
   - 規劃容量需求
   - 及時歸檔舊資料

3. **備份驗證**
   - 定期測試備份恢復
   - 驗證備份完整性
   - 更新備份策略

### **安全考量**

1. **資料庫安全**
   - 定期更新密碼
   - 限制資料庫訪問
   - 啟用審計日誌

2. **備份安全**
   - 加密敏感備份
   - 安全存儲備份
   - 控制訪問權限

---

## 📞 支援與聯繫

### **故障回報**
如遇資料庫相關問題，請提供：
- 錯誤訊息截圖
- 系統健康檢查結果
- 近期操作記錄
- 資料庫檔案大小

### **效能調優請求**
- 提供具體性能指標
- 說明業務需求
- 提供查詢模式分析

---

**📊 資料庫維護指南完成！**  
**定期維護確保系統穩定運行和最佳性能** 🚀
