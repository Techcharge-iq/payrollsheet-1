-- Apply to the EXTERNAL payroll database, not the unused Lovable Cloud database.
-- Bucket creation is a separate Storage API operation; do not insert storage.buckets.
ALTER TABLE public.employee_salary_history
  ADD COLUMN IF NOT EXISTS effective_on DATE;
-- Keep unknown historical dates NULL; assigning today would invent rate history.
COMMENT ON COLUMN public.employee_salary_history.effective_on IS
  'Effective salary date. Legacy unknown dates may remain NULL and are ignored by payroll rate selection.';
NOTIFY pgrst, 'reload schema';

-- Apply after creating the private timesheet-uploads bucket through the Storage API.
-- Each user can upload and read their own files; no anonymous access or overwrite.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage'
    AND tablename = 'objects' AND policyname = 'timesheet_uploads_insert_own') THEN
    CREATE POLICY timesheet_uploads_insert_own ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'timesheet-uploads'
        AND (storage.foldername(name))[1] = auth.uid()::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage'
    AND tablename = 'objects' AND policyname = 'timesheet_uploads_select_own') THEN
    CREATE POLICY timesheet_uploads_select_own ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'timesheet-uploads'
        AND (storage.foldername(name))[1] = auth.uid()::text);
  END IF;
END;
$$;