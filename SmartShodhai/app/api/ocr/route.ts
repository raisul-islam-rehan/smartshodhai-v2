import { NextResponse } from "next/server";
import { requireAuthenticatedApiUser } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  isSafeText,
  sanitizeProductName,
  sanitizeText,
  sanitizeUnit,
} from "@/lib/validation";
import { MAX_IMAGE_BYTES } from "@/lib/upload";

type OcrRequestBody = {
  imageBase64?: string;
  mimeType?: string;
};

type ExtractedItem = {
  name: string;
  qty: number;
  unit?: string;
  price?: number;
};

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/heic", "image/heif"]);

// TODO: Rate-limit Gemini API calls per authenticated user in production (see lib/SECURITY-NOTES.md).

const OCR_PROMPT = `This is a photo of a handwritten inventory ledger (khata) from Bangladesh.
Extract all product entries you can see. For each entry identify:
- Product name (in Bengali or English)
- Quantity
- Unit (if visible)
- Price (if visible)
Return as JSON array: [{name, qty, unit, price}]
If you cannot read something clearly, skip it. Only return valid JSON.`;

function stripCodeFences(text: string) {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function isValidBase64Image(value: string): boolean {
  const normalized = value.replace(/\s/g, "");
  if (normalized.length < 100) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(normalized);
}

function estimateBase64DecodedBytes(base64: string): number {
  const normalized = base64.replace(/\s/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.floor((normalized.length * 3) / 4) - padding;
}

function parseExtractedItems(text: string): ExtractedItem[] | null {
  try {
    const parsed = JSON.parse(stripCodeFences(text));
    if (!Array.isArray(parsed)) return null;

    const cleaned = parsed
      .map((item) => {
        const name = sanitizeProductName(typeof item?.name === "string" ? item.name : "");
        const qtyRaw = Number(item?.qty);
        const unit =
          typeof item?.unit === "string"
            ? sanitizeUnit(item.unit)
            : undefined;
        const priceRaw =
          item?.price === null || item?.price === undefined ? undefined : Number(item.price);

        if (!name || !isSafeText(name) || Number.isNaN(qtyRaw) || qtyRaw <= 0) return null;
        if (unit && !isSafeText(unit)) return null;
        if (priceRaw !== undefined && (Number.isNaN(priceRaw) || priceRaw < 0)) return null;

        return {
          name,
          qty: qtyRaw,
          unit: unit || undefined,
          price: priceRaw,
        };
      })
      .filter(Boolean) as ExtractedItem[];

    return cleaned.length ? cleaned : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedApiUser();
    if (auth.unauthorized) return auth.unauthorized;

    const rateLimited = checkRateLimit(`ocr:${auth.user!.id}`, 5, 60_000);
    if (rateLimited) return rateLimited;

    // Image is forwarded to Gemini for OCR only — not stored server-side or in Supabase Storage.
    const body = (await request.json()) as OcrRequestBody;
    const imageBase64 = body.imageBase64?.trim();
    const mimeType = sanitizeText(body.mimeType?.trim() || "image/jpeg", 32);

    if (!imageBase64) {
      return NextResponse.json({ error: "Image is required." }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        { error: "Only JPEG, PNG, and HEIC images are allowed." },
        { status: 400 }
      );
    }

    if (!isValidBase64Image(imageBase64)) {
      return NextResponse.json(
        { error: "Invalid image data. Please upload a valid JPG, PNG, or HEIC photo." },
        { status: 400 }
      );
    }

    if (estimateBase64DecodedBytes(imageBase64) > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "Image exceeds the 5MB size limit. Please upload a smaller file." },
        { status: 400 }
      );
    }

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      return NextResponse.json(
        { error: "Gemini API is not configured. Please set GEMINI_API_KEY." },
        { status: 500 }
      );
    }

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: OCR_PROMPT },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: imageBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1200,
          },
        }),
      }
    );

    if (!geminiResponse.ok) {
      return NextResponse.json(
        { error: "Image unclear — try again with better lighting" },
        { status: 502 }
      );
    }

    const geminiJson = (await geminiResponse.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const rawText =
      geminiJson.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim() ?? "";

    const items = parseExtractedItems(rawText);
    if (!items) {
      return NextResponse.json({
        items: [],
        warning:
          "Could not parse extracted data from the image. Try again with better lighting.",
      });
    }

    return NextResponse.json({ items });
  } catch (error) {
    console.error("OCR route error:", error);
    return NextResponse.json(
      { error: "Image unclear — try again with better lighting" },
      { status: 500 }
    );
  }
}
