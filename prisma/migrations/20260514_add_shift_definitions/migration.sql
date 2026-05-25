CREATE TABLE "shift_definitions" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "start_time" TEXT NOT NULL,
  "end_time" TEXT NOT NULL,
  "break_time" INTEGER NOT NULL DEFAULT 0,
  "requires_time" BOOLEAN NOT NULL DEFAULT true,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "description" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "shift_definitions_code_key" ON "shift_definitions"("code");
CREATE INDEX "shift_definitions_is_active_sort_order_idx" ON "shift_definitions"("is_active", "sort_order");
