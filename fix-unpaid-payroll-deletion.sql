-- Prepared ONLY for the external payroll database. Not yet applied.
-- Atomic deletion of an explicitly chosen unpaid batch; no backfill or automatic deletion.
-- Paid/Locked batches, payment markers and nonzero paid amounts remain protected.

CREATE OR REPLACE FUNCTION public.allow_requested_unpaid_payroll_delete(target_batch UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.role() = 'service_role'
    AND current_setting('app.unpaid_payroll_delete', true) = target_batch::text
    AND EXISTS (
      SELECT 1 FROM public.payroll_batches b
      WHERE b.id = target_batch
        AND b.status IN ('DRAFT', 'REVIEW', 'APPROVED', 'LEGACY')
        AND b.paid_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.payroll_lines l
      WHERE l.batch_id = target_batch AND (l.paid IS NULL OR l.paid <> 0)
    );
$$;
REVOKE ALL ON FUNCTION public.allow_requested_unpaid_payroll_delete(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allow_requested_unpaid_payroll_delete(UUID) TO service_role;

-- Preserve existing lifecycle behavior and permissions except this guarded delete path.
-- Fetch each deployed definition, insert one early DELETE guard, and retain its body.
DO $$
DECLARE
  function_name TEXT;
  definition TEXT;
  target_expression TEXT;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'enforce_payroll_batch_lifecycle',
    'enforce_payroll_line_lifecycle',
    'enforce_payroll_allocation_lifecycle'
  ] LOOP
    SELECT pg_get_functiondef(to_regprocedure('public.' || function_name || '()')) INTO definition;
    IF definition IS NULL THEN
      RAISE EXCEPTION 'Required lifecycle function % is missing; inspect external schema before applying', function_name;
    END IF;
    IF position('allow_requested_unpaid_payroll_delete' IN definition) > 0 THEN CONTINUE; END IF;
    IF position(E'BEGIN\n' IN definition) = 0 THEN
      RAISE EXCEPTION 'Unexpected lifecycle definition for %; no change applied', function_name;
    END IF;
    target_expression := CASE function_name
      WHEN 'enforce_payroll_batch_lifecycle' THEN 'OLD.id'
      WHEN 'enforce_payroll_line_lifecycle' THEN 'OLD.batch_id'
      ELSE '(SELECT l.batch_id FROM public.payroll_lines l WHERE l.id = OLD.payroll_line_id)'
    END;
    definition := regexp_replace(definition, E'BEGIN\n',
      E'BEGIN\n  IF TG_OP = ''DELETE'' AND public.allow_requested_unpaid_payroll_delete(' || target_expression ||
      E') THEN\n    RETURN OLD;\n  END IF;\n');
    EXECUTE definition;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_unpaid_payroll_batch(target_batch_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  selected_batch public.payroll_batches%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Only the authorized payroll server may perform batch deletion';
  END IF;
  SELECT * INTO selected_batch FROM public.payroll_batches WHERE id = target_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll batch was not found or already deleted'; END IF;
  PERFORM id FROM public.payroll_lines WHERE batch_id = target_batch_id ORDER BY id FOR UPDATE;
  IF selected_batch.status NOT IN ('DRAFT', 'REVIEW', 'APPROVED', 'LEGACY')
     OR selected_batch.paid_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.payroll_lines WHERE batch_id = target_batch_id AND (paid IS NULL OR paid <> 0)) THEN
    RAISE EXCEPTION 'Paid or locked payroll records are protected and cannot be deleted';
  END IF;
  PERFORM set_config('app.unpaid_payroll_delete', target_batch_id::text, true);
  DELETE FROM public.payroll_site_allocations
    WHERE payroll_line_id IN (SELECT id FROM public.payroll_lines WHERE batch_id = target_batch_id);
  DELETE FROM public.payroll_lines WHERE batch_id = target_batch_id;
  DELETE FROM public.payroll_batches WHERE id = target_batch_id;
  PERFORM set_config('app.unpaid_payroll_delete', '', true);
  RETURN target_batch_id;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_unpaid_payroll_batch(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_unpaid_payroll_batch(UUID) TO service_role;
NOTIFY pgrst, 'reload schema';