import type { ReceiptStructure } from "@/types/receipt";

const SURFACES = ['light wood table', 'white desk', 'dark countertop', 'on a grey fabric'];
const CONDITIONS = ['flat and crisp', 'folded once in the middle', 'slightly crumpled', 'curled at the edges'];
const LIGHTING = ['warm indoor lighting', 'cool fluorescent light', 'natural daylight from a window', 'slight shadow from the side'];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getAgingPrompt(receiptDate: string): string {
  const age = Math.floor((Date.now() - new Date(receiptDate).getTime()) / 86400000);
  if (age <= 7) return 'The receipt paper is fresh and crisp, bright white, ink is sharp and dark.';
  if (age <= 28) return 'The receipt paper has slight yellowing at the edges, one subtle fold line across the middle, ink is still clear.';
  if (age <= 90) return 'The receipt paper is noticeably yellowed, has multiple fold lines, slight crumpling, ink is starting to fade slightly.';
  return 'The receipt paper is heavily yellowed, well-worn with many fold creases, ink is faded and partially illegible in places, paper feels thin and fragile.';
}

function buildItemMap(structure: ReceiptStructure): string {
  if (!structure?.items?.length) return "";

  const lines = structure.items.map(item => {
    if (item.type === "A") {
      return `- ${item.name}: Type A — has quantity sub-line. Currently ${item.currentQty} ${item.qtyUnit ?? "st"} × ${item.unitPrice.toFixed(2)} = ${item.currentPrice.toFixed(2)}. EDIT: change the quantity integer on the existing sub-line (e.g. "${item.currentQty} ${item.qtyUnit ?? "st"} x ${item.unitPrice.toFixed(2)}" → "N ${item.qtyUnit ?? "st"} x ${item.unitPrice.toFixed(2)}"). N must be a whole integer. Update the line total to N × ${item.unitPrice.toFixed(2)}. Do NOT duplicate the item name.`;
    }
    return `- ${item.name}: Type B — no quantity sub-line. Current price: ${item.currentPrice.toFixed(2)}. EDIT: change only the price value in place. Do NOT add a quantity sub-line (receipt must not grow taller).`;
  });

  return `\nITEM MAP (derived from OCR — use this as your editing guide):\n${lines.join("\n")}`;
}

export function buildEditPrompt(opts: {
  targetTotal: number;
  date: string;
  receiptStructure?: ReceiptStructure;
}): string {
  const aging = getAgingPrompt(opts.date);
  const surfacePart = Math.random() > 0.5 ? ` Background surface: ${pick(SURFACES)}.` : '';
  const lightingPart = Math.random() > 0.5 ? ` Lighting: ${pick(LIGHTING)}.` : '';
  const variation = `Paper condition: ${pick(CONDITIONS)}.${surfacePart}${lightingPart}`;
  const targetStr = opts.targetTotal.toFixed(2);
  const itemMap = opts.receiptStructure ? buildItemMap(opts.receiptStructure) : "";

  return `You are a receipt image editor.

TASK: Edit this receipt photo. Change ONLY these values:
- Total/sum: change to ${targetStr}
- Date: change to ${opts.date}
${itemMap}

CRITICAL RULES FOR ADJUSTING THE TOTAL:
1. NEVER add new products, NEVER remove existing products, NEVER add new lines to the receipt.
2. The receipt MUST stay exactly the same height — no extra lines whatsoever.
3. There are TWO types of items on receipts — treat them differently:

   TYPE A — Items WITH an existing quantity sub-line (e.g. "2  st x 13,50"):
   - You MAY increase the quantity number on that sub-line (e.g. "2" → "5")
   - The quantity MUST be a whole integer — NEVER use decimals (no "6,5 st" or "3.2 st")
   - Update the line-total price to match: new qty × unit price
   - Do NOT duplicate the item name — only edit the existing sub-line in place

   TYPE B — Items WITHOUT a quantity sub-line (just a name and a price):
   - Do NOT add a quantity sub-line — that would make the receipt taller
   - Instead, increase the unit price directly on the existing price field
   - Keep the price realistic (e.g. 93,00 → 186,00, not 93,00 → 279,37)

4. For gas station receipts: increase liters on the existing liter line.
5. The final total MUST exactly match ${targetStr}.
6. For discrete units (st, stk, pcs): quantities MUST be whole integers — you cannot buy half a package. For weight/volume units (kg, l, g, cl): decimals are valid (e.g. 0,456 kg or 2,5 l).
7. Keep all existing prices realistic (XX,90 or XX,95 endings — not round numbers).

VISUAL RULES:
- Keep the EXACT same receipt layout, merchant branding, and font style.
- ${aging}
- ${variation}
- The result must look like a natural, unedited receipt photo.`;
}

export function buildOCRSystemPrompt(): string {
  return `You are a receipt OCR specialist. Analyze the receipt image and extract ALL text with precise bounding box coordinates.

For EVERY text region you detect, return a JSON object with:
- "text": the exact text as it appears
- "type": one of "item", "price", "total", "vat", "date", "org", "quantity", "unknown"
- "confidence": 0-1 confidence score
- "boundingBox": {"x": float, "y": float, "width": float, "height": float} where all values are NORMALIZED between 0 and 1 relative to the full image dimensions
- "value": numeric value if the text represents a number/price (parse "123,45" as 123.45)

Rules for bounding boxes:
- x,y is the TOP-LEFT corner of the text region
- width,height are the dimensions of the text region
- ALL values must be between 0 and 1 (normalized by image width/height)

Rules for type classification:
- "total": the final sum / total amount (look for "TOTALT", "ATT BETALA", "SUMMA", "TOTAL")
- "vat": VAT/moms amounts and percentages
- "price": individual line item prices (usually right-aligned)
- "item": product/service names (usually left-aligned)
- "quantity": quantities, counts, liters, kg
- "date": dates in any format
- "org": organization numbers, store IDs, receipt numbers

Return ONLY a JSON array of objects. No markdown, no explanation.`;
}
