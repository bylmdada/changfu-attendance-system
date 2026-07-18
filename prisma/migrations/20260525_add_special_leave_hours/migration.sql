ALTER TABLE "shift_definitions" ADD COLUMN "special_leave_hours" REAL NOT NULL DEFAULT 0;
ALTER TABLE "schedules" ADD COLUMN "special_leave_hours" REAL NOT NULL DEFAULT 0;
