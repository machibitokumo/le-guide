import type { OCRItem, OCRResult, LedgerResult, VATBreakdown, VATRate } from "@/types/receipt";
import {
  type EditPlan,
  type EditOperation,
  type EditTarget,
  type DocType,
  FAKTURA_PROTECTED_FIELDS,
  KVITTO_EDITABLE_FIELDS,
  FAKTURA_EDITABLE_FIELDS,
} from "@/lib/document-types";

const DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const DEFAULT_MODEL = "qwen3-max";

const PROTECTED_FIELD_SET: ReadonlySet<string> = new Set(FAKTURA_PROTECTED_FIELDS);
const KVITTO_FIELD_SET: ReadonlySet<string> = new Set(KVITTO_EDITABLE_FIELDS);
const FAKTURA_FIELD_SET: ReadonlySet<string> = new Set(FAKTURA_EDITABLE_FIELDS);

const VALID_OPS: ReadonlySet<EditOperation["op"]> = new Set([
  "MODIFY_ITEM", "MULTIPLY_QTY", "ADD_ITEM", "DELETE_ITEM", "SET_FIELD",
]);

function isAllowedSetFieldFor(docType: DocType, field: string): boolean {
  if (PROTECTED_FIELD_SET.has(field)) return false;
  return docType === "faktura" ? FAKTURA_FIELD_SET.has(field) : KVITTO_FIELD_SET.has(field);
}

const SYSTEM_PROMPT = `You are an edit planner for a Swedish kvitto (receipt) or faktura (invoice). You receive OCR items and a target. Return a minimal-change plan to reach that target.

Operation vocabulary (use exactly these "op" values):
- "MODIFY_ITEM"  { id, field: "price"|"qty"|"name", newValue }   change a property of an existing line
- "MULTIPLY_QTY" { id, factor }                                   multiply quantity by a factor (preferred over MODIFY_ITEM when only changing qty)
- "ADD_ITEM"     { name, qty, unitPrice, vatRate: 6|12|25 }       add a new line
- "DELETE_ITEM"  { id }                                           remove a line
- "SET_FIELD"    { field, newValue }                              set a top-level field (date, time, total, or any invoice field)

Operation priority: prefer MODIFY_ITEM (price tweak) → MULTIPLY_QTY → ADD_ITEM → DELETE_ITEM. Pick the SMALLEST visible change.

Swedish VAT rates:
- 25 %: alcohol, non-food goods, most services (default)
- 12 %: food, non-alcoholic drinks, restaurants, hotels
- 6 %:  books, newspapers, magazines, public transport, cultural events

VAT rules:
1. Mixed-rate receipts: keep the original rate mix proportionally unless item composition changed.
2. Compute net = gross / (1 + rate/100), vat = gross - net. Round to öre (2 decimals).
3. Sum of gross across rates must equal target total exactly. Assign rounding remainder to the largest-rate bucket.

Doc-type rules:
- "kvitto": editable top-level fields are total, date, time. Item ops are free.
- "faktura": editable top-level fields are total, invoice_number, invoice_date, due_date, payment_reference, customer_name, customer_org_nr, customer_address. NEVER emit operations that touch seller_name, seller_org_nr, seller_bankgiro, or seller_plusgiro. Invoice line rows are 4-tuples (line_description, line_unit_price, line_quantity, line_total) — when adjusting an invoice line, emit MODIFY_ITEM ops for ALL FOUR (or for the relevant tuple) so they stay arithmetically consistent (line_total = quantity × unit_price).

Output STRICT JSON only, no prose, no markdown fences:
{
  "docType": "kvitto" | "faktura",
  "operations": [{ "op": "...", ... }],
  "vatBreakdown": [{ "rate": 25|12|6, "net": number, "vat": number, "gross": number }],
  "warnings": [string]
}

Example 1 (kvitto, raise total):
Input: items show milk 14.90, bread 32.50, total 47.40 (12 % VAT). Target: 95.00.
Output:
{ "docType":"kvitto",
  "operations":[ {"op":"MODIFY_ITEM","id":"<bread-id>","field":"price","newValue":80.10} ],
  "vatBreakdown":[ {"rate":12,"net":84.82,"vat":10.18,"gross":95.00} ],
  "warnings":["Adjusted bread price to reach target"] }

Example 2 (faktura, lower total + change due date + change customer):
Input: line "Konsultarvode november" total 15625 incl. 25 % VAT. Target: total 12500, due_date 2026-06-15, customer_name "Acme AB".
Output:
{ "docType":"faktura",
  "operations":[
    {"op":"MODIFY_ITEM","id":"<line-id>","field":"price","newValue":10000.00},
    {"op":"SET_FIELD","field":"due_date","newValue":"2026-06-15"},
    {"op":"SET_FIELD","field":"customer_name","newValue":"Acme AB"}
  ],
  "vatBreakdown":[ {"rate":25,"net":10000.00,"vat":2500.00,"gross":12500.00} ],
  "warnings":["Lowered line price to reach target; downstream line_total/line_unit_price/line_quantity must be updated by the image editor to keep the 4-tuple consistent"] }`;

export class QwenReasonError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "QwenReasonError";
    if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

interface CompactItem {
  id: string;
  text: string;
  type: string;
  value?: number;
}

function compactItems(items: OCRItem[]): CompactItem[] {
  return items.map(i => {
    const c: CompactItem = { id: i.id, text: i.text, type: i.type };
    if (typeof i.value === "number") c.value = i.value;
    return c;
  });
}

function isVATRate(n: unknown): n is VATRate {
  return n === 25 || n === 12 || n === 6;
}

function asNumber(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new QwenReasonError(`Invalid number for ${field}`);
  }
  return v;
}

function parseBreakdown(raw: unknown): VATBreakdown[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new QwenReasonError("Model returned no vatBreakdown");
  }
  return raw.map((entry, idx) => {
    if (typeof entry !== "object" || entry === null) {
      throw new QwenReasonError(`vatBreakdown[${idx}] is not an object`);
    }
    const e = entry as Record<string, unknown>;
    if (!isVATRate(e.rate)) {
      throw new QwenReasonError(`vatBreakdown[${idx}].rate must be 25|12|6`);
    }
    return {
      rate: e.rate,
      net: asNumber(e.net, `vatBreakdown[${idx}].net`),
      vat: asNumber(e.vat, `vatBreakdown[${idx}].vat`),
      gross: asNumber(e.gross, `vatBreakdown[${idx}].gross`),
    };
  });
}

function parseOperation(raw: unknown, idx: number, warnings: string[], docType: DocType): EditOperation | null {
  if (typeof raw !== "object" || raw === null) {
    warnings.push(`Dropped operation[${idx}]: not an object`);
    return null;
  }
  const r = raw as Record<string, unknown>;
  const op = r.op;
  if (typeof op !== "string" || !VALID_OPS.has(op as EditOperation["op"])) {
    warnings.push(`Dropped operation[${idx}]: unknown op '${String(op)}'`);
    return null;
  }
  switch (op) {
    case "MODIFY_ITEM": {
      const field = r.field;
      if (field !== "price" && field !== "qty" && field !== "name") {
        warnings.push(`Dropped MODIFY_ITEM[${idx}]: invalid field '${String(field)}'`);
        return null;
      }
      const id = typeof r.id === "string" ? r.id : "";
      const newValue = r.newValue;
      if (!id || (typeof newValue !== "string" && typeof newValue !== "number")) {
        warnings.push(`Dropped MODIFY_ITEM[${idx}]: missing id or newValue`);
        return null;
      }
      return { op, id, field, newValue };
    }
    case "MULTIPLY_QTY": {
      const id = typeof r.id === "string" ? r.id : "";
      const factor = typeof r.factor === "number" ? r.factor : NaN;
      if (!id || !Number.isFinite(factor)) {
        warnings.push(`Dropped MULTIPLY_QTY[${idx}]: missing id or factor`);
        return null;
      }
      return { op, id, factor };
    }
    case "ADD_ITEM": {
      const name = typeof r.name === "string" ? r.name : "";
      const qty = typeof r.qty === "number" ? r.qty : NaN;
      const unitPrice = typeof r.unitPrice === "number" ? r.unitPrice : NaN;
      const vatRate = r.vatRate;
      if (!name || !Number.isFinite(qty) || !Number.isFinite(unitPrice) || !isVATRate(vatRate)) {
        warnings.push(`Dropped ADD_ITEM[${idx}]: invalid fields`);
        return null;
      }
      return { op, name, qty, unitPrice, vatRate };
    }
    case "DELETE_ITEM": {
      const id = typeof r.id === "string" ? r.id : "";
      if (!id) {
        warnings.push(`Dropped DELETE_ITEM[${idx}]: missing id`);
        return null;
      }
      return { op, id };
    }
    case "SET_FIELD": {
      const field = typeof r.field === "string" ? r.field : "";
      const newValue = typeof r.newValue === "string" ? r.newValue : "";
      if (!field || !newValue) {
        warnings.push(`Dropped SET_FIELD[${idx}]: missing field or newValue`);
        return null;
      }
      if (!isAllowedSetFieldFor(docType, field)) {
        warnings.push(`Dropped SET_FIELD[${idx}]: '${field}' is not editable for docType '${docType}'`);
        return null;
      }
      return { op: "SET_FIELD", field: field as Extract<EditOperation, { op: "SET_FIELD" }>["field"], newValue };
    }
    default:
      return null;
  }
}

function sanitizeFakturaOps(
  ops: EditOperation[],
  ocrResult: OCRResult,
  warnings: string[],
): EditOperation[] {
  const protectedItemIds = new Set(
    ocrResult.items.filter(i => PROTECTED_FIELD_SET.has(i.type)).map(i => i.id),
  );
  return ops.filter(op => {
    if (op.op === "SET_FIELD" && PROTECTED_FIELD_SET.has(op.field)) {
      warnings.push(`Removed SET_FIELD on protected seller field '${op.field}'`);
      return false;
    }
    if ((op.op === "MODIFY_ITEM" || op.op === "DELETE_ITEM" || op.op === "MULTIPLY_QTY")
        && protectedItemIds.has(op.id)) {
      warnings.push(`Removed ${op.op} on protected seller item id '${op.id}'`);
      return false;
    }
    return true;
  });
}

function callQwen(target: EditTarget, ocrResult: OCRResult, opts?: { model?: string }): Promise<unknown> {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) throw new QwenReasonError("QWEN_API_KEY not set");
  const baseUrl = (process.env.QWEN_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = opts?.model ?? process.env.QWEN_REASON_MODEL ?? DEFAULT_MODEL;

  const userMessage = [
    `Document type: ${target.docType}`,
    `Items:\n${JSON.stringify(compactItems(ocrResult.items))}`,
    `Target:\n${JSON.stringify(target)}`,
  ].join("\n\n");

  return fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    }),
  }).then(async response => {
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new QwenReasonError(`Qwen HTTP ${response.status}: ${body.slice(0, 500)}`);
    }
    return response.json();
  }).catch(cause => {
    if (cause instanceof QwenReasonError) throw cause;
    throw new QwenReasonError("Network error calling Qwen", { cause });
  });
}

function extractContent(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    throw new QwenReasonError("Qwen response missing body");
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new QwenReasonError("Qwen response missing choices");
  }
  const message = (choices[0] as { message?: unknown }).message;
  const content = (message as { content?: unknown } | undefined)?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new QwenReasonError("Qwen response content is empty");
  }
  return content;
}

export async function planEdits(
  ocrResult: OCRResult,
  target: EditTarget,
  opts?: { model?: string },
): Promise<EditPlan> {
  const payload = await callQwen(target, ocrResult, opts);
  const content = extractContent(payload);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (cause) {
    throw new QwenReasonError("Qwen content was not valid JSON", { cause });
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new QwenReasonError("Qwen output is not an object");
  }
  const obj = parsed as Record<string, unknown>;

  if (obj.docType !== target.docType) {
    throw new QwenReasonError(`Plan docType '${String(obj.docType)}' does not match target '${target.docType}'`);
  }

  const warnings: string[] = Array.isArray(obj.warnings)
    ? obj.warnings.filter((w): w is string => typeof w === "string")
    : [];

  const rawOps = Array.isArray(obj.operations) ? obj.operations : [];
  let operations = rawOps
    .map((raw, idx) => parseOperation(raw, idx, warnings, target.docType))
    .filter((op): op is EditOperation => op !== null);

  if (target.docType === "faktura") {
    operations = sanitizeFakturaOps(operations, ocrResult, warnings);
  }

  const vatBreakdown = parseBreakdown(obj.vatBreakdown);

  return { docType: target.docType, operations, vatBreakdown, warnings };
}

function formatSEK(value: number): string {
  return value.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * @deprecated Use `planEdits` with a `KvittoTarget`. This wrapper is kept so the
 * edit-image route's silent-ledger fallback path keeps working unchanged.
 */
export async function recalculateVAT(
  ocrResult: OCRResult,
  targetTotal: number,
  opts?: { model?: string },
): Promise<LedgerResult> {
  const plan = await planEdits(
    ocrResult,
    { docType: "kvitto", total: targetTotal, date: new Date().toISOString().slice(0, 10) },
    opts,
  );
  return {
    adjustedItems: ocrResult.items,
    newTotal: targetTotal,
    vatBreakdown: plan.vatBreakdown,
    warnings: [`Total set to ${formatSEK(targetTotal)} SEK`, ...plan.warnings],
  };
}
