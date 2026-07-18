# Changfu Attendance System｜長福出勤管理系統

[![CI](https://github.com/bylmdada/changfu-attendance-system/actions/workflows/ci.yml/badge.svg)](https://github.com/bylmdada/changfu-attendance-system/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Next.js](https://img.shields.io/badge/Next.js-15-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Prisma](https://img.shields.io/badge/Prisma-6-2D3748)

A full-featured, self-hosted **HR attendance & payroll platform** built for small-to-mid organizations in Taiwan, with payroll rules aligned to the **Taiwan Labor Standards Act（勞動基準法）**. It runs in production for a community care organization and is actively maintained — the repository includes an extensive, continuously updated series of engineering audit and optimization documents under [`docs/`](docs/).

為台灣中小型組織打造的自架式出勤與薪資管理系統：GPS/WiFi 打卡、排班與班表確認、請假／加班／補休、依勞基法的加班費與薪資計算、審核流程、財產維護管理。正式環境營運中，並持續進行系統性稽核與重構（見 `docs/` 的 15 份工程文件）。

---

## Features

### Employee self-service（員工端）
- **Clock in/out** with GPS geofencing, WiFi verification, biometric quick-login (WebAuthn/Face ID), and health-declaration prompts
- Personal schedule with monthly **schedule confirmation** (versioned sign-off, re-confirmation on changes)
- Leave requests (17 statutory leave types), overtime requests with **compensatory-leave or pay** election, missed-clock and shift-change applications — each with cancellation/void flows
- Annual-leave & comp-leave balances with expiry reminders; payslip viewing and payroll dispute filing
- In-app **notification center** (bell + full inbox), Web Push (PWA), and email notifications

### Administration（管理端）
- Scheduling with shift definitions, weekly templates, batch assignment, **dry-run overwrite preview**, Excel export
- Approval workflows: configurable per-type/per-department levels, delegation, CC, batch approval with preview, overdue escalation
- Payroll engine: Labor-Standards-Act overtime brackets (4/3・5/3・8/3), income tax & labor/health insurance deductions, supplementary premiums, perfect-attendance bonus, pro-rated bonuses, resignation settlement
- **Attendance freeze**: monthly lock with recurring auto-freeze, scheduled freezes, audited unfreeze
- Disaster day-off (typhoon) management with schedule snapshot & restore
- **Property/asset maintenance** module: multi-site assets, Code128 barcode labels & scanning, maintenance task auto-generation, supervisor audit trail, monthly reports
- Reports (payroll / insurance / tax / bank transfer), dashboards with charts, Excel/CSV export
- Security: TOTP 2FA + WebAuthn, password policy with exceptions, login logs, IP blocking, rate limiting, CSRF, **audit logging** for sensitive operations

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router) · React 19 · TypeScript 5 |
| Data | Prisma 6 · SQLite (90+ models) |
| UI | Tailwind CSS · Chart.js |
| Auth & security | JWT sessions · WebAuthn · TOTP 2FA · CSRF · rate limiting |
| Notifications | In-app (DB-backed) · Web Push (VAPID/PWA) · SMTP email |
| Observability | Sentry · structured logger · health endpoint · cron run logs |
| Testing / CI | Jest (route & lib test suites) · GitHub Actions |
| Deployment | PM2 + Nginx on any VPS (deploy scripts included) · daily SQLite backup with off-site sync |

## Getting Started

```bash
git clone https://github.com/bylmdada/changfu-attendance-system.git
cd changfu-attendance-system
npm install

cp .env.example .env.local        # fill in your own secrets (JWT, SMTP, VAPID, CRON)
npx prisma migrate dev            # creates a fresh local SQLite database
npm run dev                       # http://localhost:3001
```

```bash
npm run lint                      # ESLint
npm test                          # Jest test suites
npm run build                     # production build
```

> The repository ships **no real data and no secrets** — all credentials come from your local `.env` (see [`.env.example`](.env.example)), and local databases are git-ignored.

Production deployment (VPS + PM2 + Nginx, GitHub Actions manual deploy, backup & cron setup) is documented in [`docs/DIGITALOCEAN_PM2_VPS_QUICKSTART.md`](docs/DIGITALOCEAN_PM2_VPS_QUICKSTART.md) and [`docs/BACKUP_SETUP_GUIDE.md`](docs/BACKUP_SETUP_GUIDE.md).

## Engineering Practice

This project is developed with an **audit-driven maintenance loop** that is fully documented in-repo — useful both as project history and as a worked example of AI-assisted large-codebase maintenance:

- **Optimization series**（第 1–7 份）: a system-wide review turned into a prioritized P0–P3 roadmap with implementation plans — see [`docs/SYSTEM_OPTIMIZATION_ROADMAP.md`](docs/SYSTEM_OPTIMIZATION_ROADMAP.md) and the `P0_`/`P1_`/`P2_`/`P3_` documents. Most P0/P1 items are implemented and marked with completion notes.
- **Audit series**（第 8–15 份）: deep line-level audits of the attendance/payroll calculation core, application modules, approval workflows, property maintenance, schedules & disaster day-off, attendance-record parameters, overtime settings, and attendance freeze — e.g. [`docs/ATTENDANCE_CALC_BUG_AUDIT.md`](docs/ATTENDANCE_CALC_BUG_AUDIT.md), [`docs/ATTENDANCE_FREEZE_AUDIT.md`](docs/ATTENDANCE_FREEZE_AUDIT.md). Each finding carries file/line evidence, a reproduction scenario, severity, and a fix direction; fixes are landed with regression tests and back-annotated into the documents.

Other practices: Taiwan-timezone-safe date utilities, freeze/permission guards on every mutating route, deliberate scope control (features are declined in writing when the cost outweighs the benefit — see `docs/P3_EVALUATION.md`).

## Project Structure

```
src/
  app/            # ~50 pages (employee self-service + admin consoles)
  app/api/        # 70+ API route groups (REST, App Router handlers)
  lib/            # domain logic: work-hours, payroll, freeze, notifications, timezone…
  components/     # shared UI (batch approval bar, notification bell, export dialogs…)
prisma/           # schema (90+ models) & migrations
docs/             # deployment guides + the 15-document engineering series
scripts/          # backup & operations scripts
```

## Security

- No production data, credentials, or keys are committed; local databases and `.env*` are git-ignored.
- Sensitive operations (settings changes, payroll generation, freezes, exports) are audit-logged.
- If you discover a security issue, please open a private report via GitHub Security Advisories rather than a public issue.

## Roadmap

See [`docs/SYSTEM_OPTIMIZATION_ROADMAP.md`](docs/SYSTEM_OPTIMIZATION_ROADMAP.md) for the living P0–P3 roadmap and the remaining audit fix queue.

## Contributing

Issues and pull requests are welcome. Please run `npm run lint && npm test` before submitting, and keep changes consistent with the audit documents' conventions (Taiwan-timezone date handling, freeze guards on mutating routes, single-source business rules).

## License

[MIT](LICENSE) © 2026 bylmdada
