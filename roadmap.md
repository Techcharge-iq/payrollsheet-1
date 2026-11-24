# Fix roadmap
- [ ] Add Approved-batch payment top-ups/corrections with audit history, fully-paid protection, and cross-site outstanding/missing-payroll warnings; verify tests and identify external schema deployment blocker.
- [ ] Sweep partial-payment lifecycle across entry/import, review/approval/payment, refresh, alternate metadata/foreman edits, deletion, reports, cache/background jobs and external lifecycle SQL; preserve settled records and distinguish read-only review from live verification.
- [x] Correct the remaining partial-payment status lock: allow forward Review/Approved transitions without rewriting paid lines, keep identity/deletion/reopening protected, and require per-employee full settlement before Paid. Fresh status/payment checks added; external lifecycle definitions reviewed but deployed triggers and live authenticated finalisation remain unverified (no external schema connection).
- [x] Partial-payment flow sweep: read payroll generation/entry/import/refresh, alternate foreman/metadata/status hooks, deletion screens/server, cost views/reports, history/slips/WPS, advance balances, cache/realtime and repository lifecycle/allocation SQL. Cost refresh now excludes paid employee lines rather than treating every Draft line as editable. Shared batch identity, status and deletion stay protected. Live external database functions/permissions and authenticated saves remain unverified; no settled records changed.
- [x] Allow editing and refreshing unpaid employees in partially paid payroll batches; save only unpaid rows, preserve paid deductions and shared batch identity, keep finalized/status/deletion protection. 112 unit tests and desktop/mobile isolated save/reopen/first-payment checks passed; build OK. Actual external authenticated save and database concurrency remain unverified; no live payment or payroll records were modified.
- [x] Align food generation/manual selection and server save/approval limits with calendar-day charges and dated site deployments; 81 unit tests passed, including absence/weekoff, transfers, Employee 144 and paid-history preservation. Build OK. Live payroll save remains unverified: external authenticated access is unavailable; isolated browser check stopped at secure-access gate.
- [x] Sweep remaining edit, approval, payment, deletion and cache paths for paid-record protection and duplicate deductions; fix future behavior and record external database blockers. 71 unit tests and isolated Delete-control browser checks passed.
- [x] Add confirmed deletion controls for unpaid Legacy and Approved batches in both payroll deletion screens; shared payment protection and atomic server call added. Browser fixture check passed; live deletion blocked by missing external SQL routine.
- [x] Add fresh server checks for site/month food limits, last-site advances, remaining balance, site-net cap and paid record protection; canonicalize saved month from batch. 67 tests passed, latest build OK.
- [ ] Verify actual October 2026 save/delete end-to-end and apply external uniqueness/allocation/unpaid-deletion repairs (blocked: no external schema execution connection; managed tools target a different database).
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

## October save and marked-batch deletion follow-up

- Actual external API reads confirmed 8 October 2026 batches and 201 lines. Marked T-57 is LEGACY with one line and zero paid; marked Multiple sites is APPROVED with one line and zero paid. One employee already has lines at different sites, but this does not prove the current unique constraint is repaired or that a new save succeeds.
- Read-before/read-after hashes of the four protected October lines matched. No live rows were saved, deleted, or changed.
- Both deletion screens use unpaid eligibility; normal deletion now calls the same authorized server function as restricted deletion. Server checks payments then calls an atomic transaction, with no unsafe separate child/parent-delete fallback.
- Prepared fix-unpaid-payroll-deletion.sql for the external database. It adds service-role-only transaction support after app role validation, rechecks payments under locks, and narrowly extends existing deployed lifecycle functions only for requested unpaid deletion. It does not automatically delete either marked batch, change roles or widen client grants.
- External API confirmed delete_unpaid_payroll_batch is absent. No SQL repair was executed: available managed migration/data tools are not connected to payroll's external database. SQL syntax/deployed lifecycle compatibility remains unverified.
- Browser fixture check: Legacy and Approved Delete visible, Paid Delete absent, cancellation unchanged, confirmation invokes only selected fixture ID. This was an isolated component check, not authenticated live deletion.
- Full unit suite: 67 passed; latest compilation OK. Live multi-site save, atomic deletion, concurrent deduction enforcement, and finalization ledger remain unverified. Existing real deductions were not automatically corrected.

## Follow-up flow sweep

Rule: multi-site payroll must not repeat deductions, and deleting/editing unpaid payroll must not alter any payment-bearing history.

Code checked in this conversation:
- Monthly Payroll search, preview/generation, imports and save: site lock and server deduction checks follow the rule for sequential requests; database concurrency remains blocked. Existing line IDs now cannot be reassigned to a different employee or moved to another batch.
- Monthly Payroll edits, approval and Mark paid: partial-payment batches previously remained editable until status became Paid. Now any existing payment or payment timestamp blocks edits/status actions. Approval/Mark paid recheck site food, advance location and outstanding caps in the UI before updating status.
- Save hook, alternate metadata update and foreman update: fresh payment reads now happen before any changes, including batch metadata previously written before the server line guard. Status hook also rechecks payment state. These are sequential application checks, not a substitute for atomic external triggers.
- Both Delete screens and authorized delete function: same eligibility, confirmation and payment guards; null/invalid payment values now fail closed consistently with prepared SQL. Transaction routine remains absent externally.
- Employee deletion server flow: cascading employee deletion could remove payment-bearing history. It now reads related payroll lines/batches and refuses deletion where paid history exists. The deployed employee-delete SQL still needs transactional payment enforcement to prevent concurrent payment/delete races; no live deletion was performed.
- Deletion cache cleanup: both paths now remove only selected batch's line and allocation cache rows, preventing stale Cost Allocation rows after successful deletion. Realtime uses IDs and invalidates payroll, monthly lines and advance balances.
- Dashboard, Employee History, Advances, salary slips, payroll PDF/share, WPS and Cost Allocation/View List/PDF/CSV/share were source-reviewed in this conversation: they consume saved lines/allocations without modifying paid rows; separate-site lines are retained and payroll deduction totals sum each line once. Report appearance and live exports not verified.
- SQL reviewed: month-sync uses batch identity; advance-balances aggregates line recoveries; original uniqueness and allocation routines need the prepared external repairs; batch/line/allocation lifecycle triggers conflict with unpaid Approved/Legacy deletion until the guarded deletion routine is installed. Admin diagnostics checks columns/storage only, not constraint correctness.

Remaining: external uniqueness, allocation and safe-deletion repairs were not executed; live authenticated October save/delete/approval, ledger finalization, schema compatibility, and concurrent protections remain unverified. Available migration tools still target the wrong database. No settled rows, permissions, settings or example data changed.