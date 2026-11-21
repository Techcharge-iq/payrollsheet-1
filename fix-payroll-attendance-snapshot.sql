-- Apply to the external payroll database.
ALTER TABLE public.payroll_batches
  ADD COLUMN IF NOT EXISTS attendance_snapshot jsonb;
