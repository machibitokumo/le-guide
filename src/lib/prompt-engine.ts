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

export function buildEditPrompt(opts: {
  targetTotal: number;
  date: string;
}): string {
  const aging = getAgingPrompt(opts.date);
  const surfacePart = Math.random() > 0.5 ? ` Background surface: ${pick(SURFACES)}.` : '';
  const lightingPart = Math.random() > 0.5 ? ` Lighting: ${pick(LIGHTING)}.` : '';
  const variation = `Paper condition: ${pick(CONDITIONS)}.${surfacePart}${lightingPart}`;
  const targetStr = opts.targetTotal.toFixed(2);

  return `You are a receipt image editor.

TASK: Edit this receipt photo. Change ONLY these values:
- Total/sum: change to ${targetStr}
- Date: change to ${opts.date}

CRITICAL RULES FOR ADJUSTING THE TOTAL:
1. NEVER add random new products that don't exist on the original receipt.
2. Keep all original items from the receipt image — do NOT remove any.
3. To reach the target total, INCREASE THE QUANTITY of existing items. For example: change "1x Milk" to "3x Milk".
4. Keep the same unit prices — only change quantities.
5. For gas station receipts: increase the number of liters (e.g. 10L → 50L) rather than adding products.
6. The final total MUST exactly match ${targetStr} — adjust the last item's quantity by a small amount if needed to land on the exact target.
7. Use realistic retail prices (19.90, 34.50 — not round numbers like 20.00).
8. Apply VAT rules (25%, 12%, 6%) to each item — food items are typically 12%, books/transport 6%, everything else 25%.

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
