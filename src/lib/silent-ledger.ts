import type { OCRItem, OCRResult, EditRequest, LedgerResult, VATBreakdown, VATRate } from "@/types/receipt";

type Strategy = "fuel" | "quantity" | "split";

interface StrategyContext {
  items: OCRItem[];
  edit: EditRequest;
  totalItem: OCRItem | undefined;
  vatItems: OCRItem[];
}

function detectVATRate(items: OCRItem[]): VATRate {
  const vatText = items.find(i => i.type === "vat")?.text ?? "";
  if (vatText.includes("6%") || vatText.includes("6 %")) return 6;
  if (vatText.includes("12%") || vatText.includes("12 %")) return 12;
  return 25;
}

function recalcVAT(gross: number, rate: VATRate): VATBreakdown {
  const net = gross / (1 + rate / 100);
  const vat = gross - net;
  return {
    rate,
    net: Math.round(net * 100) / 100,
    vat: Math.round(vat * 100) / 100,
    gross: Math.round(gross * 100) / 100,
  };
}

function applyFuelStrategy(ctx: StrategyContext): { items: OCRItem[]; warnings: string[] } {
  const warnings: string[] = [];
  const items = ctx.items.map(item => {
    if (item.id !== ctx.edit.itemId) return item;
    const ratio = ctx.edit.newValue / ctx.edit.originalValue;
    const quantityItem = ctx.items.find(
      i => i.type === "quantity" && Math.abs(i.boundingBox.y - item.boundingBox.y) < 0.05
    );
    if (quantityItem && quantityItem.value) {
      const newQty = Math.round(quantityItem.value * ratio * 100) / 100;
      warnings.push(`Quantity adjusted: ${quantityItem.value} → ${newQty}`);
    }
    return { ...item, value: ctx.edit.newValue, text: formatSEK(ctx.edit.newValue) };
  });
  return { items, warnings };
}

function applyQuantityStrategy(ctx: StrategyContext): { items: OCRItem[]; warnings: string[] } {
  const warnings: string[] = [];
  const items = ctx.items.map(item => {
    if (item.id !== ctx.edit.itemId) return item;
    return { ...item, value: ctx.edit.newValue, text: formatSEK(ctx.edit.newValue) };
  });
  warnings.push(`Price updated: ${formatSEK(ctx.edit.originalValue)} → ${formatSEK(ctx.edit.newValue)}`);
  return { items, warnings };
}

function applySplitStrategy(ctx: StrategyContext): { items: OCRItem[]; warnings: string[] } {
  const warnings: string[] = [];
  const diff = ctx.edit.newValue - ctx.edit.originalValue;
  const items = ctx.items.map(item => {
    if (item.id !== ctx.edit.itemId) return item;
    return { ...item, value: ctx.edit.newValue, text: formatSEK(ctx.edit.newValue) };
  });
  if (Math.abs(diff) > 0.01) {
    warnings.push(`Difference of ${formatSEK(diff)} absorbed into total`);
  }
  return { items, warnings };
}

function chooseStrategy(ctx: StrategyContext): Strategy {
  const editedItem = ctx.items.find(i => i.id === ctx.edit.itemId);
  if (!editedItem) return "quantity";

  const hasNearbyQuantity = ctx.items.some(
    i => i.type === "quantity" && Math.abs(i.boundingBox.y - editedItem.boundingBox.y) < 0.05
  );

  if (hasNearbyQuantity) return "fuel";

  const ratio = ctx.edit.newValue / ctx.edit.originalValue;
  if (ratio > 2 || ratio < 0.5) return "split";

  return "quantity";
}

function formatSEK(value: number): string {
  return value.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function reconcile(ocrResult: OCRResult, edits: EditRequest[]): LedgerResult {
  let items = [...ocrResult.items];
  const allWarnings: string[] = [];
  const vatRate = detectVATRate(items);
  const totalItem = items.find(i => i.type === "total");
  const vatItems = items.filter(i => i.type === "vat");

  for (const edit of edits) {
    const ctx: StrategyContext = { items, edit, totalItem, vatItems };
    const strategy = chooseStrategy(ctx);

    let result: { items: OCRItem[]; warnings: string[] };
    switch (strategy) {
      case "fuel":
        result = applyFuelStrategy(ctx);
        break;
      case "split":
        result = applySplitStrategy(ctx);
        break;
      case "quantity":
      default:
        result = applyQuantityStrategy(ctx);
        break;
    }

    items = result.items;
    allWarnings.push(...result.warnings);
  }

  // Recalculate total from all price items
  const priceItems = items.filter(i => i.type === "price");
  const newTotal = priceItems.reduce((sum, i) => sum + (i.value ?? 0), 0);
  const roundedTotal = Math.round(newTotal * 100) / 100;

  // Update total item if present
  if (totalItem) {
    items = items.map(i =>
      i.id === totalItem.id
        ? { ...i, value: roundedTotal, text: formatSEK(roundedTotal) }
        : i
    );
  }

  const vatBreakdown = [recalcVAT(roundedTotal, vatRate)];

  // Update VAT items
  const vatInfo = vatBreakdown[0];
  items = items.map(i => {
    if (i.type === "vat" && i.value !== undefined) {
      return { ...i, value: vatInfo.vat, text: formatSEK(vatInfo.vat) };
    }
    return i;
  });

  return {
    adjustedItems: items,
    newTotal: roundedTotal,
    vatBreakdown,
    warnings: allWarnings,
  };
}
