import { buildOCRSystemPrompt } from "@/lib/prompt-engine";
import type { OCRItemType } from "@/types/receipt";
import type { DocType, InvoiceFieldType } from "@/lib/document-types";

const DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
// Initial OCR also classifies kvitto vs faktura → needs general VL reasoning.
const DEFAULT_OCR_MODEL = "qwen3-vl-plus";
// Verify pass is pure text fidelity → specialist OCR model (qwen-vl-ocr) beats general VL.
const DEFAULT_VERIFY_MODEL = "qwen-vl-ocr-latest";

export type ItemTypeAny = OCRItemType | InvoiceFieldType;

const VALID_TYPES: ReadonlySet<string> = new Set<string>([
  "item", "price", "total", "vat", "date", "org", "quantity", "unknown",
  "invoice_number", "invoice_date", "due_date", "payment_reference",
  "customer_name", "customer_org_nr", "customer_address",
  "seller_name", "seller_org_nr", "seller_bankgiro", "seller_plusgiro",
  "line_description", "line_unit_price", "line_quantity", "line_total",
]);

const CLASSIFICATION_APPENDIX = `

## Document classification

In addition to extracting text, classify the document as either "kvitto" (Swedish receipt) or "faktura" (Swedish invoice).

Faktura signals:
- Heading "Faktura", "Invoice" or "Räkning"
- Explicit invoice number (Fakturanr / Invoice No)
- Due date (Förfallodatum / Due date)
- Customer block (kund-uppgifter, addressed to a specific recipient)
- Payment reference (OCR-nr, KID, betalreferens)
- Bank/plusgiro paid info

Kvitto signals:
- Store name at the top of the document
- Single point-of-sale transaction with timestamp
- No invoice number, no due date, no customer block
- Card terminal info (AID, transaktions-id)

Tag every extracted text item with one of these "type" values:
- Receipt types: "item", "price", "total", "vat", "date", "org", "quantity", "unknown"
- Invoice types: "invoice_number", "invoice_date", "due_date", "payment_reference",
  "customer_name", "customer_org_nr", "customer_address",
  "seller_name", "seller_org_nr", "seller_bankgiro", "seller_plusgiro",
  "line_description", "line_unit_price", "line_quantity", "line_total"

Output JSON shape (object, NOT bare array):

{
  "docType": "kvitto" | "faktura",
  "classifierConfidence": 0.0-1.0,
  "items": [
    { "text": "...", "type": "...", "confidence": 0.0-1.0,
      "boundingBox": { "x": 0-1, "y": 0-1, "width": 0-1, "height": 0-1 },
      "value": <optional number for prices/totals> }
  ]
}

Example (kvitto):
{ "docType": "kvitto", "classifierConfidence": 0.95, "items": [
  { "text": "ICA Maxi Stockholm", "type": "org", "confidence": 0.98, "boundingBox": {"x":0.1,"y":0.02,"width":0.8,"height":0.04} },
  { "text": "Mjölk 1L", "type": "item", "confidence": 0.97, "boundingBox": {"x":0.05,"y":0.3,"width":0.4,"height":0.03} },
  { "text": "14,90", "type": "price", "value": 14.90, "confidence": 0.96, "boundingBox": {"x":0.7,"y":0.3,"width":0.2,"height":0.03} },
  { "text": "TOTAL 247,50", "type": "total", "value": 247.50, "confidence": 0.99, "boundingBox": {"x":0.05,"y":0.85,"width":0.9,"height":0.04} }
]}

Example (faktura):
{ "docType": "faktura", "classifierConfidence": 0.97, "items": [
  { "text": "Faktura 2026-0042", "type": "invoice_number", "confidence": 0.99, "boundingBox": {"x":0.1,"y":0.05,"width":0.4,"height":0.03} },
  { "text": "Förfallodatum 2026-06-15", "type": "due_date", "confidence": 0.98, "boundingBox": {"x":0.1,"y":0.15,"width":0.4,"height":0.03} },
  { "text": "Acme AB", "type": "customer_name", "confidence": 0.95, "boundingBox": {"x":0.1,"y":0.2,"width":0.4,"height":0.03} },
  { "text": "Konsultarvode november", "type": "line_description", "confidence": 0.96, "boundingBox": {"x":0.1,"y":0.4,"width":0.5,"height":0.03} },
  { "text": "12 500,00", "type": "line_total", "value": 12500.00, "confidence": 0.97, "boundingBox": {"x":0.7,"y":0.4,"width":0.2,"height":0.03} }
]}

Return ONLY the JSON object, no markdown fences, no commentary.`;

export interface OCRResponseItem {
  text: string;
  type: ItemTypeAny;
  confidence: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  value?: number;
}

export interface OCRResponse {
  docType: DocType;
  classifierConfidence: number;
  items: OCRResponseItem[];
  rawText: string;
  usage: { inputTokens: number; outputTokens: number };
}

export class QwenVLError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string, message?: string) {
    super(message ?? `Qwen VL request failed (${status})`);
    this.name = "QwenVLError";
    this.status = status;
    this.body = body;
  }
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface RawItem {
  text?: unknown;
  type?: unknown;
  confidence?: unknown;
  boundingBox?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
  value?: unknown;
}

interface RawResponse {
  docType?: unknown;
  classifierConfidence?: unknown;
  items?: unknown;
  results?: unknown;
  data?: unknown;
  ocr?: unknown;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeType(value: unknown): ItemTypeAny {
  if (typeof value === "string" && VALID_TYPES.has(value)) {
    return value as ItemTypeAny;
  }
  return "unknown";
}

function stripFences(text: string): string {
  let s = text.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  return s.trim();
}

function extractItemsArray(parsed: unknown): RawItem[] {
  if (Array.isArray(parsed)) return parsed as RawItem[];
  if (parsed && typeof parsed === "object") {
    const obj = parsed as RawResponse;
    for (const candidate of [obj.items, obj.results, obj.data, obj.ocr]) {
      if (Array.isArray(candidate)) return candidate as RawItem[];
    }
  }
  throw new QwenVLError(502, JSON.stringify(parsed).slice(0, 500), "Qwen VL returned non-array OCR payload");
}

function extractDocType(parsed: unknown): { docType: DocType; classifierConfidence: number } {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as RawResponse;
    const dt = obj.docType;
    const conf = obj.classifierConfidence;
    if (dt === "kvitto" || dt === "faktura") {
      const c = typeof conf === "number" && Number.isFinite(conf) ? clamp01(conf) : 0.5;
      return { docType: dt, classifierConfidence: c };
    }
  }
  return { docType: "kvitto", classifierConfidence: 0.3 };
}

function normalizeItem(raw: RawItem): OCRResponseItem {
  const bb = raw.boundingBox ?? {};
  const item: OCRResponseItem = {
    text: typeof raw.text === "string" ? raw.text : "",
    type: normalizeType(raw.type),
    confidence: clamp01(toNumber(raw.confidence, 0.5)),
    boundingBox: {
      x: clamp01(toNumber(bb.x, 0)),
      y: clamp01(toNumber(bb.y, 0)),
      width: clamp01(toNumber(bb.width, 0.1)),
      height: clamp01(toNumber(bb.height, 0.03)),
    },
  };
  if (raw.value !== undefined && raw.value !== null) {
    const v = toNumber(raw.value, NaN);
    if (Number.isFinite(v)) item.value = v;
  }
  return item;
}

async function callQwenVL(model: string, imageBase64: string): Promise<OCRResponse> {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) throw new QwenVLError(500, "", "QWEN_API_KEY is not set");

  const baseUrl = (process.env.QWEN_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const url = `${baseUrl}/chat/completions`;

  const fullPrompt = buildOCRSystemPrompt() + CLASSIFICATION_APPENDIX;

  const body = {
    model,
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
          { type: "text", text: fullPrompt },
          { type: "text", text: "Extract all text and classify the document. Return ONLY the JSON object described above." },
        ],
      },
    ],
    response_format: { type: "json_object" as const },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new QwenVLError(res.status, errBody);
  }

  const data = (await res.json()) as ChatCompletionResponse;
  const rawText = data.choices?.[0]?.message?.content ?? "";
  const cleaned = stripFences(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new QwenVLError(502, cleaned.slice(0, 500), "Qwen VL returned invalid JSON");
  }

  const { docType, classifierConfidence } = extractDocType(parsed);
  const rawItems = extractItemsArray(parsed);
  const items = rawItems.map(normalizeItem);

  return {
    docType,
    classifierConfidence,
    items,
    rawText,
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

export async function ocrReceipt(
  imageBase64: string,
  opts: { model?: string } = {},
): Promise<OCRResponse> {
  const model = opts.model ?? process.env.QWEN_VL_MODEL ?? DEFAULT_OCR_MODEL;
  return callQwenVL(model, imageBase64);
}

export async function reOcrReceipt(
  imageBase64: string,
  opts: { model?: string } = {},
): Promise<OCRResponse> {
  const model = opts.model ?? process.env.QWEN_VL_VERIFY_MODEL ?? DEFAULT_VERIFY_MODEL;
  return callQwenVL(model, imageBase64);
}
