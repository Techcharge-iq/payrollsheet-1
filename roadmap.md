# Fix roadmap
- [x] Sweep multi-site payroll entry, imports, approval, deductions, allocations, history/export, cache updates and database routines; focused app corrections completed, 55 tests passed and latest build OK. External schema changes and authenticated save remain blocked below.
- [x] Diagnose repeated employee-month save error and correct misleading “already paid” warning; surface the external database repair required without changing paid records. Targeted error and site-locking tests passed.
- [ ] Verify the employee/month constraint in the external payroll database and apply a batch-scoped replacement if confirmed (blocked: connected read/migration tools target the unused managed database; external constraint metadata and schema access required).
- [x] Correct Annexure A site selection, attendance source, and export error feedback.
- [x] Run focused regression checks (11 passed), clear pre-existing duplicated code causing compilation errors, and confirm build OK. Authenticated report/export checks remain unavailable for the external database; mocked browser navigation also did not reach the report.

## Attendance completeness sweep

- [x] Check attendance screens, payroll generation, report/download paths, background synchronization and SQL aggregation for row-limit truncation.
- [x] Page remaining unbounded attendance and roster reads without changing settled records or permissions.
- [x] Run targeted regression tests: 40 unit tests and five mocked browser checks passed; latest build OK. Real-account report export, review-service execution and deployed external SQL definitions remain unverified.

### Code-reviewed coverage
- Annexure A and its legacy re-export: employee and monthly timesheet reads page to completion, exact site matching preserved; tested downloaded PDF with 1,028 attendance rows and 1,001 employees.
- Daily Timesheets and previous-day copy: attendance comes from the already-paged shared cache; uncached deployment and foreman lookups now page. Busy-month assigned worker checked in the popup.
- Monthly Entry: monthly attendance comes from the complete cache; deployment and foreman lookups now page. Latest previous attendance intentionally reads one ordered record. Mid-month transfers and save/reopen tested with simulated data.
- Monthly Payroll preview/generation: attendance and batch history use the already-paged cache; salary-history safeguard now reads all pages, retaining the existing unavailable-history fallback. Preview checked at 224 hours and 672 salary.
- Workforce assignments and rate history: uncached list reads now page; no assignment/rate writes changed.
- Site Map: assignment, employee trade and site allocation list reads now page; existing count logic and example fallback unchanged.
- Attendance Report staff/site views, Print Report and regular PDF: use complete cached month rows, no additional API-limited read. Existing matrix browser check passed.
- Overview counts, Employees, Employee History/slips, payroll PDF/share, WPS and Cost Allocation/View List/PDF/CSV/share: consume complete shared-cache or supplied arrays; no additional attendance fetch found in these consumers.
- Background cache initialization and realtime updates: initialization already pages every cache table by ID before replacing the snapshot; realtime applies individual events. Realtime regression passed.
- Daily/project attendance review server functions (no current UI callers): attendance, deployment and employee queries now page; existing access checks and review-size guard unchanged. Source/compilation reviewed, service invocation not verified.
- SQL `refresh_payroll_site_allocations` definitions: aggregate all employee-period attendance with SUM/GROUP BY, without API paging or LIMIT. Repository SQL checked; deployed external definitions not verified or altered.
- Backup script: uses PostgreSQL dump, not the row-limited data API; source checked, backup not executed.

No settled records, permissions, settings or example data were changed.

## Multi-site duplicate payroll sweep

Rule: employees may have separate payroll at each worked site in a month, without duplicate site entries or repeated personal advance recovery; settled records stay unchanged.

Code-reviewed inventory (not live-account verification):
- Monthly Payroll search, manual entry, timesheet preview/generation, Excel import and approval use the shared site-aware lock. Different sites are allowed, same-site/all-sites overlap stays blocked.
- Manual/import validation, generation and approval now subtract other current-month batches' advance recoveries from available advances. Draft editing excludes its own recovery. Generation retains last-active-site assignment and net-earnings cap.
- Food defaults now sum every site line from the latest previous employee payroll month; zero remains valid. Previously picking the first site's line incorrectly reduced the next month's food amount.
- Save hook still inserts new lines with new IDs and updates existing lines by ID, never replaces another site's payroll. Save server function now checks fresh, fully paged month/site batches and lines before writing; also blocks moving existing lines and duplicate submitted lines. Concurrency still needs database enforcement.
- Cost Allocation, View List and their PDF/CSV/share consume the same allocation rows. Editable draft allocations now derive from the selected batch's site/project instead of distributing that site's pay across every transfer site. Finalized allocation rows are retained verbatim.
- Dashboard, Employee History, Advances and salary slips aggregate all site lines; history and slip exports retain separate site rows. Payroll's employee count and History's month count now count distinct employees/months rather than site-line counts. Batch PDF/share and WPS export read the explicitly selected batch's lines.
- Payroll cache initialization and realtime use row IDs, so separate site lines survive. Realtime and save/delete now invalidate month-line and advance-balance queries as well as batches/allocations.
- Normal and restricted batch deletion use batch_id, not employee/month, so they target one batch. Existing role checks and lifecycle permissions unchanged.
- Admin Diagnostics checks columns and storage, not uniqueness metadata; it cannot certify this constraint repair.
- Repository SQL: payroll_lines_sync_month uses batch_id correctly; payroll_advance_balances_before sums all employee lines correctly; lifecycle and audit triggers use batch/line IDs. The original employee/month unique constraint is incompatible. Existing refresh_payroll_site_allocations scans all transfer sites, incompatible with new site-only lines. Prepared an idempotent uniqueness repair and a future-draft-only allocation-function repair; neither was applied to any database.

Remaining verification/implementation blockers:
- Available migration tools target the unused managed database, not the external payroll database. No external PostgreSQL schema connection or matching connector is available. The external API is reachable but does not expose constraint definitions. Both external SQL repairs remain unapplied, and race-safe same-site enforcement cannot be certified.
- Preview opened to sign-in; external-app authenticated save, approval, PDF export and finalization/ledger updates were not exercised. No payroll or attendance records were posted or modified.