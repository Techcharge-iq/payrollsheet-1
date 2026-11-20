# Project rules

- Payroll uses the existing external database; do not apply payroll infrastructure repairs to the unused managed database because they will not affect the app.
- Salary rate selection lives in `src/lib/salary-history.ts` and ignores undated legacy records so schema repair cannot invent historical salary dates.
- New salary-history writes use `effective_from`; Workforce normalizes legacy dates through the payroll helper so saving, display, and rate selection agree.
- Timesheet attachments use a private bucket with user-prefixed paths and signed URLs, preserving document privacy without anonymous read access.
- Monthly attendance prefills new days from the date's deployment as a whole before attendance-history fallback; persisted days remain authoritative to preserve recorded allocations.
- Payroll generation reads all cached batches for prior deduction lookup, while display and duplicate checks remain scoped to the selected month; explicit zero food deductions remain valid.
- Annexure A requires an explicitly selected site and reads canonical timesheets by project identity, with exact normalized site-name fallback for legacy records; partial names must never combine separate projects. Page timesheet and employee reads in stable ID order until exhausted, failing on any page error, so API row limits cannot silently truncate reports.
- Use `fetchAllPages` for uncached attendance, deployment, roster and salary-history lists, adding a unique ordering key to existing sort order; complete reads prevent silent row-limit losses without changing access policies or settled data.
- Payroll save errors for the legacy employee-month constraint must identify the external schema repair, never suggest overwriting prior payroll; site-lock warnings describe inclusion, not payment status.