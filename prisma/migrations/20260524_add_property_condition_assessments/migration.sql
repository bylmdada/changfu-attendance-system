ALTER TABLE "maintenance_records" ADD COLUMN "condition_assessment_status" TEXT;
ALTER TABLE "maintenance_records" ADD COLUMN "normal_condition_items" TEXT;
ALTER TABLE "maintenance_records" ADD COLUMN "abnormal_condition_items" TEXT;
ALTER TABLE "maintenance_records" ADD COLUMN "abnormal_description" TEXT;

CREATE TABLE "maintenance_record_attachments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "maintenance_record_id" INTEGER NOT NULL,
    "original_name" TEXT NOT NULL,
    "stored_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "uploaded_by_user_id" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "maintenance_record_attachments_maintenance_record_id_fkey" FOREIGN KEY ("maintenance_record_id") REFERENCES "maintenance_records" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "maintenance_record_attachments_maintenance_record_id_idx" ON "maintenance_record_attachments"("maintenance_record_id");
