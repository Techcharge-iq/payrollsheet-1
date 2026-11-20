-- Allow one payroll line per employee per batch (site) per month,
-- so transferred employees can be paid in each site's batch.
ALTER TABLE public.payroll_lines DROP CONSTRAINT IF EXISTS payroll_lines_unique_emp_month;
DROP INDEX IF EXISTS public.payroll_lines_unique_emp_month;
ALTER TABLE public.payroll_lines
  ADD CONSTRAINT payroll_lines_unique_emp_batch_month UNIQUE (employee_id, month, batch_id);
