import { jsPDF } from "jspdf";
import JSZip from "jszip";
import QRCode from "qrcode";
import {
  fmt,
  lineBalance,
  lineGross,
  monthLabel,
  toNum,
  type Employee,
  type HistoryRow,
} from "./payroll";

type RGB = [number, number, number];
type HeaderImage = string;

const INK: RGB = [24, 29, 35];
const MUTED: RGB = [91, 100, 110];
const BORDER: RGB = [190, 197, 203];
const GREEN: RGB = [54, 157, 117];
const RED: RGB = [204, 69, 70];
const BLUE: RGB = [52, 111, 170];

export interface SlipSiteBreakdown {
  site: string;
  hours: number;
  foodDeduction: number;
}

export interface SlipInput {
  employee: Employee;
  month: string;
  row: HistoryRow;
  rows?: HistoryRow[];
  siteBreakdown?: SlipSiteBreakdown[];
  carriedForward: number;
  outstandingAdvance: number;
}

function money(value: number) {
  return `${fmt(value)} OMR`;
}

function fitFontSize(doc: jsPDF, text: string, maxWidth: number, preferred: number, minimum = 6) {
  let size = preferred;
  while (size > minimum) {
    doc.setFontSize(size);
    if (doc.getTextWidth(text) <= maxWidth) return size;
    size -= 0.25;
  }
  doc.setFontSize(minimum);
  return minimum;
}

function fitText(
  doc: jsPDF,
  text: string,
  maxWidth: number,
  preferred: number,
  minimum = 6,
): string {
  fitFontSize(doc, text, maxWidth, preferred, minimum);
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0 && doc.getTextWidth(truncated + "…") > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated.length > 0 ? truncated + "…" : text;
}

let headerImagePromise: Promise<HeaderImage> | undefined;

function loadHeaderImage() {
  if (!headerImagePromise) {
    headerImagePromise = fetch("/Salary Header.png")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Unable to load salary slip header (${response.status}).`);
        }
        return response.blob();
      })
      .then(
        (blob) =>
          new Promise<HeaderImage>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result !== "string") {
                reject(new Error("Salary slip header could not be read."));
                return;
              }
              resolve(reader.result);
            };
            reader.onerror = () => reject(new Error("Salary slip header could not be read."));
            reader.readAsDataURL(blob);
          }),
      );
  }
  return headerImagePromise;
}

function drawLabelValue(
  doc: jsPDF,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
) {
  const cellRight = x + width;
  const labelMaxWidth = width * 0.46;
  const valueMaxWidth = width * 0.48;
  doc.setFont("helvetica", "bold");
  fitFontSize(doc, label, labelMaxWidth, 8.5, 6.25);
  doc.setTextColor(...INK);
  doc.text(label, x, y);
  doc.setFont("helvetica", "normal");
  fitFontSize(doc, value || "—", valueMaxWidth, 9, 6.25);
  doc.text(value || "—", cellRight, y, { align: "right" });
}

export interface CardRowItem {
  kind?: "row";
  label: string;
  value: string;
  emphasis?: boolean;
  highlight?: boolean;
  outlineRed?: boolean;
}

export interface CardTableItem {
  kind: "table";
  headers: [string, string];
  rows: Array<[string, string]>;
}

export type CardItem = CardRowItem | CardTableItem;

function drawCard(
  doc: jsPDF,
  title: string,
  color: RGB,
  x: number,
  y: number,
  width: number,
  height: number,
  items: CardItem[],
  total: { label: string; value: string },
) {
  const headerHeight = 11;
  const panelInset = 3;
  const columnGap = 2;
  const valueBoxWidth = 24;
  const valueBoxHeight = 6.2;

  doc.setFillColor(249, 250, 251);
  doc.setDrawColor(225, 229, 233);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, width, height, 2, 2, "FD");

  doc.setFillColor(...color);
  doc.roundedRect(x, y, width, headerHeight, 2, 2, "F");
  doc.rect(x, y + 6, width, 5, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  fitFontSize(doc, title, width - 8, 10.5, 8);
  doc.text(title, x + width / 2, y + 7.5, { align: "center" });

  let currentY = y + 13.5;

  items.forEach((item) => {
    if (item.kind === "table") {
      const headerH = 3.6;
      const rowH = 3.6;
      const tableH = headerH + item.rows.length * rowH;
      const tableX = x + panelInset;
      const tableW = width - panelInset * 2;

      doc.setFillColor(248, 249, 250);
      doc.setDrawColor(226, 230, 234);
      doc.setLineWidth(0.2);
      doc.roundedRect(tableX, currentY, tableW, tableH, 1, 1, "FD");

      doc.setFillColor(238, 242, 246);
      doc.roundedRect(tableX, currentY, tableW, headerH, 1, 1, "F");
      doc.rect(tableX, currentY + headerH - 1, tableW, 1, "F");
      doc.setDrawColor(220, 225, 230);
      doc.setLineWidth(0.2);
      doc.line(tableX, currentY + headerH, tableX + tableW, currentY + headerH);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.25);
      doc.setTextColor(...MUTED);
      doc.text(item.headers[0], tableX + 2, currentY + 2.6);
      doc.text(item.headers[1], tableX + tableW - 2, currentY + 2.6, { align: "right" });

      item.rows.forEach(([col1, col2], idx) => {
        const rY = currentY + headerH + idx * rowH;
        if (idx > 0) {
          doc.setDrawColor(235, 238, 242);
          doc.setLineWidth(0.15);
          doc.line(tableX + 1, rY, tableX + tableW - 1, rY);
        }
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.25);
        doc.setTextColor(...INK);
        const fitCol1 = fitText(doc, col1, tableW - 21, 6.25, 5);
        doc.text(fitCol1, tableX + 2, rY + 2.6);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.25);
        doc.setTextColor(...INK);
        doc.text(col2, tableX + tableW - 2, rY + 2.6, { align: "right" });
      });

      currentY += tableH + 1.8;
    } else {
      const innerLeft = x + panelInset;
      const valueRight = x + width - panelInset;
      const labelWidth = valueRight - innerLeft - valueBoxWidth - columnGap;
      const valueLeft = valueRight - valueBoxWidth;

      doc.setFont("helvetica", "bold");
      const labelFontSize = item.highlight ? 8 : 7.5;
      doc.setFontSize(labelFontSize);
      const labelLines = doc.splitTextToSize(item.label, labelWidth);
      const labelColor: RGB = item.highlight ? [146, 64, 14] : INK;
      doc.setTextColor(...labelColor);
      const lineH = 2.6;
      const firstLineY = currentY + valueBoxHeight / 2 - ((labelLines.length - 1) * lineH) / 2 + 0.7;
      doc.text(labelLines, innerLeft, firstLineY, { lineHeightFactor: 1 });

      if (item.highlight) {
        doc.setFillColor(254, 243, 199);
        doc.setDrawColor(217, 119, 6);
        doc.setLineWidth(0.45);
      } else if (item.outlineRed) {
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(...RED);
        doc.setLineWidth(0.65);
      } else {
        doc.setFillColor(255, 255, 255);
        const borderColor: RGB = item.outlineRed === false ? [225, 229, 233] : color;
        doc.setDrawColor(...borderColor);
        doc.setLineWidth(0.25);
      }
      doc.roundedRect(valueLeft, currentY, valueBoxWidth, valueBoxHeight, 1.25, 1.25, "FD");

      doc.setFont("helvetica", item.emphasis || item.highlight ? "bold" : "normal");
      fitFontSize(doc, item.value || "—", valueBoxWidth - 3, item.highlight ? 8.25 : 7.75, 6);
      const valueColor: RGB = item.highlight ? [146, 64, 14] : item.outlineRed ? RED : INK;
      doc.setTextColor(...valueColor);
      doc.text(item.value || "—", valueRight - 2, currentY + 4.3, { align: "right" });

      currentY += valueBoxHeight + 1.8;
    }
  });

  const totalRowY = y + height - 5;
  doc.setFillColor(...color);
  doc.roundedRect(x + 2.5, y + height - 10.5, width - 5, 8.5, 1.5, 1.5, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  const totalLabelWidth = width - panelInset * 2 - valueBoxWidth - columnGap;
  fitFontSize(doc, total.label, totalLabelWidth, 8.25, 6.25);
  doc.text(total.label, x + panelInset + 1, totalRowY);
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...color);
  doc.roundedRect(
    x + width - panelInset - valueBoxWidth,
    y + height - 9.7,
    valueBoxWidth,
    6.8,
    1.25,
    1.25,
    "FD",
  );
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  fitFontSize(doc, total.value, valueBoxWidth - 4, 8, 6.25);
  doc.text(total.value, x + width - panelInset - 2, totalRowY, { align: "right" });
}

export function consolidateSlips(slips: SlipInput[]): SlipInput[] {
  if (!slips.length) return [];

  const grouped = new Map<string, SlipInput[]>();
  for (const slip of slips) {
    const key = `${slip.employee.id}_${slip.month}`;
    const list = grouped.get(key);
    if (list) {
      list.push(slip);
    } else {
      grouped.set(key, [slip]);
    }
  }

  const consolidated: SlipInput[] = [];
  for (const group of grouped.values()) {
    const first = group[0]!;
    const employee = first.employee;
    const month = first.month;
    const carriedForward = first.carriedForward;
    const outstandingAdvance = first.outstandingAdvance;

    const allRows: HistoryRow[] = [];
    for (const item of group) {
      if (item.rows && item.rows.length) {
        allRows.push(...item.rows);
      } else {
        allRows.push(item.row);
      }
    }

    const siteMap = new Map<string, { site: string; hours: number; foodDeduction: number }>();
    let totalHours = 0;
    let totalFood = 0;
    let totalPrevAdv = 0;
    let totalNewAdv = 0;
    let totalOtherDeduct = 0;
    let totalNet = 0;
    let totalPaid = 0;
    let effectiveRate = 0;
    const uniqueSites = new Set<string>();
    const uniqueForemen = new Set<string>();

    for (const r of allRows) {
      const siteDisplay = (r.site || "—").trim() || "—";
      const siteKey = siteDisplay.toLowerCase();
      uniqueSites.add(siteDisplay);
      const foreman = (r.foreman || r.batchForeman || "").trim();
      if (foreman) uniqueForemen.add(foreman);

      const h = toNum(r.hours);
      const f = toNum(r.food_deduction);
      totalHours += h;
      totalFood += f;
      totalPrevAdv += toNum(r.prev_advance);
      totalNewAdv += toNum(r.new_advance);
      totalOtherDeduct += toNum(r.other_deduction);
      totalNet += toNum(r.net_salary);
      totalPaid += toNum(r.paid);
      if (!effectiveRate && toNum(r.rate) > 0) {
        effectiveRate = toNum(r.rate);
      }

      const existing = siteMap.get(siteKey);
      if (existing) {
        existing.hours += h;
        existing.foodDeduction += f;
      } else {
        siteMap.set(siteKey, { site: siteDisplay, hours: h, foodDeduction: f });
      }
    }

    if (!effectiveRate) {
      effectiveRate = toNum(employee.hourly_rate);
    }

    const siteBreakdown: SlipSiteBreakdown[] = Array.from(siteMap.values()).map((entry) => ({
      site: entry.site,
      hours: Math.round(entry.hours * 100) / 100,
      foodDeduction: Math.round(entry.foodDeduction * 1000) / 1000,
    }));

    if (!siteBreakdown.length) {
      siteBreakdown.push({
        site: "Main Site",
        hours: Math.round(totalHours * 100) / 100,
        foodDeduction: Math.round(totalFood * 1000) / 1000,
      });
    }

    const consolidatedRow: HistoryRow = {
      ...first.row,
      hours: Math.round(totalHours * 100) / 100,
      rate: effectiveRate,
      food_deduction: Math.round(totalFood * 1000) / 1000,
      prev_advance: Math.round(totalPrevAdv * 1000) / 1000,
      new_advance: Math.round(totalNewAdv * 1000) / 1000,
      other_deduction: Math.round(totalOtherDeduct * 1000) / 1000,
      net_salary: Math.round(totalNet * 1000) / 1000,
      paid: Math.round(totalPaid * 1000) / 1000,
      site: Array.from(uniqueSites).join(", ") || "—",
      foreman: Array.from(uniqueForemen).join(", ") || "—",
      batchForeman: Array.from(uniqueForemen).join(", ") || "—",
    };

    consolidated.push({
      employee,
      month,
      row: consolidatedRow,
      rows: allRows,
      siteBreakdown,
      carriedForward,
      outstandingAdvance,
    });
  }

  return consolidated;
}

async function drawSlip(doc: jsPDF, rawSlip: SlipInput, headerImage: HeaderImage) {
  const slip = consolidateSlips([rawSlip])[0] || rawSlip;
  const { employee: e, month, row, siteBreakdown = [] } = slip;
  const pageWidth = 210;
  const left = 15;
  const contentWidth = 180;
  const totalHours = toNum(row.hours);
  const gross = lineGross(row);
  const food = toNum(row.food_deduction);
  const advanceRecovered = toNum(row.prev_advance);
  const other = toNum(row.other_deduction);
  const totalDeductions = food + advanceRecovered + other;
  const net = toNum(row.net_salary);
  const balance = lineBalance(row);
  const status = toNum(row.paid) >= net ? "PAID" : toNum(row.paid) > 0 ? "PARTIAL" : "PENDING";
  const outstandingVal = toNum(slip.outstandingAdvance);

  doc.setFillColor(252, 253, 254);
  doc.rect(0, 0, pageWidth, 297, "F");

  doc.addImage(headerImage, "PNG", left, 8, contentWidth, 31);
  doc.setTextColor(...MUTED);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(monthLabel(month).toUpperCase(), pageWidth / 2, 44, { align: "center" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text("STAFF DETAILS:", left, 57);

  const tableY = 61;
  const rowHeight = 10;
  const columns = [left, 53, 105, 143, left + contentWidth];
  const staffRows: Array<[string, string, string, string]> = [
    ["NAME EMPLOYEE:", e.name, "TRADE:", e.trade],
    ["EMP ID NO:", e.id_number || "—", "SALARY MONTH:", monthLabel(month)],
    ["SITE:", row.site || "—", "FOREMAN:", row.foreman || row.batchForeman || "—"],
  ];
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.25);
  staffRows.forEach((values, index) => {
    const y = tableY + index * rowHeight;
    doc.rect(left, y, contentWidth, rowHeight);
    doc.line(columns[1]!, y, columns[1]!, y + rowHeight);
    doc.line(columns[2]!, y, columns[2]!, y + rowHeight);
    doc.line(columns[3]!, y, columns[3]!, y + rowHeight);
    const cells: Array<[number, string, boolean]> = [
      [0, values[0], true],
      [1, values[1], false],
      [2, values[2], true],
      [3, values[3], false],
    ];
    cells.forEach(([col, text, isLabel]) => {
      const x0 = columns[col]! + 3;
      const w = columns[col + 1]! - columns[col]! - 6;
      doc.setFont("helvetica", isLabel ? "bold" : "normal");
      const displayText = fitText(doc, text || "—", w, isLabel ? 8.5 : 9, 6.25);
      doc.setTextColor(...INK);
      doc.text(displayText, x0, y + 6.3);
    });
  });

  const cardY = 96;
  const cardHeight = 82;
  const gap = 6;
  const cardWidth = (contentWidth - gap * 2) / 3;

  const effectiveBreakdown =
    siteBreakdown.length > 0
      ? siteBreakdown
      : [{ site: row.site || "Main Site", hours: totalHours, foodDeduction: food }];

  drawCard(
    doc,
    "INCOME",
    GREEN,
    left,
    cardY,
    cardWidth,
    cardHeight,
    [
      { label: "SALARY BASIC / HR", value: money(toNum(row.rate)) },
      { label: "TOTAL WORK HOURS", value: `${fmt(totalHours)} hrs` },
      {
        kind: "table",
        headers: ["Site Name", "Hours"],
        rows: effectiveBreakdown.map((s) => [s.site, `${fmt(s.hours)} hrs`]),
      },
    ],
    { label: "INCOME TOTAL", value: money(gross) },
  );

  drawCard(
    doc,
    "DEDUCTION",
    RED,
    left + cardWidth + gap,
    cardY,
    cardWidth,
    cardHeight,
    [
      { label: "TOTAL FOOD DEDUCT", value: money(food) },
      {
        kind: "table",
        headers: ["Site Name", "Amount"],
        rows: effectiveBreakdown.map((s) => [s.site, money(s.foodDeduction)]),
      },
      { label: "ADV DEDUCTION", value: money(advanceRecovered) },
      { label: "OTHER DEDUCT", value: money(other) },
    ],
    { label: "TOTAL DEDUCT", value: money(totalDeductions) },
  );

  drawCard(
    doc,
    "SUMMARY",
    BLUE,
    left + (cardWidth + gap) * 2,
    cardY,
    cardWidth,
    cardHeight,
    [
      { label: "TOTAL INCOME", value: money(gross) },
      { label: "TOTAL DEDUCT", value: money(totalDeductions) },
      { label: "NET SALARY", value: money(net), emphasis: true, highlight: true },
      {
        label: "OUTSTANDING",
        value: money(outstandingVal),
        outlineRed: outstandingVal > 1,
      },
    ],
    { label: "STATUS", value: status },
  );

  const detailsY = 184;
  doc.setFillColor(245, 247, 249);
  doc.roundedRect(left, detailsY, contentWidth, 24, 2, 2, "F");
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("PAYMENT DETAILS", left + 5, detailsY + 6.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED);
  const paymentDetail = (text: string, x: number, y: number, align: "left" | "right") => {
    const width = 80;
    fitFontSize(doc, text, width, 8.5, 6.25);
    doc.text(text, x, y, { align });
  };
  paymentDetail(`Paid this month: ${money(toNum(row.paid))}`, left + 5, detailsY + 13.5, "left");
  paymentDetail(
    `Remaining salary balance: ${money(balance)}`,
    left + contentWidth - 5,
    detailsY + 13.5,
    "right",
  );
  paymentDetail(
    `Advance brought forward: ${money(slip.carriedForward)}`,
    left + 5,
    detailsY + 19.5,
    "left",
  );
  paymentDetail(
    `New advance issued: ${money(toNum(row.new_advance))}`,
    left + contentWidth - 5,
    detailsY + 19.5,
    "right",
  );

  // In-memory verification QR code on lower right corner
  try {
    const qrPayload = JSON.stringify({
      emp_id: Number(slip.employee.id),
      period: slip.month,
      net_pay_omr: Number(net.toFixed(3)),
      advance_balance: Number(slip.outstandingAdvance.toFixed(3)),
    });
    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      margin: 1,
      width: 120,
      color: {
        dark: "#181d23",
        light: "#ffffff",
      },
    });

    const qrSize = 23;
    const qrX = left + contentWidth - qrSize;
    const qrY = 214;
    doc.addImage(qrDataUrl, "PNG", qrX, qrY, qrSize, qrSize);
    doc.setFontSize(5.5);
    doc.setTextColor(...MUTED);
    doc.text("SCAN TO VERIFY", qrX + qrSize / 2, qrY + qrSize + 2.5, { align: "center" });
  } catch (err) {
    console.warn("Could not render salary slip QR code:", err);
  }

  doc.setDrawColor(150, 156, 163);
  doc.setLineWidth(0.35);
  doc.line(left, 245, left + 56, 245);
  doc.line(left + 124, 245, left + contentWidth, 245);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text("Authorised Signature", left, 251);
  doc.text("Employee Signature", left + 124, 251);
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(
    "This salary slip is computer generated and does not require a company stamp.",
    pageWidth / 2,
    276,
    {
      align: "center",
    },
  );
}

export function sanitizeFilename(value: string) {
  const sanitized = value
    .replace(/[/\\:*?"<>|]/g, "-")
    .trim()
    .replace(/[. ]+$/g, "");
  return sanitized || "salary-slip";
}

function slipFilename(slip: SlipInput) {
  return `${sanitizeFilename(`${slip.employee.name} - ${slip.employee.trade}`)}.pdf`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function generateSalarySlipPDF(slip: SlipInput, headerImage?: HeaderImage) {
  const consolidated = consolidateSlips([slip])[0] || slip;
  const resolvedHeaderImage = headerImage ?? (await loadHeaderImage());
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  await drawSlip(doc, consolidated, resolvedHeaderImage);
  return doc.output("blob");
}

interface DownloadSlipsOptions {
  onProgress?: (completed: number, total: number) => void;
}

export async function downloadSlips(slips: SlipInput[], options: DownloadSlipsOptions = {}) {
  const consolidated = consolidateSlips(slips);
  if (!consolidated.length) return;
  const headerImage = await loadHeaderImage();

  if (consolidated.length === 1) {
    const slip = consolidated[0]!;
    const pdf = await generateSalarySlipPDF(slip, headerImage);
    downloadBlob(pdf, slipFilename(slip));
    return;
  }

  const zip = new JSZip();
  const filenames = new Set<string>();
  for (const [index, slip] of consolidated.entries()) {
    let filename = slipFilename(slip);
    const extension = ".pdf";
    const base = filename.slice(0, -extension.length);
    let duplicateNumber = 2;
    while (filenames.has(filename)) {
      filename = `${base} (${duplicateNumber})${extension}`;
      duplicateNumber += 1;
    }
    filenames.add(filename);

    try {
      const pdf = await generateSalarySlipPDF(slip, headerImage);
      zip.file(filename, pdf);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown PDF generation error.";
      throw new Error(`Unable to generate salary slip for ${slip.employee.name}: ${reason}`, {
        cause: error,
      });
    }
    options.onProgress?.(index + 1, consolidated.length);
  }

  const archive = await zip.generateAsync({ type: "blob" });
  downloadBlob(archive, `Salary Slips - ${sanitizeFilename(monthLabel(consolidated[0]!.month))}.zip`);
}
