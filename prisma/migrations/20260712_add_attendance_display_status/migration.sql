ALTER TABLE "attendance_records" ADD COLUMN "display_status" TEXT;

CREATE INDEX "attendance_records_display_status_work_date_idx"
  ON "attendance_records"("display_status", "work_date");

CREATE TRIGGER IF NOT EXISTS "schedules_attendance_display_status_ai"
AFTER INSERT ON "schedules"
BEGIN
  UPDATE "attendance_records"
  SET "display_status" = NULL
  WHERE "employee_id" = NEW."employee_id"
    AND strftime('%Y-%m-%d', datetime("work_date", '+8 hours')) = NEW."work_date";
END;

CREATE TRIGGER IF NOT EXISTS "schedules_attendance_display_status_au"
AFTER UPDATE ON "schedules"
BEGIN
  UPDATE "attendance_records"
  SET "display_status" = NULL
  WHERE "employee_id" = OLD."employee_id"
    AND strftime('%Y-%m-%d', datetime("work_date", '+8 hours')) = OLD."work_date";

  UPDATE "attendance_records"
  SET "display_status" = NULL
  WHERE "employee_id" = NEW."employee_id"
    AND strftime('%Y-%m-%d', datetime("work_date", '+8 hours')) = NEW."work_date";
END;

CREATE TRIGGER IF NOT EXISTS "schedules_attendance_display_status_ad"
AFTER DELETE ON "schedules"
BEGIN
  UPDATE "attendance_records"
  SET "display_status" = NULL
  WHERE "employee_id" = OLD."employee_id"
    AND strftime('%Y-%m-%d', datetime("work_date", '+8 hours')) = OLD."work_date";
END;
