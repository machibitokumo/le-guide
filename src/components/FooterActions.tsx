"use client";

import type { LedgerResult, OCRItem } from "@/types/receipt";

interface FooterActionsProps {
  editedImageUrl: string;
  ledgerResult: LedgerResult;
  onRestart: () => void;
}

async function copyImageToClipboard(dataUrl: string) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  await navigator.clipboard.write([
    new ClipboardItem({ [blob.type]: blob }),
  ]);
}

function downloadImage(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

function generateMarkdown(ledger: LedgerResult): string {
  const lines: string[] = ["# Receipt Summary", ""];

  const items = ledger.adjustedItems.filter(
    (i: OCRItem) => i.type === "item" || i.type === "price"
  );

  // Pair items with prices by proximity
  const paired: { name: string; price: string }[] = [];
  const itemNames = items.filter((i: OCRItem) => i.type === "item");
  const prices = items.filter((i: OCRItem) => i.type === "price");

  for (const name of itemNames) {
    const closest = prices.reduce<OCRItem | null>((best, p) => {
      const dist = Math.abs(p.boundingBox.y - name.boundingBox.y);
      const bestDist = best ? Math.abs(best.boundingBox.y - name.boundingBox.y) : Infinity;
      return dist < bestDist ? p : best;
    }, null);
    paired.push({
      name: name.text,
      price: closest?.text ?? "—",
    });
  }

  if (paired.length > 0) {
    lines.push("| Item | Price |", "|------|-------|");
    for (const { name, price } of paired) {
      lines.push(`| ${name} | ${price} |`);
    }
    lines.push("");
  }

  lines.push(`**Total:** ${ledger.newTotal.toFixed(2)} kr`);
  lines.push("");

  for (const vat of ledger.vatBreakdown) {
    lines.push(`- VAT ${vat.rate}%: ${vat.vat.toFixed(2)} kr (net: ${vat.net.toFixed(2)} kr)`);
  }

  if (ledger.warnings.length > 0) {
    lines.push("", "## Adjustments", "");
    for (const w of ledger.warnings) {
      lines.push(`- ${w}`);
    }
  }

  return lines.join("\n");
}

function downloadMarkdown(ledger: LedgerResult) {
  const md = generateMarkdown(ledger);
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "receipt.md";
  link.click();
  URL.revokeObjectURL(url);
}

export default function FooterActions({
  editedImageUrl,
  ledgerResult,
  onRestart,
}: FooterActionsProps) {
  const handleCopy = async () => {
    try {
      await copyImageToClipboard(editedImageUrl);
    } catch {
      // Fallback: open in new tab
      window.open(editedImageUrl, "_blank");
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto flex flex-wrap gap-3">
      <button
        onClick={handleCopy}
        className="flex-1 min-w-[120px] py-2.5 px-4 rounded-lg bg-muted hover:bg-border text-sm font-mono transition-colors"
      >
        Copy image
      </button>
      <button
        onClick={() => downloadImage(editedImageUrl, "receipt-edited.jpg")}
        className="flex-1 min-w-[120px] py-2.5 px-4 rounded-lg bg-muted hover:bg-border text-sm font-mono transition-colors"
      >
        Download image
      </button>
      <button
        onClick={() => downloadMarkdown(ledgerResult)}
        className="flex-1 min-w-[120px] py-2.5 px-4 rounded-lg bg-muted hover:bg-border text-sm font-mono transition-colors"
      >
        Download .md
      </button>
      <button
        onClick={onRestart}
        className="flex-1 min-w-[120px] py-2.5 px-4 rounded-lg bg-danger/20 hover:bg-danger/30 text-danger text-sm font-mono transition-colors"
      >
        New receipt
      </button>
    </div>
  );
}
