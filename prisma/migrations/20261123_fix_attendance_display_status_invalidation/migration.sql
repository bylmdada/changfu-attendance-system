-- 修正考勤顯示狀態（attendance_records.display_status）的失效機制。
--
-- 20260712 的班表觸發器用 datetime("work_date", '+8 hours') 比對班表日期，但 Prisma 把 DateTime 存成整數毫秒，
-- datetime() 會把整數當成儒略日而得到 NULL，條件永遠不成立：改班後舊狀態不會被清掉。
-- 考勤記錄的狀態篩選又會先用已存的狀態縮小範圍，所以應該命中的紀錄（例如改班後變成「遲到」）會被漏掉。
-- 另外上下班打卡、補打卡、修改打卡也沒有任何地方清除狀態。
--
-- 這個 migration：
--   1) 班表新增／修改／刪除時，以「台北工作日」的起迄毫秒範圍清除該員工當天紀錄的狀態
--      （範圍比較可以走 (employee_id, work_date) 索引）；
--   2) 打卡紀錄的上下班時間或工作日被修改時，清除該筆紀錄的狀態（任何寫入路徑都適用）；
--   3) 一次性清掉既有的狀態：它們可能已經過期。狀態是衍生資料，下次查詢時會重新計算並寫回。

DROP TRIGGER IF EXISTS "schedules_attendance_display_status_ai";
DROP TRIGGER IF EXISTS "schedules_attendance_display_status_au";
DROP TRIGGER IF EXISTS "schedules_attendance_display_status_ad";
DROP TRIGGER IF EXISTS "attendance_records_display_status_invalidate";

-- schedules.work_date 是 'YYYY-MM-DD'（台北日期）；該日 00:00（台北）= 前一天 16:00 UTC，
-- 即 strftime('%s', 日期, '-8 hours') 秒；attendance_records.work_date 為整數毫秒。
CREATE TRIGGER "schedules_attendance_display_status_ai"
AFTER INSERT ON "schedules"
BEGIN
  UPDATE "attendance_records"
  SET "display_status" = NULL
  WHERE "employee_id" = NEW."employee_id"
    AND "display_status" IS NOT NULL
    AND "work_date" >= CAST(strftime('%s', NEW."work_date", '-8 hours') AS INTEGER) * 1000
    AND "work_date" <  CAST(strftime('%s', NEW."work_date", '-8 hours') AS INTEGER) * 1000 + 86400000;
END;

CREATE TRIGGER "schedules_attendance_display_status_au"
AFTER UPDATE ON "schedules"
BEGIN
  UPDATE "attendance_records"
  SET "display_status" = NULL
  WHERE "employee_id" = OLD."employee_id"
    AND "display_status" IS NOT NULL
    AND "work_date" >= CAST(strftime('%s', OLD."work_date", '-8 hours') AS INTEGER) * 1000
    AND "work_date" <  CAST(strftime('%s', OLD."work_date", '-8 hours') AS INTEGER) * 1000 + 86400000;

  UPDATE "attendance_records"
  SET "display_status" = NULL
  WHERE "employee_id" = NEW."employee_id"
    AND "display_status" IS NOT NULL
    AND "work_date" >= CAST(strftime('%s', NEW."work_date", '-8 hours') AS INTEGER) * 1000
    AND "work_date" <  CAST(strftime('%s', NEW."work_date", '-8 hours') AS INTEGER) * 1000 + 86400000;
END;

CREATE TRIGGER "schedules_attendance_display_status_ad"
AFTER DELETE ON "schedules"
BEGIN
  UPDATE "attendance_records"
  SET "display_status" = NULL
  WHERE "employee_id" = OLD."employee_id"
    AND "display_status" IS NOT NULL
    AND "work_date" >= CAST(strftime('%s', OLD."work_date", '-8 hours') AS INTEGER) * 1000
    AND "work_date" <  CAST(strftime('%s', OLD."work_date", '-8 hours') AS INTEGER) * 1000 + 86400000;
END;

-- 只在上下班時間或工作日出現在 UPDATE 的 SET 清單時觸發；應用程式回填 display_status 的更新不會觸發。
CREATE TRIGGER "attendance_records_display_status_invalidate"
AFTER UPDATE OF "clock_in_time", "clock_out_time", "work_date" ON "attendance_records"
WHEN NEW."display_status" IS NOT NULL
BEGIN
  UPDATE "attendance_records" SET "display_status" = NULL WHERE "id" = NEW."id";
END;

UPDATE "attendance_records" SET "display_status" = NULL WHERE "display_status" IS NOT NULL;
