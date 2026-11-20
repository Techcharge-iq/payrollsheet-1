-- Prepared for the external payroll database; not applied by the managed database tools.
-- Future draft/review allocations stay within the payroll batch site.
-- No backfill: paid, approved and historical allocations remain untouched.

CREATE OR REPLACE FUNCTION public.refresh_payroll_site_allocations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allocation_row RECORD;
  batch_row RECORD;
  total_regular NUMERIC(12, 3);
  total_overtime NUMERIC(12, 3);
  total_hours NUMERIC(12, 3);
  allocated_before NUMERIC(12, 3) := 0;
  row_number INTEGER := 0;
  row_count INTEGER := 0;
  regular_cost NUMERIC(12, 3);
  overtime_cost NUMERIC(12, 3);
  allowance_cost NUMERIC(12, 3);
  gross_cost NUMERIC(12, 3);
  reg_hours NUMERIC(12, 3);
  ot_hours NUMERIC(12, 3);
BEGIN
  SELECT * INTO batch_row FROM public.payroll_batches WHERE id = NEW.batch_id;
  IF batch_row.status NOT IN ('DRAFT', 'REVIEW') THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.payroll_site_allocations
  WHERE payroll_line_id = NEW.id;

  IF NEW.calculation_version IS NULL OR NEW.gross_pay IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(sum(regular_hours), 0),
    COALESCE(sum(overtime_hours), 0),
    COALESCE(sum(regular_hours + overtime_hours), 0),
    count(*)
  INTO total_regular, total_overtime, total_hours, row_count
  FROM (
    SELECT
      site,
      foreman,
      sum(regular_hours) AS regular_hours,
      sum(overtime_hours) AS overtime_hours
    FROM public.timesheets
    WHERE employee_id = NEW.employee_id
      AND work_date >= (NEW.month || '-01')::date
      AND work_date < ((NEW.month || '-01')::date + INTERVAL '1 month')
      AND regular_hours + overtime_hours > 0
      AND (
        lower(btrim(COALESCE(batch_row.site, ''))) IN ('', 'multiple sites', 'all sites')
        OR (batch_row.project_id IS NOT NULL AND project_id IS NOT NULL AND project_id = batch_row.project_id)
        OR ((batch_row.project_id IS NULL OR project_id IS NULL)
          AND lower(btrim(site)) = lower(btrim(batch_row.site)))
      )
    GROUP BY site, foreman
  ) site_hours;

  -- Fallback to batch site when timesheets are not available
  IF row_count = 0 OR total_hours = 0 THEN
    SELECT * INTO batch_row
    FROM public.payroll_batches
    WHERE id = NEW.batch_id;

    reg_hours := COALESCE(NEW.regular_hours, GREATEST(COALESCE(NEW.hours, 0) - COALESCE(NEW.overtime_hours, 0), 0), 0);
    ot_hours := COALESCE(NEW.overtime_hours, 0);

    INSERT INTO public.payroll_site_allocations (
      payroll_line_id,
      employee_id,
      month,
      site,
      foreman,
      project_id,
      regular_hours,
      overtime_hours,
      allocated_regular_pay,
      allocated_overtime_pay,
      allocated_allowances,
      allocated_gross_cost,
      allocation_basis,
      calculation_version
    )
    VALUES (
      NEW.id,
      NEW.employee_id,
      NEW.month,
      COALESCE(NULLIF(btrim(batch_row.site), ''), 'Unassigned'),
      COALESCE(NULLIF(btrim(NEW.foreman), ''), NULLIF(btrim(batch_row.foreman), ''), 'Unassigned'),
      batch_row.project_id,
      reg_hours,
      ot_hours,
      COALESCE(NEW.regular_pay, reg_hours * COALESCE(NEW.rate, 0), 0),
      COALESCE(NEW.overtime_pay, ot_hours * COALESCE(NEW.rate, 0), 0),
      COALESCE(NEW.allowances, 0),
      COALESCE(NEW.gross_pay, 0),
      'LEGACY_ESTIMATED',
      NEW.calculation_version
    );

    RETURN NEW;
  END IF;

  -- Allocate by attendance hours
  row_number := 0;
  FOR allocation_row IN
    SELECT
      site,
      foreman,
      sum(regular_hours) AS regular_hours,
      sum(overtime_hours) AS overtime_hours
    FROM public.timesheets
    WHERE employee_id = NEW.employee_id
      AND work_date >= (NEW.month || '-01')::date
      AND work_date < ((NEW.month || '-01')::date + INTERVAL '1 month')
      AND regular_hours + overtime_hours > 0
      AND (
        lower(btrim(COALESCE(batch_row.site, ''))) IN ('', 'multiple sites', 'all sites')
        OR (batch_row.project_id IS NOT NULL AND project_id IS NOT NULL AND project_id = batch_row.project_id)
        OR ((batch_row.project_id IS NULL OR project_id IS NULL)
          AND lower(btrim(site)) = lower(btrim(batch_row.site)))
      )
    GROUP BY site, foreman
    ORDER BY site, foreman
  LOOP
    row_number := row_number + 1;
    regular_cost := CASE
      WHEN total_regular > 0
        THEN round(COALESCE(NEW.regular_pay, 0) * allocation_row.regular_hours / total_regular, 3)
      ELSE 0
    END;
    overtime_cost := CASE
      WHEN total_overtime > 0
        THEN round(COALESCE(NEW.overtime_pay, 0) * allocation_row.overtime_hours / total_overtime, 3)
      ELSE 0
    END;
    allowance_cost := round(
      COALESCE(NEW.allowances, 0)
      * (allocation_row.regular_hours + allocation_row.overtime_hours)
      / total_hours,
      3
    );

    IF row_number = row_count THEN
      gross_cost := round(COALESCE(NEW.gross_pay, 0) - allocated_before, 3);
    ELSE
      gross_cost := regular_cost + overtime_cost + allowance_cost;
      allocated_before := allocated_before + gross_cost;
    END IF;

    INSERT INTO public.payroll_site_allocations (
      payroll_line_id,
      employee_id,
      month,
      site,
      foreman,
      regular_hours,
      overtime_hours,
      allocated_regular_pay,
      allocated_overtime_pay,
      allocated_allowances,
      allocated_gross_cost,
      allocation_basis,
      calculation_version
    )
    VALUES (
      NEW.id,
      NEW.employee_id,
      NEW.month,
      allocation_row.site,
      allocation_row.foreman,
      allocation_row.regular_hours,
      allocation_row.overtime_hours,
      regular_cost,
      overtime_cost,
      allowance_cost,
      gross_cost,
      'ATTENDANCE_HOURS',
      NEW.calculation_version
    );
  END LOOP;

  RETURN NEW;
END;
$$;

