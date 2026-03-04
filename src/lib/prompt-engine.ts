import type { OCRItem, EditRequest, LedgerResult, BoundingBox } from "@/types/receipt";

function positionHint(box: BoundingBox): string {
  const vertical = box.y < 0.33 ? "top" : box.y < 0.66 ? "middle" : "bottom";
  const horizontal = box.x < 0.33 ? "left" : box.x < 0.66 ? "center" : "right";
  return `${vertical}-${horizontal}`;
}

function formatValue(value: number): string {
  return value.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function buildEditPrompt(
  edits: EditRequest[],
  ledger: LedgerResult,
): string {
  const editDescriptions = edits.map(edit => {
    const adjustedItem = ledger.adjustedItems.find(i => i.id === edit.itemId);
    if (!adjustedItem) return "";

    const position = positionHint(adjustedItem.boundingBox);
    return `The price in the ${position} area of the receipt now reads "${formatValue(edit.newValue)}" instead of "${formatValue(edit.originalValue)}".`;
  }).filter(Boolean);

  const totalDescription = `The total at the bottom of the receipt now shows "${formatValue(ledger.newTotal)}".`;

  const vatDescriptions = ledger.vatBreakdown.map(vat =>
    `The VAT amount (${vat.rate}%) is now "${formatValue(vat.vat)}" on a net of "${formatValue(vat.net)}".`
  );

  const parts = [
    "This is a photograph of a receipt.",
    ...editDescriptions,
    totalDescription,
    ...vatDescriptions,
    "All other text, logos, formatting, and layout remain exactly as they appear in the original photograph.",
    "The receipt looks natural and unedited.",
  ];

  return parts.join(" ");
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
