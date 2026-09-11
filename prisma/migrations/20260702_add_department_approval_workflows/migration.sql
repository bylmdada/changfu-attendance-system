PRAGMA foreign_keys=OFF;

CREATE TABLE "new_approval_workflows" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "workflow_type" TEXT NOT NULL,
  "department" TEXT NOT NULL DEFAULT '__ALL__',
  "workflow_name" TEXT NOT NULL,
  "approval_level" INTEGER NOT NULL DEFAULT 2,
  "require_manager" BOOLEAN NOT NULL DEFAULT true,
  "final_approver" TEXT NOT NULL DEFAULT 'ADMIN',
  "deadline_mode" TEXT NOT NULL DEFAULT 'FIXED',
  "deadline_hours" INTEGER,
  "enable_forward" BOOLEAN NOT NULL DEFAULT false,
  "enable_cc" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL
);

INSERT INTO "new_approval_workflows" (
  "id",
  "workflow_type",
  "department",
  "workflow_name",
  "approval_level",
  "require_manager",
  "final_approver",
  "deadline_mode",
  "deadline_hours",
  "enable_forward",
  "enable_cc",
  "isActive",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  "workflow_type",
  '__ALL__',
  "workflow_name",
  "approval_level",
  "require_manager",
  "final_approver",
  "deadline_mode",
  "deadline_hours",
  "enable_forward",
  "enable_cc",
  "isActive",
  "created_at",
  "updated_at"
FROM "approval_workflows";

DROP TABLE "approval_workflows";
ALTER TABLE "new_approval_workflows" RENAME TO "approval_workflows";

CREATE UNIQUE INDEX "approval_workflows_workflow_type_department_key"
ON "approval_workflows"("workflow_type", "department");

CREATE INDEX "approval_workflows_department_idx"
ON "approval_workflows"("department");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
