-- Allow one payroll line per employee per batch (site) per month,
-- so transferred employees can be paid in each site's batch.
ALTER TABLE public.payroll_lines DROP CONSTRAINT IF EXISTS payroll_lines_unique_emp_month;
DROP INDEX IF EXISTS public.payroll_lines_unique_emp_month;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payroll_lines'::regclass
      AND conname = 'payroll_lines_unique_emp_batch_month'
  ) THEN
    ALTER TABLE public.payroll_lines
      ADD CONSTRAINT payroll_lines_unique_emp_batch_month UNIQUE (employee_id, month, batch_id);
  END IF;
END;
$$;

-- Does not update or delete any existing payroll records.
