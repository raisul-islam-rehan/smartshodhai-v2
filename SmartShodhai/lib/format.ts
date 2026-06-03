const numberFormatter = new Intl.NumberFormat("en-IN");

export function formatNumberBD(value: number) {
  return numberFormatter.format(value);
}

export function formatCurrencyBDT(value: number, maximumFractionDigits = 2) {
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value);
  return `৳${formatted}`;
}
