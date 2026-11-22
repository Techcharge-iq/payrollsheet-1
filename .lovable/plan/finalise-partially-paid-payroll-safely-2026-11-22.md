# Finalise partially paid payroll safely

## Confirmed issue
The recent fix already allows editing unpaid coworkers. However, the payroll page still hides Submit review, Approve and Mark paid whenever any employee has a payment, and the status-saving action rejects those batches. A partially paid Draft therefore cannot finish its approval process.

Changing this requires adjusting financial lifecycle safeguards, not just revealing buttons. Existing external database triggers also control approval and payment; their deployed versions remain unverified.

## Proposed changes
- Allow authorised administrators to move partially paid batches forward from Draft to Review to Approved while preserving paid employee records unchanged.
- Keep paid employee editing, shared batch identity changes, deletion, and reopening finalised batches blocked.
- Check unpaid employee deductions during approval without treating protected paid rows as attempted edits; validate stored totals without recalculating paid history.
- Permit Mark paid only when fresh saved payment amounts cover every employee's net salary; show remaining unpaid amounts otherwise. Do not make partial payments appear fully settled.
- Preserve permission checks and fail closed for invalid payment values.

## Technical implementation
- Separate forward status-transition eligibility from deletion and line-edit protection using a shared tested helper.
- Update `PayrollTab.tsx` action visibility and approval checks, and the status mutation in `payroll-data.ts` to use fresh batch and line data.
- Inspect the actual external payroll lifecycle triggers before altering enforcement. Do not apply payroll changes to the unused managed database. If external schema execution remains unavailable, report that blocker rather than claiming live finalisation works.
- Update the architecture rule for status protection to document the narrowly authorised forward-transition exception.

## Verification
- Add regression tests for partial-payment Draft → Review → Approved, unchanged paid lines, prohibited deletion/reopening, invalid payments, and rejection of Mark paid with outstanding salary.
- Exercise desktop/mobile review and approval flows using isolated test records, then test the real authenticated external path when available.
- Mark the monitoring finding fixed only after the confirmed finalisation blocker is corrected; explicitly distinguish application checks from external database verification.

## Scope
No changes to historical payroll amounts, employee records, advance balances, or paid allocations. No live batches are automatically moved or paid.