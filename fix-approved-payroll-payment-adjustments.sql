-- Apply to the EXISTING EXTERNAL payroll database, after
-- supabase/migrations/20261124000000_payroll_payment_control.sql.
-- No salaries/deductions are recalculated. Existing partial-paid totals with
-- no ledger are explicitly imported as legacy balances, not invented payments.
CREATE TABLE IF NOT EXISTS public.payroll_payment_requests (
  actor_id UUID NOT NULL,
  request_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, request_key)
);
GRANT ALL ON public.payroll_payment_requests TO service_role;
ALTER TABLE public.payroll_payment_requests ENABLE ROW LEVEL SECURITY;
-- No browser access; only the authorized atomic operation owns request receipts.

CREATE OR REPLACE FUNCTION public.adjust_approved_payroll_payments(p_payments JSONB, p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item JSONB;
  row RECORD;
  ledger NUMERIC;
  target NUMERIC;
  delta NUMERIC;
  tx RECORD;
  previous_payload JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_payroll_role(ARRAY['admin','hr','manager']) THEN
    RAISE EXCEPTION 'Not authorized to adjust payroll payments';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'A payment request key is required';
  END IF;
  IF p_payments IS NULL OR jsonb_typeof(p_payments) <> 'array'
     OR jsonb_array_length(p_payments) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Select between 1 and 1000 payments';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::TEXT || p_idempotency_key, 0));
  SELECT payload INTO previous_payload FROM public.payroll_payment_requests
  WHERE actor_id=auth.uid() AND request_key=p_idempotency_key;
  IF FOUND THEN
    IF previous_payload IS DISTINCT FROM p_payments THEN RAISE EXCEPTION 'Request key already used with different payment details'; END IF;
    RETURN jsonb_build_object('duplicate',true);
  END IF;
  IF (SELECT count(DISTINCT value->>'payroll_line_id') FROM jsonb_array_elements(p_payments)) <> jsonb_array_length(p_payments) THEN
    RAISE EXCEPTION 'An employee site line was selected more than once';
  END IF;
  -- Lock batches then lines, in a stable order, before checking balances.
  PERFORM b.id FROM public.payroll_batches b WHERE b.id IN (
    SELECT l.batch_id FROM public.payroll_lines l WHERE l.id IN (
      SELECT (value->>'payroll_line_id')::UUID FROM jsonb_array_elements(p_payments))) ORDER BY b.id FOR UPDATE;
  PERFORM l.id FROM public.payroll_lines l WHERE l.id IN (
    SELECT (value->>'payroll_line_id')::UUID FROM jsonb_array_elements(p_payments)) ORDER BY l.id FOR UPDATE;
  FOR item IN SELECT value FROM jsonb_array_elements(p_payments) ORDER BY value->>'payroll_line_id' LOOP
    SELECT l.*, b.status AS batch_status,b.paid_at,b.paid_by,b.project_id,b.site,b.foreman AS batch_foreman
    INTO row FROM public.payroll_lines l JOIN public.payroll_batches b ON b.id=l.batch_id
    WHERE l.id=(item->>'payroll_line_id')::UUID;
    IF NOT FOUND THEN RAISE EXCEPTION 'Payroll line not found'; END IF;
    IF row.batch_status <> 'APPROVED' OR row.paid_at IS NOT NULL OR row.paid_by IS NOT NULL THEN
      RAISE EXCEPTION 'Only Approved, unfinalised payroll can receive adjustments';
    END IF;
    IF NOT public.has_payroll_role(ARRAY['admin','hr']) AND
      (row.project_id IS NULL OR NOT public.can_access_project(row.project_id)) THEN
      RAISE EXCEPTION 'You do not have access to this payroll site';
    END IF;
    IF row.employee_id IS DISTINCT FROM (item->>'employee_id')::BIGINT THEN RAISE EXCEPTION 'Employee identity mismatch'; END IF;
    IF row.paid IS NULL OR row.paid < 0 OR COALESCE(row.net_pay,row.net_salary,0) <= row.paid + 0.0005 THEN
      RAISE EXCEPTION 'Fully paid or invalid records are protected';
    END IF;
    IF item->>'expected_paid' IS NULL OR round((item->>'expected_paid')::NUMERIC,3) IS DISTINCT FROM round(row.paid,3) THEN
      RAISE EXCEPTION 'Payment balance changed. Refresh and review before trying again';
    END IF;
    IF item->>'mode' NOT IN ('ADD','CORRECT') OR item->>'mode' IS NULL THEN RAISE EXCEPTION 'Invalid payment operation'; END IF;
    target := round((item->>'amount')::NUMERIC,3);
    IF target IS NULL OR target::TEXT IN ('NaN','Infinity','-Infinity') OR target < 0 THEN RAISE EXCEPTION 'Invalid payment amount'; END IF;
    IF item->>'mode'='CORRECT' THEN
      IF NOT public.has_payroll_role(ARRAY['admin','hr']) THEN RAISE EXCEPTION 'Only admin or HR can correct payments'; END IF;
      IF row.paid <= 0 OR length(btrim(COALESCE(item->>'notes',''))) < 3 THEN RAISE EXCEPTION 'Partial payment and correction reason required'; END IF;
      IF target=row.paid THEN RAISE EXCEPTION 'Enter a different paid total'; END IF;
    ELSE
      IF target <= 0 THEN RAISE EXCEPTION 'Top-up must be positive'; END IF;
      target := row.paid + target;
    END IF;
    IF target > COALESCE(row.net_pay,row.net_salary,0) THEN RAISE EXCEPTION 'Payment exceeds site remaining balance'; END IF;
    SELECT COALESCE(sum(amount),0) INTO ledger FROM public.payroll_payment_transactions
      WHERE payroll_line_id=row.id AND transaction_status='COMPLETED';
    IF ledger=0 AND row.paid>0 AND NOT EXISTS(SELECT 1 FROM public.payroll_payment_transactions WHERE payroll_line_id=row.id) THEN
      INSERT INTO public.payroll_payment_transactions(payroll_line_id,employee_id,batch_id,payroll_month,site_id,site_name,foreman_name,
        amount,payment_method,recorded_by,notes,source,idempotency_key)
      VALUES(row.id,row.employee_id,row.batch_id,row.month,row.project_id,COALESCE(row.site,''),COALESCE(row.foreman,row.batch_foreman,''),
        row.paid,'OTHER',auth.uid(),'Legacy paid balance captured before adjustment; original payment date and method are unknown.','LEGACY_IMPORT','legacy-import-'||row.id);
      ledger := row.paid;
    END IF;
    IF round(ledger,3) IS DISTINCT FROM round(row.paid,3) THEN RAISE EXCEPTION 'Payment history differs from paid total; reconcile before adjusting'; END IF;
    IF item->>'mode'='CORRECT' THEN
      -- Reversal preserves original amounts, actors and timestamps. Replacement
      -- is part of this same transaction: any failure rolls everything back.
      FOR tx IN SELECT id FROM public.payroll_payment_transactions WHERE payroll_line_id=row.id AND transaction_status='COMPLETED' ORDER BY id LOOP
        PERFORM public.reverse_payroll_payment(tx.id,item->>'notes');
      END LOOP;
      delta := target;
    ELSE delta := target-row.paid;
    END IF;
    IF delta>0 THEN
      PERFORM public.record_payroll_payments(jsonb_build_array(jsonb_build_object(
        'payroll_line_id',row.id,'employee_id',row.employee_id,'amount',delta,
        'payment_date',COALESCE(item->>'payment_date',CURRENT_DATE::TEXT),
        'payment_method',COALESCE(item->>'payment_method','OTHER'),
        'reference_number',item->>'reference_number',
        'notes',CASE WHEN item->>'mode'='CORRECT' THEN 'Corrected paid total: '|| (item->>'notes') ELSE item->>'notes' END)),
        auth.uid()::TEXT||':'||p_idempotency_key);
    END IF;
  END LOOP;
  INSERT INTO public.payroll_payment_requests(actor_id,request_key,payload) VALUES(auth.uid(),p_idempotency_key,p_payments);
  RETURN jsonb_build_object('duplicate',false);
END;
$$;
REVOKE ALL ON FUNCTION public.adjust_approved_payroll_payments(JSONB,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.adjust_approved_payroll_payments(JSONB,TEXT) TO authenticated;
-- Only the guarded wrapper may invoke the older ledger primitives.
REVOKE EXECUTE ON FUNCTION public.record_payroll_payments(JSONB,TEXT) FROM authenticated,anon,PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reverse_payroll_payment(UUID,TEXT) FROM authenticated,anon,PUBLIC;
NOTIFY pgrst,'reload schema';
