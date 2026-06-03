/** Max lengths for user-supplied text fields before Supabase insert/update. */
export const TEXT_LIMITS = {
  productName: 200,
  customerName: 120,
  notes: 500,
  unit: 30,
  barcode: 64,
  category: 50,
  chatMessage: 2000,
} as const;

const UNSAFE_TEXT_PATTERN = /<script|javascript:|on\w+\s*=/i;

/** Trim, strip control chars, and cap length. */
export function sanitizeText(value: string, maxLength: number): string {
  return value
    .trim()
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .slice(0, maxLength);
}

export function sanitizeProductName(value: string): string {
  return sanitizeText(value, TEXT_LIMITS.productName).replace(/[<>]/g, "");
}

export function sanitizeCustomerName(value: string): string {
  return sanitizeText(value, TEXT_LIMITS.customerName).replace(/[<>]/g, "");
}

export function sanitizeNotes(value: string): string {
  return sanitizeText(value, TEXT_LIMITS.notes).replace(/[<>]/g, "");
}

export function sanitizeUnit(value: string): string {
  return sanitizeText(value, TEXT_LIMITS.unit).replace(/[<>]/g, "");
}

export function sanitizeBarcode(value: string): string {
  return sanitizeText(value, TEXT_LIMITS.barcode).replace(/[^a-zA-Z0-9\-_]/g, "");
}

export function sanitizeCategory(value: string): string {
  return sanitizeText(value, TEXT_LIMITS.category).replace(/[<>]/g, "");
}

export function isSafeText(value: string): boolean {
  return !UNSAFE_TEXT_PATTERN.test(value);
}
