import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.resolve(__dirname, "../../../uploads");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat("ar-YE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-YE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function mimeFromFileName(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

export async function resolveSchoolLogoDataUrl(logoUrl) {
  const raw = String(logoUrl || "").trim();
  if (!raw) return "";

  if (/^data:image\//i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;

  const fileName = path.basename(raw.replace(/^.*\/uploads\//i, ""));
  if (!fileName) return "";

  const absolutePath = path.resolve(uploadsDir, fileName);
  if (!absolutePath.startsWith(`${uploadsDir}${path.sep}`)) return "";

  try {
    const buffer = await fs.readFile(absolutePath);
    return `data:${mimeFromFileName(fileName)};base64,${buffer.toString("base64")}`;
  } catch {
    return "";
  }
}

function renderLogo(school) {
  if (school.logoDataUrl) {
    return `<img class="report-logo" src="${escapeHtml(school.logoDataUrl)}" alt="شعار المدرسة" />`;
  }

  const firstLetter = String(school.nameAr || "م").trim().charAt(0) || "م";
  return `<div class="report-logo report-logo--fallback">${escapeHtml(firstLetter)}</div>`;
}

function renderMetaPills(metaItems) {
  const safeItems = (metaItems || []).filter((item) => item?.value);
  if (!safeItems.length) return "";

  return `
    <div class="report-meta-pills">
      ${safeItems
        .map(
          (item) => `
            <div class="report-pill">
              <span>${escapeHtml(item.label)}</span>
              <b>${escapeHtml(item.value)}</b>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderTable(columns, rows) {
  const header = columns
    .map((column) => `<th>${escapeHtml(column.label)}</th>`)
    .join("");

  const body = rows
    .map((row, index) => {
      const cells = columns
        .map((column) => {
          const value = column.formatter
            ? column.formatter(row[column.key], row)
            : row[column.key];
          return `<td>${escapeHtml(value ?? "—")}</td>`;
        })
        .join("");

      return `<tr><td class="report-seq">${index + 1}</td>${cells}</tr>`;
    })
    .join("");

  return `
    <table class="report-table">
      <thead>
        <tr><th class="report-seq">م</th>${header}</tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

export function renderSchoolReportHtml({
  school,
  academicYear,
  title,
  subtitle = "",
  columns,
  rows,
  metaItems = [],
  statusesLabel = "",
  issuedAt = new Date(),
  autoPrint = false,
}) {
  const denseClass = columns.length >= 9 ? "report--dense" : columns.length >= 6 ? "report--compact" : "";
  const safeSchoolName = school.nameAr || school.nameEn || "المدرسة";
  const yearName = academicYear?.name || "—";

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; color: #111827; background: #fff; }
    body { font-family: Tahoma, Arial, sans-serif; direction: rtl; }
    .report-page { width: 100%; padding: 0; }
    .report-head { display: grid; grid-template-columns: 100px 1fr 100px; align-items: center; gap: 14px; padding-bottom: 14px; border-bottom: 2px solid #1d4ed8; }
    .report-logo { width: 82px; height: 82px; object-fit: contain; border-radius: 14px; border: 1px solid #dbeafe; padding: 6px; background: #fff; }
    .report-logo--fallback { display: grid; place-items: center; color: #1d4ed8; background: #eff6ff; font-size: 34px; font-weight: 800; }
    .report-school { text-align: center; }
    .report-school h1 { margin: 0; font-size: 22px; color: #0f172a; }
    .report-school .report-school-en { margin-top: 4px; color: #64748b; font-size: 11px; }
    .report-school .report-contact { margin-top: 6px; color: #475569; font-size: 10px; line-height: 1.7; }
    .report-stamp-space { width: 82px; height: 82px; }
    .report-title { text-align: center; padding: 14px 0 4px; }
    .report-title h2 { margin: 0; font-size: 19px; color: #111827; }
    .report-title .report-year { margin-top: 7px; font-size: 13px; font-weight: 700; color: #1e3a8a; }
    .report-title .report-subtitle, .report-title .report-statuses { margin-top: 5px; font-size: 11px; color: #475569; }
    .report-meta-pills { display: flex; flex-wrap: wrap; justify-content: center; gap: 7px; margin: 11px 0 13px; }
    .report-pill { display: flex; gap: 5px; align-items: center; border: 1px solid #dbeafe; border-radius: 999px; padding: 5px 9px; background: #f8fbff; color: #475569; font-size: 10px; }
    .report-pill b { color: #0f172a; }
    .report-table { width: 100%; border-collapse: collapse; table-layout: auto; }
    .report-table th, .report-table td { border: 1px solid #cbd5e1; padding: 7px 6px; text-align: right; vertical-align: middle; font-size: 10px; line-height: 1.5; word-break: break-word; }
    .report-table th { color: #0f172a; background: #eff6ff; font-weight: 800; }
    .report-table tbody tr:nth-child(even) { background: #f8fafc; }
    .report-seq { width: 34px; text-align: center !important; }
    .report--compact .report-table th, .report--compact .report-table td { padding: 6px 4px; font-size: 9px; }
    .report--dense .report-table th, .report--dense .report-table td { padding: 5px 3px; font-size: 8px; }
    .report-signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; margin-top: 28px; padding: 0 24px; }
    .report-signature { text-align: center; color: #334155; font-size: 12px; font-weight: 700; }
    .report-signature-line { display: block; margin-top: 28px; border-top: 1px dashed #64748b; }
    .report-foot-note { margin-top: 18px; padding-top: 8px; border-top: 1px solid #e2e8f0; color: #64748b; text-align: center; font-size: 9px; }
    @page { size: A4 landscape; margin: 12mm 10mm 14mm; }
    @media print { .report-page { break-after: auto; } thead { display: table-header-group; } tr { break-inside: avoid; } }
  </style>
</head>
<body>
  <main class="report-page ${denseClass}">
    <header class="report-head">
      <div>${renderLogo(school)}</div>
      <div class="report-school">
        <h1>${escapeHtml(safeSchoolName)}</h1>
        ${school.nameEn ? `<div class="report-school-en">${escapeHtml(school.nameEn)}</div>` : ""}
        <div class="report-contact">
          ${[school.address, school.phone, school.email].filter(Boolean).map(escapeHtml).join(" • ")}
        </div>
      </div>
      <div class="report-stamp-space"></div>
    </header>

    <section class="report-title">
      <h2>${escapeHtml(title)}</h2>
      <div class="report-year">العام الدراسي: ${escapeHtml(yearName)}</div>
      ${subtitle ? `<div class="report-subtitle">${escapeHtml(subtitle)}</div>` : ""}
      ${statusesLabel ? `<div class="report-statuses">${escapeHtml(statusesLabel)}</div>` : ""}
    </section>

    ${renderMetaPills([
      { label: "عدد الطلاب", value: `${rows.length} طالبًا` },
      { label: "تاريخ إصدار الكشف", value: formatDateTime(issuedAt) },
      ...metaItems,
    ])}

    ${renderTable(columns, rows)}

    <section class="report-signatures">
      <div class="report-signature">توقيع مسؤول المدرسة<span class="report-signature-line"></span></div>
      <div class="report-signature">ختم المدرسة<span class="report-signature-line"></span></div>
    </section>

    <footer class="report-foot-note">كشف مدرسي رسمي صادر من ${escapeHtml(safeSchoolName)}</footer>
  </main>
  ${
    autoPrint
      ? `<script>window.addEventListener("load", () => { setTimeout(() => window.print(), 250); });</script>`
      : ""
  }
</body>
</html>`;
}

export async function htmlToPdfBuffer(html, { landscape = true } = {}) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.emulateMediaType("print");

    const pdf = await page.pdf({
      format: "A4",
      landscape,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<div></div>`,
      footerTemplate: `
        <div style="width:100%;font-size:8px;color:#64748b;padding:0 10mm;display:flex;justify-content:space-between;direction:rtl;font-family:Tahoma,Arial,sans-serif;">
          <span>كشف مدرسي رسمي</span>
          <span>الصفحة <span class="pageNumber"></span> من <span class="totalPages"></span></span>
        </div>
      `,
      margin: { top: "12mm", right: "10mm", bottom: "17mm", left: "10mm" },
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

export function reportDateOnly(value) {
  return formatDate(value);
}

export function safeFilePart(value) {
  return String(value || "report")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 90) || "report";
}
