/** Client/server shared limits for OCR ledger uploads. Images are not persisted server-side. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
] as const;

export function validateImageUpload(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return "Please upload JPG, PNG, or HEIC image.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "Image exceeds the 5MB size limit. Please upload a smaller file.";
  }
  return null;
}
