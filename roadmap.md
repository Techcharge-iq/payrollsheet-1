# Fix roadmap
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