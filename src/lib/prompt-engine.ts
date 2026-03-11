import type { ReceiptStructure } from "@/types/receipt";


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
- TSI / TVR codes → randomize the hex/digit values
- Terminal IDs, POS IDs, Kassör/cashier numbers → randomize digits
- Barcode number printed below the barcode → randomize all digits keeping exact same length
- Any other alphanumeric string that looks like a unique transaction or device identifier
Each replacement MUST match the exact same character format and length as the original.
No two generations of the same receipt should share any traceable code.

DO NOT ADD any letters, codes, or labels (A, B, C, etc.) next to item names that were not already there in the original image. Do not modify or remove VAT category letters that already exist on the receipt.

DO NOT TOUCH (leave exactly as-is):
- Card number or masked card number (e.g. **** **** **** 1234) — keep last 4 digits exactly as-is
- Bank name, card type (Visa, Mastercard, etc.)
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
