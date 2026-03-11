import { GoogleGenAI } from "@google/genai";
import type { OCRItem, OCRResult, StructuredItem, ReceiptStructure } from "@/types/receipt";

// --- Gemini-based analysis (primary) ---

const ANALYSIS_PROMPT = `You are analyzing receipt OCR text to classify purchased items.

For each purchased item you find, return a JSON object with:
- "name": exact item name as it appears on the receipt
- "type": "A" if it has a quantity line (e.g. "2 st x 13,50", "3x9,90", "0.456 kg x 129,00"), "B" if it only shows a name and a total price
- "unitPrice": price per single unit (number)
- "currentQty": current quantity as a number (Type A only) — decimals allowed for weight/volume units
- "currentPrice": the line total for this item (number)
- "qtyUnit": the unit string e.g. "st", "kg", "l" (Type A only)

Rules:
- Ignore header/footer lines, totals, VAT rows, store info, payment info
- Only include actual purchased products
- For Type A: qty MUST be a real number, unitPrice × currentQty should equal currentPrice
- Decimal quantities are only valid for weight/volume units (kg, g, l, cl, ml) — discrete units (st, stk, pcs) must be whole integers
- Return ONLY a valid JSON array. No markdown, no explanation.

Receipt OCR text:
`;

const FLASH_INPUT_USD_PER_TOKEN = 0.15 / 1_000_000;
const FLASH_OUTPUT_USD_PER_TOKEN = 0.60 / 1_000_000;

function calcCost(meta: unknown): number {
  if (!meta || typeof meta !== "object") return 0;
  const m = meta as Record<string, unknown>;
  const input = Number(m.promptTokenCount ?? m.inputTokenCount ?? 0);
  const output = Number(m.candidatesTokenCount ?? m.outputTokenCount ?? 0);
  return input * FLASH_INPUT_USD_PER_TOKEN + output * FLASH_OUTPUT_USD_PER_TOKEN;
}

async function analyzeWithGemini(rawText: string, apiKey: string): Promise<{ items: StructuredItem[]; tokenCostUSD: number } | null> {
  if (!apiKey) return null;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: ANALYSIS_PROMPT + rawText }] }],
    });

    let text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    text = text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");

    const parsed = JSON.parse(text) as Array<{
      name: string;
      type: "A" | "B";
      unitPrice: number;
      currentQty?: number;
      currentPrice: number;
      qtyUnit?: string;
    }>;

    const items = parsed.map(item => ({
      name: item.name,
      type: item.type,
      unitPrice: item.unitPrice ?? 0,
      currentQty: item.currentQty,
      currentPrice: item.currentPrice ?? 0,
      qtyUnit: item.qtyUnit,
    }));

    return { items, tokenCostUSD: calcCost(response.usageMetadata) };
  } catch {
    return null;
  }
}

// --- Regex-based fallback (when Gemini fails) ---

const DISCRETE_UNITS = ["st", "stk", "pcs", "pc", "st."];

function parseQtyLine(text: string): { qty: number; unitPrice: number; unit: string; isDiscrete: boolean } | null {
  const match = text.match(
    /(\d+(?:[,.]\d+)?)\s*(st|stk|pcs?|kg|g|hg|l|liter|cl|ml)?\s*[x×*]\s*([\d,]+)/i
  );
  if (!match) return null;

  const unit = (match[2] ?? "st").toLowerCase();
  const isDiscrete = DISCRETE_UNITS.includes(unit);
  const rawQty = parseFloat(match[1].replace(",", "."));

  return {
    qty: isDiscrete ? Math.round(rawQty) : rawQty,
    unit,
    isDiscrete,
    unitPrice: parseFloat(match[3].replace(",", ".")),
  };
}

function findClosestByY(candidates: OCRItem[], refY: number, maxDelta: number): OCRItem | undefined {
  return candidates
    .filter(c => Math.abs(c.boundingBox.y - refY) < maxDelta)
    .sort((a, b) => Math.abs(a.boundingBox.y - refY) - Math.abs(b.boundingBox.y - refY))[0];
}

function analyzeWithRegex(ocrResult: OCRResult): StructuredItem[] {
  const nameItems  = ocrResult.items.filter(i => i.type === "item");
  const qtyItems   = ocrResult.items.filter(i => i.type === "quantity");
  const priceItems = ocrResult.items.filter(i => i.type === "price");

  return nameItems.map(nameItem => {
    const nameY = nameItem.boundingBox.y;

    let nearbyQty = qtyItems.find(q =>
      q.boundingBox.y > nameY - 0.01 && q.boundingBox.y - nameY < 0.06
    ) ?? qtyItems.find(q =>
      Math.abs(q.boundingBox.y - nameY) < 0.02
    );

    const inlineParsed = !nearbyQty ? parseQtyLine(nameItem.text) : null;

    if (nearbyQty || inlineParsed) {
      const parsed = nearbyQty ? parseQtyLine(nearbyQty.text) : inlineParsed;
      const linePrice = findClosestByY(priceItems, nearbyQty?.boundingBox.y ?? nameY, 0.025);
      const unit = parsed?.unit ?? "st";
      return {
        name: nameItem.text,
        type: "A" as const,
        unitPrice: parsed?.unitPrice ?? (linePrice?.value ?? 0),
        currentQty: parsed?.qty ?? 1,
        currentPrice: linePrice?.value ?? 0,
        qtyUnit: unit,
      };
    }

    const linePrice = findClosestByY(priceItems, nameY, 0.025);
    return {
      name: nameItem.text,
      type: "B" as const,
      unitPrice: linePrice?.value ?? 0,
      currentPrice: linePrice?.value ?? 0,
    };
  });
}

// --- Public entry point ---

export async function analyzeReceiptStructure(
  ocrResult: OCRResult,
  apiKey?: string
): Promise<{ structure: ReceiptStructure; tokenCostUSD: number }> {
  const key = apiKey ?? process.env.leguide_GEMINI_API_KEY ?? "";
  // Try Gemini first — it understands any receipt format
  const geminiResult = await analyzeWithGemini(ocrResult.rawText, key);
  if (geminiResult && geminiResult.items.length > 0) {
    return { structure: { items: geminiResult.items }, tokenCostUSD: geminiResult.tokenCostUSD };
  }

  // Fallback to regex if Gemini fails
  return { structure: { items: analyzeWithRegex(ocrResult) }, tokenCostUSD: 0 };
}
