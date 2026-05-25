ALTER TABLE "shift_definitions" ADD COLUMN "work_hours" REAL NOT NULL DEFAULT 0;
ALTER TABLE "shift_definitions" ADD COLUMN "comp_leave_hours" REAL NOT NULL DEFAULT 0;
ALTER TABLE "shift_definitions" ADD COLUMN "overtime_hours" REAL NOT NULL DEFAULT 0;

ALTER TABLE "schedules" ADD COLUMN "work_hours" REAL NOT NULL DEFAULT 0;
ALTER TABLE "schedules" ADD COLUMN "comp_leave_hours" REAL NOT NULL DEFAULT 0;
ALTER TABLE "schedules" ADD COLUMN "overtime_hours" REAL NOT NULL DEFAULT 0;

UPDATE "shift_definitions"
SET "work_hours" = CASE
  WHEN "requires_time" = 1 AND "start_time" <> '' AND "end_time" <> '' THEN
    ROUND(MAX(0, (
      (
        (CAST(substr("end_time", 1, 2) AS INTEGER) * 60 + CAST(substr("end_time", 4, 2) AS INTEGER)) -
        (CAST(substr("start_time", 1, 2) AS INTEGER) * 60 + CAST(substr("start_time", 4, 2) AS INTEGER)) +
        CASE WHEN "end_time" < "start_time" THEN 1440 ELSE 0 END -
        "break_time"
      ) / 60.0
    )), 2)
  ELSE 0
END;

UPDATE "schedules"
SET "work_hours" = CASE
  WHEN "start_time" <> '' AND "end_time" <> '' THEN
    ROUND(MAX(0, (
      (
        (CAST(substr("end_time", 1, 2) AS INTEGER) * 60 + CAST(substr("end_time", 4, 2) AS INTEGER)) -
        (CAST(substr("start_time", 1, 2) AS INTEGER) * 60 + CAST(substr("start_time", 4, 2) AS INTEGER)) +
        CASE WHEN "end_time" < "start_time" THEN 1440 ELSE 0 END -
        "break_time"
      ) / 60.0
    )), 2)
  ELSE 0
END;
