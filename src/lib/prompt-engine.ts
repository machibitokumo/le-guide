import type { OCRItem, OCRResult, ReceiptStructure } from "@/types/receipt";
import {
  FAKTURA_PROTECTED_FIELDS,
  isFakturaTarget,
  type EditOperation,
  type EditPlan,
  type EditTarget,
  type FakturaTarget,
} from "@/lib/document-types";


function buildItemMap(structure: ReceiptStructure, goingDown: boolean): string {
  if (!structure?.items?.length) return "";

  const verb = goingDown ? "DECREASE" : "INCREASE";
  const lines = structure.items.map(item => {
    if (item.type === "A") {
      const newQtyHint = goingDown
        ? `reduce N below ${item.currentQty} (minimum 1)`
        : `raise N above ${item.currentQty}`;
      return `- ${item.name}: [HAS-QTY-LINE] Currently ${item.currentQty} ${item.qtyUnit ?? "st"} × ${item.unitPrice.toFixed(2)} = ${item.currentPrice.toFixed(2)}. EDIT: ${newQtyHint}. N must be a whole integer. Update the line total to N × ${item.unitPrice.toFixed(2)}. Do NOT duplicate the item name. Do NOT add any letter or label next to the item name.`;
    }
    const hint = goingDown
      ? `lower the price below ${item.currentPrice.toFixed(2)}`
      : `raise the price above ${item.currentPrice.toFixed(2)}`;
    return `- ${item.name}: [PRICE-ONLY] Current price: ${item.currentPrice.toFixed(2)}. EDIT: ${hint}. Change only the price value in place. Do NOT add a quantity sub-line. Do NOT add any letter or label next to the item name.`;
  });

  return `\nITEM MAP (derived from OCR — use this as your editing guide):\n${lines.join("\n")}`;
}

export function buildEditPrompt(opts: {
  targetTotal: number;
  date: string;
  time?: string;
  originalTotal?: number;
  receiptStructure?: ReceiptStructure;
}): string {
  const targetStr = opts.targetTotal.toFixed(2);
  const goingDown = opts.originalTotal !== undefined ? opts.targetTotal < opts.originalTotal : false;
  const direction = goingDown ? "LOWER" : "HIGHER";
  const directionRule = goingDown
    ? "Every item change MUST reduce a line total — do NOT raise any individual price or quantity."
    : "Every item change MUST increase a line total — do NOT lower any individual price or quantity.";
  const itemMap = opts.receiptStructure ? buildItemMap(opts.receiptStructure, goingDown) : "";

  // Use provided time or fall back to random plausible shopping time (09:00–20:59)
  const s = Math.floor(Math.random() * 60);
  const resolvedTime = opts.time
    ? `${opts.time}:${String(s).padStart(2, "0")}`
    : (() => {
        const h = 9 + Math.floor(Math.random() * 12);
        const m = Math.floor(Math.random() * 60);
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      })();
  const datetime = `${opts.date} ${resolvedTime}`;

  return `You are a receipt image editor performing SURGICAL TEXT EDITS ONLY.

ABSOLUTE OUTPUT REQUIREMENTS — these override everything else:
- OUTPUT the image in the EXACT SAME ORIENTATION as the input (portrait stays portrait, landscape stays landscape). Do NOT rotate.
- OUTPUT the EXACT SAME dimensions and crop. Do NOT zoom in, zoom out, or cut off any part of the image.
- PRESERVE the EXACT SAME lighting, brightness, contrast, shadow, background, and image quality as the input photo.
- This is NOT a regeneration. You are NOT drawing a new receipt. You are editing specific text values on the existing photo — everything else stays pixel-perfect identical.

TASK: On the existing receipt photo above, change ONLY these text values:
- Total/sum: change to ${targetStr} (this is ${direction} than the original${opts.originalTotal ? ` of ${opts.originalTotal.toFixed(2)}` : ""})
- Date and time: change every date/time occurrence to ${datetime}
- All unique identifier codes — see IDENTIFIER RULES below
${itemMap}

IDENTIFIER RULES — replace EVERY unique code on this receipt with a freshly randomized value:
- Receipt / kvitto numbers (e.g. "252200-001-96396") → new number, same format and length
- Long hex/alphanumeric hash strings (e.g. "71cdbfac-03ff-42ae-ad9b-aa2bd36dddcc") → new random hex in same format
- Reference numbers (Refnr, Ref.nr, Kontrollnr, Auth, Approval code, etc.) → randomize digits
- AID codes (e.g. "A0000000041010") → keep prefix "A000000", randomize the remaining digits
- Barcode number printed below the barcode → randomize all digits keeping exact same length
- Any other alphanumeric string that looks like a unique transaction or device identifier
Each replacement MUST match the exact same character format and length as the original.
No two generations of the same receipt should share any traceable code.

DO NOT ADD any letters, codes, or labels (A, B, C, etc.) next to item names that were not already there in the original image. Do not modify or remove VAT category letters that already exist on the receipt.

DO NOT TOUCH (leave exactly as-is):
- Card number or masked card number (e.g. **** **** **** 1234) — keep last 4 digits exactly as-is
- Bank name, card type (Visa, Mastercard, etc.)
- TSI / TVR codes
- Terminal ID, POS ID, kassanummer / cashier number
- Store name, merchant name, logo
- Organization number / Org.nr / VAT number
- Store address, phone number, website
- Any barcode or QR code graphic (only randomize the number printed below it)

CRITICAL RULES FOR ADJUSTING THE TOTAL:
1. NEVER add new products, NEVER remove existing products, NEVER add new lines to the receipt.
2. The receipt MUST stay exactly the same height — no extra lines whatsoever.
3. DIRECTION RULE: ${directionRule}
4. There are TWO kinds of items on receipts — treat them differently:

   [HAS-QTY-LINE] — Items WITH an existing quantity sub-line (e.g. "2  st x 13,50"):
   - Change the quantity number on that sub-line to move toward the target total
   - The quantity MUST be a whole integer — NEVER use decimals (no "6,5 st" or "3.2 st")
   - Minimum quantity is 1 — never go to 0
   - Update the line-total price to match: new qty × unit price
   - Do NOT duplicate the item name — only edit the existing sub-line in place
   - Do NOT add any letter, label, or code next to the item name

   [PRICE-ONLY] — Items WITHOUT a quantity sub-line (just a name and a price):
   - Do NOT add a quantity sub-line — that would make the receipt taller
   - Change the price value directly on the existing price field
   - Keep changes proportional (e.g. 93,00 can become 46,50 or 139,50, not 4,00)
   - Do NOT add any letter, label, or code next to the item name

5. For gas station receipts: change liters on the existing liter line.
6. The final total MUST exactly match ${targetStr}.
7. For discrete units (st, stk, pcs): quantities MUST be whole integers. For weight/volume units (kg, l, g, cl): decimals are valid (e.g. 0,456 kg or 2,5 l).

VISUAL RULES:
- Keep the EXACT same receipt layout, merchant branding, and font style.
- Keep the EXACT same background, table surface, lighting, shadows, and photo angle as the input.
- Do NOT change the paper condition, color, or texture.
- The edited values must match the font, size, weight, and spacing of the surrounding text on the receipt.
- The result must be indistinguishable from a photo of the original receipt.`;
}

export function buildOCRSystemPrompt(): string {
  return `You are an OCR specialist for Swedish receipts (kvitto) and invoices (fakturor). Extract ALL text from the document with precise bounding box coordinates.

For each text region include:
- "text": the exact text as it appears
- "type": tag describing the role of the text (the full type vocabulary and the exact output JSON shape are specified in the "Document classification" section that follows this prompt)
- "confidence": 0-1 confidence score
- "boundingBox": {"x": float, "y": float, "width": float, "height": float} — NORMALIZED between 0 and 1 relative to full image dimensions (x,y = top-left corner)
- "value": numeric value if the text represents a number/price (parse "123,45" as 123.45)

Type-classification hints for receipt content:
- "total": the final sum (look for "TOTALT", "ATT BETALA", "SUMMA", "TOTAL")
- "vat": VAT/moms amounts and percentages
- "price": individual line item prices (usually right-aligned)
- "item": product/service names (usually left-aligned)
- "quantity": quantities, counts, liters, kg
- "date": dates in any format
- "org": store name, organization numbers, receipt numbers, terminal IDs

Invoice-specific type hints are listed in the section below. Output shape and remaining instructions also follow below.`;
}

const FIELD_LABELS: Record<string, string> = {
  total: "totalsumma",
  date: "datum",
  time: "klockslag",
  invoice_number: "fakturanummer",
  invoice_date: "fakturadatum",
  due_date: "förfallodatum",
  payment_reference: "OCR-/betalreferens",
  customer_name: "kundens namn",
  customer_org_nr: "kundens organisationsnummer",
  customer_address: "kundens adress",
};

export function humanizeFieldName(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

const PROTECTED_SELLER_LABELS: Record<(typeof FAKTURA_PROTECTED_FIELDS)[number], string> = {
  seller_name: "Säljarens namn",
  seller_org_nr: "Säljarens organisationsnummer",
  seller_bankgiro: "Säljarens bankgiro",
  seller_plusgiro: "Säljarens plusgiro",
};

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2);
}

function findItemById(ocrResult: OCRResult, id: string): OCRItem | undefined {
  return ocrResult.items.find(item => item.id === id);
}

function describeItem(item: OCRItem | undefined, fallbackId: string): string {
  if (!item) return `[unknown line id=${fallbackId}]`;
  return item.text;
}

function describeItemValue(item: OCRItem | undefined): string {
  if (!item) return "unknown";
  if (typeof item.value === "number") return formatNumber(item.value);
  return item.text;
}

function operationToInstruction(op: EditOperation, ocrResult: OCRResult): string {
  switch (op.op) {
    case "MODIFY_ITEM": {
      const item = findItemById(ocrResult, op.id);
      const newValue = typeof op.newValue === "number" ? formatNumber(op.newValue) : op.newValue;
      return `Change the ${op.field} of '${describeItem(item, op.id)}' to ${newValue}`;
    }
    case "MULTIPLY_QTY": {
      const item = findItemById(ocrResult, op.id);
      return `Multiply the quantity of '${describeItem(item, op.id)}' by ${op.factor} (current value: ${describeItemValue(item)})`;
    }
    case "ADD_ITEM": {
      return `Add a new line: ${formatNumber(op.qty)} × ${op.name} @ ${formatNumber(op.unitPrice)} kr (VAT ${op.vatRate}%)`;
    }
    case "DELETE_ITEM": {
      const item = findItemById(ocrResult, op.id);
      return `Remove the line '${describeItem(item, op.id)}'`;
    }
    case "SET_FIELD": {
      return `Set the ${humanizeFieldName(op.field)} to ${op.newValue}`;
    }
  }
}

function buildVatBlock(plan: EditPlan): string {
  if (!plan.vatBreakdown.length) return "";
  const rows = plan.vatBreakdown
    .map(b => `- ${b.rate}%: ${b.gross.toFixed(2)} kr (varav moms ${b.vat.toFixed(2)} kr)`)
    .join("\n");
  return `\nFinal VAT breakdown to display:\n${rows}`;
}

function buildSellerProtectionBlock(): string {
  const lines = FAKTURA_PROTECTED_FIELDS.map(
    field => `- ${PROTECTED_SELLER_LABELS[field]} (${field})`,
  ).join("\n");
  return `\nDO NOT MODIFY (these seller fields must remain pixel-identical to the original):
${lines}
Leave every character of the seller block exactly as it appears on the original invoice.`;
}

function buildIdentifierRulesForKvitto(): string {
  return `
IDENTIFIER RULES — replace EVERY unique code on this receipt with a freshly randomized value:
- Receipt / kvitto numbers → new number, same format and length
- AID codes (e.g. "A0000000041010") → keep prefix "A000000", randomize the remaining digits
- Barcode number printed below the barcode → randomize all digits keeping exact same length
- Transaction IDs / long hex/alphanumeric hash strings → new random hex in same format
Each replacement MUST match the exact same character format and length as the original.`;
}

function buildIdentifierRulesForFaktura(target: FakturaTarget): string {
  const parts: string[] = [];
  if (target.invoiceNumber === undefined) {
    parts.push(
      "- Invoice number (fakturanummer): randomize all digits, keep the exact same format and length as the original.",
    );
  } else {
    parts.push(
      `- Invoice number (fakturanummer): set to '${target.invoiceNumber}' exactly as specified by the user.`,
    );
  }
  if (target.paymentReference === undefined) {
    parts.push(
      "- Payment reference / OCR number (OCR-/betalreferens): randomize all digits, keep the exact same format and length as the original.",
    );
  } else {
    parts.push(
      `- Payment reference / OCR number (OCR-/betalreferens): set to '${target.paymentReference}' exactly as specified by the user.`,
    );
  }
  return `\nIDENTIFIER RULES (faktura):\n${parts.join("\n")}\nDo NOT randomize any other identifier on the invoice.`;
}

export function buildPlanPrompt(args: {
  plan: EditPlan;
  ocrResult: OCRResult;
  target: EditTarget;
}): string {
  const { plan, ocrResult, target } = args;

  const operationLines = plan.operations.length
    ? plan.operations.map(op => `- ${operationToInstruction(op, ocrResult)}`).join("\n")
    : "- (no line-level operations — only field updates)";

  const vatBlock = buildVatBlock(plan);

  const docTypeLabel = target.docType === "faktura" ? "invoice (faktura)" : "receipt (kvitto)";

  const protectionBlock = isFakturaTarget(target) ? buildSellerProtectionBlock() : "";

  const identifierBlock = isFakturaTarget(target)
    ? buildIdentifierRulesForFaktura(target)
    : buildIdentifierRulesForKvitto();

  return `You are a ${docTypeLabel} image editor performing SURGICAL TEXT EDITS ONLY.

ABSOLUTE OUTPUT REQUIREMENTS — these override everything else:
- OUTPUT the image in the EXACT SAME ORIENTATION as the input (portrait stays portrait, landscape stays landscape). Do NOT rotate.
- OUTPUT the EXACT SAME dimensions and crop. Do NOT zoom in, zoom out, or cut off any part of the image.
- PRESERVE the EXACT SAME lighting, brightness, contrast, shadow, background, and image quality as the input photo.
- PRESERVE the EXACT SAME font face, font size, font weight, character spacing, and line layout.
- This is NOT a regeneration. You are NOT drawing a new ${docTypeLabel}. You are editing specific text values on the existing photo — everything else stays pixel-perfect identical.

OPERATIONS — apply ONLY these edits, nothing else:
${operationLines}
${vatBlock}
${protectionBlock}
${identifierBlock}

LINE CONSISTENCY RULES:
- For every modified line, the four-tuple (description, unit price, quantity, line total) MUST stay arithmetically consistent: line_total = quantity × unit_price.
- Do NOT add new lines unless an ADD_ITEM operation explicitly requests it.
- Do NOT remove lines unless a DELETE_ITEM operation explicitly requests it.
- Do NOT introduce extra labels, letters, or markers next to item names that were not already present in the original image.

VISUAL RULES:
- Keep the EXACT same document layout, branding, and font style.
- Keep the EXACT same background, surface, lighting, shadows, and photo angle as the input.
- Do NOT change the paper condition, color, or texture.
- The edited values must match the font, size, weight, and spacing of the surrounding text.
- The result must be indistinguishable from a photo of the original ${docTypeLabel}.`;
}
