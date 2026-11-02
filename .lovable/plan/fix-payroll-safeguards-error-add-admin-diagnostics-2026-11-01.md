# Fix "payroll safeguards" error + add Admin Diagnostics

## What I found
- The error comes from the salary-rate check that runs before Pay Payroll / Generate Batch from Timesheets. If that check fails, both buttons stop.
- I checked your payroll database directly: the salary history table now has both date columns (`effective_on` and `effective_from`), and it has no rows yet. The preview code reads `effective_from`. The published app still runs an older version that expects `effective_on`, which explains the error in your screenshot. Republishing should clear it.
- The private `timesheet-uploads` storage folder still doesn't exist, so uploading timesheet photos will fail.

## Changes
1. **Fault-tolerant salary-rate check**
   - Read whichever date column exists (`effective_from`, falling back to `effective_on`) and treat both the same way.
   - If salary history can't be loaded at all, show a clear warning and fall back to each employee's current hourly rate, so payroll is never blocked. Advance and duplicate-payment checks stay strict as they are today.
   - Keep the existing rule: rows without a date are ignored.
2. **Create the missing `timesheet-uploads` folder** in your payroll database as private storage (no public access), so the existing per-user upload rules work.
3. **Admin Diagnostics screen** (only admins see it, as a new item in the side menu):
   - Required payroll columns: employees, payroll_batches, payroll_lines, employee_salary_history (with its date column), advance_transactions, employee_site_assignments. Each one shows OK or Missing.
   - Storage: `timesheet-uploads` exists and is private.
   - Each failed check shows what to do next and points to the matching repair SQL file. Includes a "Re-run checks" button.
4. Tests: salary history uses either date column; undated rows are still ignored; payroll isn't blocked when salary history fails to load.
5. Republish so the live app gets the fix.

## Technical details
- Diagnostics run in a `createServerFn` protected by `requireSupabaseAuth`. It checks that the caller's role in the external `profiles`/roles table is admin, then uses `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY` on the server only. It probes each column with `select=<col>&limit=0` and checks the bucket through the Storage API. The secret is never sent to the browser.
- I'll create the bucket with a one-time call to the external Storage API (`public: false`). The storage policies in `fix-external-attendance-infrastructure.sql` still need to be applied. Diagnostics will show whether they're in place.
- The salary query change lives in `PayrollTab.tsx` plus `src/lib/salary-history.ts`, which gets a normalizer for both column names.
