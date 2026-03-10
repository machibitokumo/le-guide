import type { OCRItem, OCRResult, LedgerResult, VATBreakdown, VATRate } from "@/types/receipt";

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

function formatSEK(value: number): string {
  return value.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function reconcile(ocrResult: OCRResult, targetTotal: number): LedgerResult {
  const vatRate = detectVATRate(ocrResult.items);
  const vatBreakdown = [recalcVAT(targetTotal, vatRate)];
  const vatInfo = vatBreakdown[0];

  const warnings = [
    `Total set to ${formatSEK(targetTotal)}`,
    `VAT (${vatRate}%): ${formatSEK(vatInfo.vat)} on net ${formatSEK(vatInfo.net)}`,
  ];

  return {
    adjustedItems: ocrResult.items,
    newTotal: targetTotal,
    vatBreakdown,
    warnings,
  };
}
