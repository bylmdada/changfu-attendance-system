-- 財產管理 / Property & Asset Maintenance Management

CREATE TABLE "property_sites" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "institution_title" TEXT NOT NULL,
  "evidence_title" TEXT NOT NULL DEFAULT '輔具維護歷程佐證表',
  "settings" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "property_sites_name_key" ON "property_sites"("name");
CREATE UNIQUE INDEX "property_sites_code_key" ON "property_sites"("code");

CREATE TABLE "user_site_assignments" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "user_id" INTEGER NOT NULL,
  "site_id" INTEGER NOT NULL,
  "maintenance_role" TEXT NOT NULL DEFAULT 'MAINTAINER',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_site_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_site_assignments_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "property_sites" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "user_site_assignments_user_id_site_id_key" ON "user_site_assignments"("user_id", "site_id");
CREATE INDEX "user_site_assignments_site_id_idx" ON "user_site_assignments"("site_id");
CREATE INDEX "user_site_assignments_user_id_idx" ON "user_site_assignments"("user_id");

CREATE TABLE "property_personnel" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "site_id" INTEGER NOT NULL,
  "email" TEXT,
  "name" TEXT NOT NULL,
  "job_title" TEXT,
  "is_supervisor" BOOLEAN NOT NULL DEFAULT false,
  "linked_employee_id" INTEGER,
  "aliases" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "property_personnel_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "property_sites" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "property_personnel_site_id_name_key" ON "property_personnel"("site_id", "name");
CREATE INDEX "property_personnel_site_id_idx" ON "property_personnel"("site_id");
CREATE INDEX "property_personnel_email_idx" ON "property_personnel"("email");

CREATE TABLE "property_assets" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "site_id" INTEGER NOT NULL,
  "asset_code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "photo_path" TEXT,
  "location" TEXT,
  "manager_name" TEXT,
  "maintenance_frequency" TEXT,
  "frequency_days" INTEGER,
  "acquired_date" DATETIME,
  "next_maintenance_date" DATETIME,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "property_assets_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "property_sites" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "property_assets_site_id_asset_code_key" ON "property_assets"("site_id", "asset_code");
CREATE INDEX "property_assets_site_id_idx" ON "property_assets"("site_id");
CREATE INDEX "property_assets_asset_code_idx" ON "property_assets"("asset_code");
CREATE INDEX "property_assets_next_maintenance_date_idx" ON "property_assets"("next_maintenance_date");

CREATE TABLE "maintenance_records" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "record_id" TEXT NOT NULL,
  "site_id" INTEGER NOT NULL,
  "asset_id" INTEGER NOT NULL,
  "asset_code" TEXT NOT NULL,
  "maintenance_cycle" TEXT,
  "due_date" DATETIME,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "raw_status" TEXT,
  "maintainer_raw" TEXT,
  "maintainer_personnel_id" INTEGER,
  "maintainer_employee_id" INTEGER,
  "completed_date" DATETIME,
  "inventory_result" TEXT,
  "asset_condition" TEXT,
  "maintenance_item" TEXT,
  "other_note" TEXT,
  "photo_path" TEXT,
  "signature_path" TEXT,
  "audit_status" TEXT,
  "reject_reason" TEXT,
  "supervisor_name" TEXT,
  "supervisor_audit_date" DATETIME,
  "supervisor_signature_path" TEXT,
  "note" TEXT,
  "notified" BOOLEAN NOT NULL DEFAULT false,
  "generated_by_cron" BOOLEAN NOT NULL DEFAULT false,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "maintenance_records_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "property_sites" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenance_records_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "property_assets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "maintenance_records_maintainer_personnel_id_fkey" FOREIGN KEY ("maintainer_personnel_id") REFERENCES "property_personnel" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "maintenance_records_record_id_key" ON "maintenance_records"("record_id");
CREATE INDEX "maintenance_records_site_id_status_idx" ON "maintenance_records"("site_id", "status");
CREATE INDEX "maintenance_records_status_due_date_idx" ON "maintenance_records"("status", "due_date");
CREATE INDEX "maintenance_records_asset_id_idx" ON "maintenance_records"("asset_id");
CREATE INDEX "maintenance_records_audit_status_idx" ON "maintenance_records"("audit_status");

CREATE TABLE "audit_approvals" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "record_id" TEXT NOT NULL,
  "asset_code" TEXT NOT NULL,
  "submitted_at" DATETIME,
  "audit_status" TEXT NOT NULL DEFAULT 'PENDING',
  "supervisor_name" TEXT,
  "supervisor_user_id" INTEGER,
  "supervisor_audit_date" DATETIME,
  "supervisor_signature_path" TEXT,
  "note" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "audit_approvals_record_id_idx" ON "audit_approvals"("record_id");
CREATE INDEX "audit_approvals_audit_status_idx" ON "audit_approvals"("audit_status");

CREATE TABLE "property_maintenance_reminder_logs" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "record_id" INTEGER NOT NULL,
  "reminder_type" TEXT NOT NULL,
  "sent_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dedupe_key" TEXT NOT NULL,
  "channel" TEXT NOT NULL
);
CREATE UNIQUE INDEX "property_maintenance_reminder_logs_dedupe_key_key" ON "property_maintenance_reminder_logs"("dedupe_key");
CREATE INDEX "property_maintenance_reminder_logs_record_id_idx" ON "property_maintenance_reminder_logs"("record_id");
CREATE INDEX "property_maintenance_reminder_logs_sent_date_idx" ON "property_maintenance_reminder_logs"("sent_date");

CREATE TABLE "asset_modification_requests" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "request_code" TEXT NOT NULL,
  "asset_id" INTEGER NOT NULL,
  "asset_code" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "original_value" TEXT,
  "proposed_value" TEXT,
  "reason" TEXT,
  "requester_user_id" INTEGER,
  "requester_name" TEXT,
  "requested_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "review_status" TEXT NOT NULL DEFAULT 'PENDING',
  "reviewer_user_id" INTEGER,
  "review_note" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "asset_modification_requests_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "property_assets" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "asset_modification_requests_request_code_key" ON "asset_modification_requests"("request_code");
CREATE INDEX "asset_modification_requests_asset_id_idx" ON "asset_modification_requests"("asset_id");
CREATE INDEX "asset_modification_requests_review_status_idx" ON "asset_modification_requests"("review_status");
