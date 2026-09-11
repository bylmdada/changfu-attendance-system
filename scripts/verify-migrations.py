"""Replay the full migration chain against an isolated SQLite database."""
import pathlib
import os
import sqlite3
import subprocess
import tempfile

def run(*args, **kwargs):
    try:
        return subprocess.run(*args, **kwargs)
    except subprocess.CalledProcessError as error:
        print(error.stdout.decode() if isinstance(error.stdout, bytes) else error.stdout)
        print(error.stderr.decode() if isinstance(error.stderr, bytes) else error.stderr)
        raise

ROOT = pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="changfu-migrations-") as temporary:
    connection = sqlite3.connect(pathlib.Path(temporary) / "test.db")
    migrations = sorted((ROOT / "prisma/migrations").glob("*/migration.sql"))
    for migration in migrations:
        connection.executescript(migration.read_text())
    assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    assert not connection.execute("PRAGMA foreign_key_check").fetchall()
    columns = {row[1] for row in connection.execute("PRAGMA table_info(leave_requests)")}
    assert "annual_leave_accounting" in columns
    assert connection.execute("SELECT count(*) FROM employees").fetchone() == (0,)
    connection.close()
    print(f"PASS: {len(migrations)} migrations replayed; integrity and foreign keys valid")
    database = pathlib.Path(temporary) / "prisma.db"
    sqlite3.connect(database).close()
    env = {**os.environ, "DATABASE_URL": f"file:{database}"}
    cli = ["node", str(ROOT / "node_modules/prisma/build/index.js")]
    for _ in range(2):
        run(cli + ["migrate", "deploy"], cwd=ROOT, env=env, check=True, capture_output=True)
    run(cli + ["migrate", "diff", "--from-url", env["DATABASE_URL"],
                          "--to-schema-datamodel", str(ROOT / "prisma/schema.prisma"), "--exit-code"],
                   cwd=ROOT, env=env, check=True, capture_output=True)
    with sqlite3.connect(database) as connection:
        connection.execute("INSERT INTO employees(employee_id,name,birthday,hire_date,base_salary,hourly_rate,updated_at) VALUES('TEST','preserved','2000-01-01','2026-01-01',0,0,CURRENT_TIMESTAMP)")
        connection.execute("DELETE FROM _prisma_migrations WHERE migration_name='20260101_initial_schema'")
    run(["node", str(ROOT / "scripts/ensure-initial-baseline.cjs"), str(database)],
                   cwd=ROOT, env=env, check=True, capture_output=True)
    run(cli + ["migrate", "deploy"], cwd=ROOT, env=env, check=True, capture_output=True)
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT name FROM employees WHERE employee_id='TEST'").fetchone() == ("preserved",)
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    print("PASS: Prisma deploy twice, exact schema match, existing-data baseline preserves records")
