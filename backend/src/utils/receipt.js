// backend/src/utils/receipt.js
export function genReceiptNumber() {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  const r = Math.floor(Math.random() * 9000) + 1000;
  return `RC-${y}${m}${d}-${r}`;
}