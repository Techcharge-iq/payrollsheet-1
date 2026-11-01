# Project rules

- Payroll uses the existing external database; do not apply payroll infrastructure repairs to the unused managed database because they will not affect the app.
- Salary rate selection lives in `src/lib/salary-history.ts` and ignores undated legacy records so schema repair cannot invent historical salary dates.
- Timesheet attachments use a private bucket with user-prefixed paths and signed URLs, preserving document privacy without anonymous read access.