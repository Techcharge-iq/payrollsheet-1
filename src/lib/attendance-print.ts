/** Prints the on-screen attendance matrix in a clean landscape window. */
export function printAttendanceMatrix() {
  const matrix = document.querySelector<HTMLElement>(".attendance-report-matrix");
  const table = matrix?.querySelector("table");
  if (!matrix || !table) {
    window.alert("Select an employee or site with attendance first, then print.");
    return;
  }
  const title = matrix.querySelector("h3")?.textContent ?? "Attendance report";
  const note = matrix.querySelector("p")?.textContent ?? "";
  const clone = table.cloneNode(true) as HTMLTableElement;
  clone.querySelectorAll("[class]").forEach((el) => el.removeAttribute("class"));
  clone.querySelectorAll<HTMLElement>("[data-cell]").forEach((span) => {
    const v = span.dataset["cell"] ?? "";
    span.className = v === "A" ? "c a" : v === "F" ? "c f" : v === "T" ? "c t" : v === "L" || v === "H" ? "c l" : "c";
    span.textContent = v === "-" ? "—" : v;
  });
  const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
  const win = window.open("", "_blank", "width=1400,height=900");
  if (!win) { window.print(); return; }
  win.document.write(`<!doctype html><html><head><title>${esc(title)}</title><style>
@page { size: A4 landscape; margin: 8mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: Arial, sans-serif; color: #111; margin: 0; padding: 8px; }
h1 { font-size: 15px; margin: 0 0 2px; } .note { font-size: 9px; color: #555; margin: 0 0 6px; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8px; }
th, td { border: 1px solid #cfd6e0; padding: 2px 1px; text-align: center; overflow: hidden; }
thead th { background: #e8eef7; text-transform: uppercase; font-size: 7px; }
tr > :first-child { width: 80px; text-align: left; padding-left: 4px; white-space: nowrap; text-overflow: ellipsis; }
tr > :nth-child(2) { width: 52px; text-align: left; font-size: 7px; }
tfoot td, tfoot th { background: #f1f4f9; font-weight: bold; font-size: 7px; }
tr { break-inside: avoid; } thead { display: table-header-group; }
.c { display: block; border-radius: 2px; padding: 2px 0; }
.a { background: #d98270; color: #fff; } .f { background: #3b82f6; color: #fff; }
.t { background: #fef3c7; color: #78350f; font-weight: bold; } .l { background: #f1f5f9; color: #475569; }
</style></head><body><h1>${esc(title)}</h1><p class="note">${esc(note)}</p></body></html>`);
  win.document.body.appendChild(win.document.importNode(clone, true));
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}
