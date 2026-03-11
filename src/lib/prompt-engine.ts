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

function buildItemMap(structure: ReceiptStructure, goingDown: boolean): string {
  if (!structure?.items?.length) return "";

  const verb = goingDown ? "DECREASE" : "INCREASE";
  const lines = structure.items.map(item => {
    if (item.type === "A") {
      const newQtyHint = goingDown
        ? `reduce N below ${item.currentQty} (minimum 1)`
        : `raise N above ${item.currentQty}`;
      return `- ${item.name}: Type A — has quantity sub-line. Currently ${item.currentQty} ${item.qtyUnit ?? "st"} × ${item.unitPrice.toFixed(2)} = ${item.currentPrice.toFixed(2)}. EDIT: ${newQtyHint}. N must be a whole integer. Update the line total to N × ${item.unitPrice.toFixed(2)}. Do NOT duplicate the item name.`;
    }
    const hint = goingDown
      ? `lower the price below ${item.currentPrice.toFixed(2)}`
      : `raise the price above ${item.currentPrice.toFixed(2)}`;
    return `- ${item.name}: Type B — no quantity sub-line. Current price: ${item.currentPrice.toFixed(2)}. EDIT: ${hint}. Change only the price value in place. Do NOT add a quantity sub-line.`;
  });

  return `\nITEM MAP (derived from OCR — use this as your editing guide):\n${lines.join("\n")}`;
}

export function buildEditPrompt(opts: {
  targetTotal: number;
  date: string;
  originalTotal?: number;
  receiptStructure?: ReceiptStructure;
}): string {
  const aging = getAgingPrompt(opts.date);
  const surfacePart = Math.random() > 0.5 ? ` Background surface: ${pick(SURFACES)}.` : '';
  const lightingPart = Math.random() > 0.5 ? ` Lighting: ${pick(LIGHTING)}.` : '';
  const variation = `Paper condition: ${pick(CONDITIONS)}.${surfacePart}${lightingPart}`;
  const targetStr = opts.targetTotal.toFixed(2);
  const goingDown = opts.originalTotal !== undefined ? opts.targetTotal < opts.originalTotal : false;
  const direction = goingDown ? "LOWER" : "HIGHER";
  const directionRule = goingDown
    ? "Every item change MUST reduce a line total — do NOT raise any individual price or quantity."
    : "Every item change MUST increase a line total — do NOT lower any individual price or quantity.";
  const itemMap = opts.receiptStructure ? buildItemMap(opts.receiptStructure, goingDown) : "";

  return `You are a receipt image editor.

TASK: Edit this receipt photo. Change ONLY these values:
- Total/sum: change to ${targetStr} (this is ${direction} than the original${opts.originalTotal ? ` of ${opts.originalTotal.toFixed(2)}` : ""})
- Date: change to ${opts.date}
${itemMap}

CRITICAL RULES FOR ADJUSTING THE TOTAL:
1. NEVER add new products, NEVER remove existing products, NEVER add new lines to the receipt.
2. The receipt MUST stay exactly the same height — no extra lines whatsoever.
3. DIRECTION RULE: ${directionRule}
4. There are TWO types of items on receipts — treat them differently:

   TYPE A — Items WITH an existing quantity sub-line (e.g. "2  st x 13,50"):
   - Change the quantity number on that sub-line to move toward the target total
   - The quantity MUST be a whole integer — NEVER use decimals (no "6,5 st" or "3.2 st")
   - Minimum quantity is 1 — never go to 0
   - Update the line-total price to match: new qty × unit price
   - Do NOT duplicate the item name — only edit the existing sub-line in place

   TYPE B — Items WITHOUT a quantity sub-line (just a name and a price):
   - Do NOT add a quantity sub-line — that would make the receipt taller
   - Change the price value directly on the existing price field
   - Keep changes proportional (e.g. 93,00 can become 46,50 or 139,50, not 4,00)

5. For gas station receipts: change liters on the existing liter line.
6. The final total MUST exactly match ${targetStr}.
7. For discrete units (st, stk, pcs): quantities MUST be whole integers. For weight/volume units (kg, l, g, cl): decimals are valid (e.g. 0,456 kg or 2,5 l).

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
