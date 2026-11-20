export function payrollSaveErrorMessage(error: { code?: string; message: string }): string {
  if (error.code === "23505" && error.message.includes("payroll_lines_unique_emp_month")) {
    return "Could not save payroll lines: the payroll database still allows only one payroll entry per employee per month, even across different sites. Apply the batch-scoped uniqueness repair in the external payroll database, then retry. Do not delete or overwrite the employee’s existing payroll to bypass this error.";
  }
  return `Could not save payroll lines: ${error.message}`;
}