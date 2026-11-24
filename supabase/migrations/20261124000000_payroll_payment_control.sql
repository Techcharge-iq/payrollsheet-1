-- Additive payroll payment control. Existing payroll calculations and payroll line IDs are unchanged.

ALTER TABLE public.payroll_lines
  ADD COLUMN IF NOT EXISTS payment_status TEXT,
  ADD COLUMN IF NOT EXISTS payment_status_updated_at TIMESTAMPTZ;

ALTER TABLE public.payroll_lines
  DROP CONSTRAINT IF EXISTS payroll_lines_payment_status_check;
ALTER TABLE public.payroll_lines
  ADD CONSTRAINT payroll_lines_payment_status_check
  CHECK (payment_status IS NULL OR payment_status IN ('UNPAID','PARTIALLY_PAID','PAID','NO_PAYMENT_DUE'));

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

CREATE TABLE IF NOT EXISTS public.payroll_payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_line_id UUID NOT NULL REFERENCES public.payroll_lines(id) ON DELETE RESTRICT,
  employee_id BIGINT NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  batch_id UUID NOT NULL REFERENCES public.payroll_batches(id) ON DELETE RESTRICT,
  payroll_month TEXT NOT NULL,
  site_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  site_name TEXT NOT NULL DEFAULT '',
  foreman_user_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  foreman_name TEXT NOT NULL DEFAULT '',
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(12,3) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH','BANK','CHEQUE','TRANSFER','OTHER')),
  reference_number TEXT,
  recorded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  transaction_status TEXT NOT NULL DEFAULT 'COMPLETED'
    CHECK (transaction_status IN ('COMPLETED','REVERSED')),
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'MANUAL'
    CHECK (source IN ('MANUAL','LEGACY_IMPORT','REVERSAL')),
  idempotency_key TEXT,
  reversal_of UUID REFERENCES public.payroll_payment_transactions(id) ON DELETE RESTRICT,
  reversed_at TIMESTAMPTZ,
  reversed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reversal_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.payroll_payment_transactions
  DROP CONSTRAINT IF EXISTS payroll_payment_transactions_transaction_status_check;
ALTER TABLE public.payroll_payment_transactions
  DROP CONSTRAINT IF EXISTS payroll_payment_transactions_source_check;
ALTER TABLE public.payroll_payment_transactions
  ALTER COLUMN amount TYPE NUMERIC(12,3);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_payment_idempotency_unique_idx
  ON public.payroll_payment_transactions(payroll_line_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payroll_payment_legacy_line_unique_idx
  ON public.payroll_payment_transactions(payroll_line_id)
  WHERE source = 'LEGACY_IMPORT';
CREATE INDEX IF NOT EXISTS payroll_payment_employee_month_idx
  ON public.payroll_payment_transactions(employee_id, payroll_month);
CREATE INDEX IF NOT EXISTS payroll_payment_line_idx
  ON public.payroll_payment_transactions(payroll_line_id, created_at);
CREATE INDEX IF NOT EXISTS payroll_payment_site_month_idx
  ON public.payroll_payment_transactions(site_id, payroll_month);
CREATE INDEX IF NOT EXISTS payroll_payment_status_idx
  ON public.payroll_payment_transactions(transaction_status, payment_date DESC);

ALTER TABLE public.payroll_payment_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payroll_payment_transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payroll_payment_transactions TO authenticated;
GRANT INSERT, UPDATE ON public.payroll_payment_transactions TO service_role;

DROP POLICY IF EXISTS payroll_payment_transactions_staff_read ON public.payroll_payment_transactions;
CREATE POLICY payroll_payment_transactions_staff_read
  ON public.payroll_payment_transactions FOR SELECT TO authenticated
  USING (
    public.has_payroll_role(ARRAY['admin','hr','manager','foreman'])
    AND (
      public.has_payroll_role(ARRAY['admin','hr'])
      OR (site_id IS NOT NULL AND public.can_access_project(site_id))
    )
  );

CREATE OR REPLACE FUNCTION public.sync_payroll_line_payment_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_line UUID;
  net_amount NUMERIC(12,3);
  paid_amount NUMERIC(12,3);
  status_value TEXT;
BEGIN
  target_line := CASE WHEN TG_OP = 'DELETE' THEN OLD.payroll_line_id ELSE NEW.payroll_line_id END;
  SELECT COALESCE(net_pay, net_salary, 0)
    INTO net_amount
  FROM public.payroll_lines WHERE id = target_line
  FOR UPDATE;
  SELECT COALESCE(SUM(amount), 0)
    INTO paid_amount
  FROM public.payroll_payment_transactions
  WHERE payroll_line_id = target_line
    AND transaction_status = 'COMPLETED';

  IF net_amount <= 0 THEN
    status_value := 'NO_PAYMENT_DUE';
  ELSIF paid_amount <= 0 THEN
    status_value := 'UNPAID';
  ELSIF paid_amount >= net_amount - 0.0005 THEN
    status_value := 'PAID';
  ELSE
    status_value := 'PARTIALLY_PAID';
  END IF;

  PERFORM set_config('app.allow_payroll_payment_update', 'true', true);
  UPDATE public.payroll_lines
  SET paid = LEAST(GREATEST(paid_amount, 0), GREATEST(net_amount, 0)),
      payment_status = status_value,
      payment_status_updated_at = now()
  WHERE id = target_line;
  PERFORM set_config('app.allow_payroll_payment_update', '', true);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS payroll_payment_sync_status_trg ON public.payroll_payment_transactions;
CREATE TRIGGER payroll_payment_sync_status_trg
AFTER INSERT OR UPDATE OR DELETE ON public.payroll_payment_transactions
FOR EACH ROW EXECUTE FUNCTION public.sync_payroll_line_payment_status();

CREATE OR REPLACE FUNCTION public.record_payroll_payments(
  p_payments JSONB,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item JSONB;
  line_record RECORD;
  paid_amount NUMERIC(12,3);
  payment_amount NUMERIC(12,3);
  net_amount NUMERIC(12,3);
  created_ids UUID[] := ARRAY[]::UUID[];
  tx_id UUID;
  existing_tx JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_payroll_role(ARRAY['admin','hr','manager']) THEN
    RAISE EXCEPTION 'Only an authorized payroll administrator or accountant can record payments';
  END IF;
  IF p_payments IS NULL OR jsonb_typeof(p_payments) <> 'array' OR jsonb_array_length(p_payments) = 0 THEN
    RAISE EXCEPTION 'At least one payment is required';
  END IF;
  IF jsonb_array_length(p_payments) > 1000 THEN
    RAISE EXCEPTION 'A maximum of 1000 payments can be submitted in one operation';
  END IF;

  IF p_idempotency_key IS NOT NULL AND length(btrim(p_idempotency_key)) > 0 THEN
    SELECT jsonb_agg(to_jsonb(t) - 'recorded_by')
      INTO existing_tx
    FROM public.payroll_payment_transactions t
    WHERE t.idempotency_key = p_idempotency_key
      AND t.transaction_status = 'COMPLETED';
    IF existing_tx IS NOT NULL AND jsonb_array_length(existing_tx) > 0 THEN
      RETURN jsonb_build_object('duplicate', true, 'transactions', existing_tx);
    END IF;
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    payment_amount := ROUND(COALESCE((item->>'amount')::NUMERIC, -1), 3);
    IF payment_amount <= 0 THEN
      RAISE EXCEPTION 'Payment amount must be greater than zero';
    END IF;

    SELECT l.*, b.status AS batch_status, b.month AS batch_month, b.site AS batch_site,
           b.project_id AS batch_project_id, b.foreman_user_id AS batch_foreman_user_id,
           b.foreman AS batch_foreman
      INTO line_record
    FROM public.payroll_lines l
    JOIN public.payroll_batches b ON b.id = l.batch_id
    WHERE l.id = (item->>'payroll_line_id')::UUID
    FOR UPDATE OF l;

    IF NOT FOUND THEN RAISE EXCEPTION 'Payroll line % was not found', item->>'payroll_line_id'; END IF;
    IF line_record.batch_status NOT IN ('APPROVED','PAID','LOCKED','LEGACY') THEN
      RAISE EXCEPTION 'Payments are only allowed against approved or paid payroll records';
    END IF;
    IF line_record.employee_id <> (item->>'employee_id')::BIGINT THEN
      RAISE EXCEPTION 'Employee identity does not match payroll line';
    END IF;

    net_amount := ROUND(COALESCE(line_record.net_pay, line_record.net_salary, 0), 3);
    IF net_amount <= 0 THEN RAISE EXCEPTION 'This payroll allocation has no payment due'; END IF;
    SELECT COALESCE(SUM(amount), 0) INTO paid_amount
    FROM public.payroll_payment_transactions
    WHERE payroll_line_id = line_record.id AND transaction_status = 'COMPLETED';

    IF paid_amount + payment_amount > net_amount + 0.0005 THEN
      RAISE EXCEPTION 'Payment exceeds remaining balance for payroll line %', line_record.id;
    END IF;

    INSERT INTO public.payroll_payment_transactions (
      payroll_line_id, employee_id, batch_id, payroll_month, site_id, site_name,
      foreman_user_id, foreman_name, payment_date, amount, payment_method,
      reference_number, recorded_by, transaction_status, notes, source, idempotency_key
    )
    VALUES (
      line_record.id, line_record.employee_id, line_record.batch_id,
      line_record.month, line_record.batch_project_id, line_record.batch_site,
      line_record.foreman_user_id, line_record.foreman,
      COALESCE(NULLIF(item->>'payment_date','')::DATE, CURRENT_DATE),
      payment_amount,
      UPPER(COALESCE(NULLIF(item->>'payment_method',''), 'OTHER')),
      NULLIF(item->>'reference_number',''),
      auth.uid(), 'COMPLETED',
      NULLIF(item->>'notes',''), 'MANUAL',
      CASE WHEN p_idempotency_key IS NULL THEN NULL ELSE p_idempotency_key END
    )
    RETURNING id INTO tx_id;
    created_ids := array_append(created_ids, tx_id);
  END LOOP;

  RETURN jsonb_build_object('duplicate', false, 'transactions', created_ids);
END;
$$;
REVOKE ALL ON FUNCTION public.record_payroll_payments(JSONB,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_payroll_payments(JSONB,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.reverse_payroll_payment(
  p_transaction_id UUID,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tx RECORD;
  reversal_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_payroll_role(ARRAY['admin','hr']) THEN
    RAISE EXCEPTION 'Only an administrator or payroll accountant can reverse payments';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'A reversal reason is required';
  END IF;

  SELECT * INTO tx
  FROM public.payroll_payment_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment transaction was not found'; END IF;
  IF tx.transaction_status = 'REVERSED' THEN RAISE EXCEPTION 'This payment is already reversed'; END IF;

  UPDATE public.payroll_payment_transactions
  SET transaction_status='REVERSED',
      reversed_at=now(),
      reversed_by=auth.uid(),
      reversal_reason=btrim(p_reason),
      updated_at=now()
  WHERE id=p_transaction_id;

  INSERT INTO public.payroll_payment_transactions (
    payroll_line_id, employee_id, batch_id, payroll_month, site_id, site_name,
    foreman_user_id, foreman_name, payment_date, amount, payment_method,
    reference_number, recorded_by, transaction_status, notes, source,
    reversal_of
  )
  VALUES (
    tx.payroll_line_id, tx.employee_id, tx.batch_id, tx.payroll_month,
    tx.site_id, tx.site_name, tx.foreman_user_id, tx.foreman_name,
    CURRENT_DATE, tx.amount, tx.payment_method, tx.reference_number,
    auth.uid(), 'REVERSED', btrim(p_reason), 'REVERSAL', tx.id
  )
  RETURNING id INTO reversal_id;
  RETURN reversal_id;
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_payroll_payment(UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_payroll_payment(UUID,TEXT) TO authenticated;

-- Backfill existing line totals only when no transaction history exists.
INSERT INTO public.payroll_payment_transactions (
  payroll_line_id, employee_id, batch_id, payroll_month, site_id, site_name,
  foreman_user_id, foreman_name, payment_date, amount, payment_method,
  reference_number, recorded_by, transaction_status, notes, source, idempotency_key
)
SELECT l.id, l.employee_id, l.batch_id, l.month,
       b.project_id, b.site, l.foreman_user_id, l.foreman,
       COALESCE(b.paid_at::DATE, b.approved_at::DATE, b.created_at::DATE, CURRENT_DATE),
       ROUND(l.paid,3), 'OTHER', NULL,
       COALESCE(b.paid_by,b.approved_by),
       'COMPLETED',
       'Imported existing payroll paid balance; no original transaction detail was available.',
       'LEGACY_IMPORT', 'legacy-import-' || l.id::TEXT
FROM public.payroll_lines l
JOIN public.payroll_batches b ON b.id=l.batch_id
WHERE l.paid > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.payroll_payment_transactions t
    WHERE t.payroll_line_id=l.id
  )
  AND COALESCE(b.paid_by,b.approved_by) IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TRIGGER payroll_payment_transactions_audit_log_trg
AFTER INSERT OR UPDATE OR DELETE ON public.payroll_payment_transactions
FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log();

-- Permit only the payment RPC to reconcile payroll_lines.paid, while keeping
-- all existing payroll calculation fields protected.
CREATE OR REPLACE FUNCTION public.enforce_payroll_line_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_status TEXT;
  current_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT b.status INTO old_status
    FROM public.payroll_batches b
    WHERE b.id=OLD.batch_id
    FOR UPDATE;
    IF old_status IS NULL THEN RAISE EXCEPTION 'Payroll batch does not exist'; END IF;
    IF NOT public.has_payroll_role(ARRAY['admin'])
       AND old_status NOT IN ('DRAFT','REVIEW') THEN
      RAISE EXCEPTION 'Payroll lines cannot be deleted from % batches', old_status;
    END IF;
    RETURN OLD;
  END IF;

  SELECT b.status INTO current_status
  FROM public.payroll_batches b
  WHERE b.id=NEW.batch_id
  FOR UPDATE;
  IF TG_OP = 'INSERT' THEN
    IF current_status IS NULL THEN RAISE EXCEPTION 'Payroll batch does not exist'; END IF;
    IF NOT public.has_payroll_role(ARRAY['admin']) AND current_status NOT IN ('DRAFT','REVIEW') THEN
      RAISE EXCEPTION 'Payroll lines can only be added to DRAFT or REVIEW batches';
    END IF;
  ELSE
    SELECT b.status INTO old_status
    FROM public.payroll_batches b
    WHERE b.id=OLD.batch_id
    FOR UPDATE;

    IF current_setting('app.allow_payroll_payment_update', true) = 'true'
       AND (to_jsonb(NEW) - 'paid' - 'payment_status' - 'payment_status_updated_at')
           IS NOT DISTINCT FROM
           (to_jsonb(OLD) - 'paid' - 'payment_status' - 'payment_status_updated_at') THEN
      IF NEW.paid < 0 OR NEW.paid > COALESCE(NEW.net_pay, NEW.net_salary, 0) THEN
        RAISE EXCEPTION 'Paid amount cannot exceed the approved net payable';
      END IF;
      RETURN NEW;
    END IF;

    IF current_status IN ('APPROVED','PAID','LOCKED','LEGACY') THEN
      RAISE EXCEPTION 'Approved, paid and locked payroll lines cannot be edited';
    END IF;
  END IF;

  IF NEW.paid < 0 OR NEW.paid > COALESCE(NEW.net_pay, NEW.net_salary, 0) THEN
    RAISE EXCEPTION 'Paid amount cannot exceed net payable';
  END IF;
  RETURN NEW;
END;
$$;

-- Payment transactions protect batch deletion independently of the old paid cache.
CREATE OR REPLACE FUNCTION public.prevent_paid_payroll_batch_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.payroll_payment_transactions t
    JOIN public.payroll_lines l ON l.id=t.payroll_line_id
    WHERE l.batch_id=OLD.id
  ) THEN
    RAISE EXCEPTION 'Payroll batches containing payment transactions cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS prevent_paid_payroll_batch_delete_trg ON public.payroll_batches;
CREATE TRIGGER prevent_paid_payroll_batch_delete_trg
BEFORE DELETE ON public.payroll_batches
FOR EACH ROW EXECUTE FUNCTION public.prevent_paid_payroll_batch_delete();

-- Initialize individual statuses for existing lines.
UPDATE public.payroll_lines l
SET payment_status = CASE
      WHEN COALESCE(l.net_pay,l.net_salary,0)<=0 THEN 'NO_PAYMENT_DUE'
      WHEN COALESCE(l.paid,0)<=0 THEN 'UNPAID'
      WHEN l.paid>=COALESCE(l.net_pay,l.net_salary,0)-0.0005 THEN 'PAID'
      ELSE 'PARTIALLY_PAID'
    END,
    payment_status_updated_at=now();

NOTIFY pgrst, 'reload schema';
