function addMonths(date, months) {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== day) d.setDate(0);
  return d;
}

function formatDateISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function generateInstallments({ annualAmount, count, firstDueDate }) {
  const total = Number(annualAmount);
  const n = Number(count);

  const base = Math.floor(total / n);
  const rem = total - base * n;

  const start = new Date(firstDueDate);
  const items = [];

  for (let i = 0; i < n; i++) {
    const amount = base + (i < rem ? 1 : 0);
    const due = addMonths(start, i);
    items.push({
      installmentNo: i + 1,
      dueDate: formatDateISO(due),
      amount,
      paidAmount: 0,
      status: "unpaid",
    });
  }
  return items;
}

export function computeInstallmentStatus(amount, paidAmount) {
  const a = Number(amount);
  const p = Number(paidAmount);
  if (p <= 0) return "unpaid";
  if (p >= a) return "paid";
  return "partial";
}