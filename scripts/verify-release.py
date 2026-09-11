"""Exercise actual release/backup scripts using temporary DBs and inert PM2/HTTP stubs."""
import os
import pathlib
import shutil
import sqlite3
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]

with tempfile.TemporaryDirectory(prefix="changfu-release-") as temporary:
    base = pathlib.Path(temporary)
    binary = base / "bin"
    binary.mkdir()
    stubs = {
        "pm2": '#!/bin/sh\necho "$*" >> "$TEST_PM2_LOG"\nexit 0\n',
        "curl": '#!/bin/sh\n[ "$TEST_CASE" = health ] && exit 22\ncase "$*" in *attendance/records*) printf 401;; esac\nexit 0\n',
        "sleep": '#!/bin/sh\nexit 0\n',
    }
    for name, content in stubs.items():
        file = binary / name
        file.write_text(content)
        file.chmod(0o755)
    environment = {**os.environ, "PATH": f"{binary}:{os.environ['PATH']}"}
    environment.pop("DATABASE_URL", None)
    for case in ("success", "migration", "health", "backup", "conflict"):
        directory = base / case
        live, stage = directory / "live", directory / "stage"
        for folder in (live, stage):
            (folder / "scripts").mkdir(parents=True)
            (folder / "release.txt").write_text("old" if folder == live else "new")
        database = live / "prod.db"
        with sqlite3.connect(database) as db:
            db.executescript("CREATE TABLE marker(value TEXT); INSERT INTO marker VALUES('original');"
                             "CREATE TABLE _prisma_migrations(migration_name TEXT,finished_at TEXT,rolled_back_at TEXT);"
                             "INSERT INTO _prisma_migrations VALUES('20260101_initial_schema','done',NULL);")
        for folder in (live, stage):
            (folder / ".env.production").write_text(f'DATABASE_URL="file:{database}"\n')
        if case == "conflict":
            (stage / ".env.production").write_text(f'DATABASE_URL="file:{directory}/wrong.db"\n')
        if case == "backup":
            database.write_text("corrupt DB")
        uploads = live / "public/uploads/dependent-attachments"
        uploads.mkdir(parents=True)
        (uploads / "proof.pdf").write_text("sensitive")
        for script in ("production-database.cjs", "ensure-initial-baseline.cjs", "migrate-dependent-attachments.cjs"):
            shutil.copy2(ROOT / "scripts" / script, stage / "scripts" / script)
        prisma = stage / "node_modules/prisma/build"
        prisma.mkdir(parents=True)
        (prisma / "index.js").write_text("require('node:child_process').execFileSync('sqlite3', [process.env.DATABASE_URL.slice(5), \"UPDATE marker SET value='migrated';\"]); if(process.env.TEST_CASE==='migration') process.exit(1);")
        log = directory / "pm2.log"
        env = {**environment, "DEPLOY_PATH": str(live), "STAGE_PATH": str(stage),
               "REMOTE_ENV_FILE": ".env.production", "TEST_CASE": case, "TEST_PM2_LOG": str(log)}
        result = subprocess.run(["bash", str(ROOT / "scripts/activate-release.sh")], env=env, capture_output=True, text=True)
        assert (result.returncode == 0) == (case == "success"), (case, result.stdout, result.stderr)
        assert (live / "release.txt").read_text() == ("new" if case == "success" else "old")
        assert not pathlib.Path(f"{live}.deploy-lock").exists()
        if case != "backup":
            with sqlite3.connect(database) as db:
                assert db.execute("SELECT value FROM marker").fetchone()[0] == ("migrated" if case == "success" else "original")
                assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        if case == "success":
            assert (live / "uploads/dependent-attachments/proof.pdf").read_text() == "sensitive"
            assert not (uploads / "proof.pdf").exists()
        else:
            assert (uploads / "proof.pdf").read_text() == "sensitive"
        if case == "conflict":
            assert not log.exists(), "conflicting DB must fail before stopping PM2"
        elif case != "success":
            assert "restart attendance --update-env" in log.read_text()
        print(f"PASS: isolated release {case}")

    lock = base / "backup.lock"
    lock.mkdir()
    testdb = base / "backup.db"
    sqlite3.connect(testdb).close()
    env = {**environment, "DB_PATH": str(testdb), "BACKUP_DIR": str(base / "backups"),
           "LOG_FILE": str(base / "backup.log"), "LOCK_DIR": str(lock), "RCLONE_ENABLED": "0"}
    for _ in range(2):
        result = subprocess.run(["bash", str(ROOT / "scripts/backup-database.sh")], env=env, capture_output=True)
        assert result.returncode != 0 and lock.exists(), "a non-owner must preserve the lock"
    lock.rmdir()
    result = subprocess.run(["bash", str(ROOT / "scripts/backup-database.sh")], env=env, capture_output=True)
    assert result.returncode == 0 and not lock.exists(), result.stderr
    print("PASS: backup lock ownership and isolated SQLite backup")
