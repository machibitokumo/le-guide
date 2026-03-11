"use client";

import type { LedgerResult } from "@/types/receipt";

interface FooterActionsProps {
  editedImageUrl: string;
  ledgerResult: LedgerResult;
  onRestart: () => void;
  downloadFilename?: string;
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


export default function FooterActions({
  editedImageUrl,
  ledgerResult,
  onRestart,
  downloadFilename = "receipt-edited.jpg",
}: FooterActionsProps) {
  const logDownload = () => {
    fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "download" }),
    }).catch(() => {});
  };

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
        onClick={() => { downloadImage(editedImageUrl, downloadFilename); logDownload(); }}
        className="flex-1 min-w-[120px] py-2.5 px-4 rounded-lg bg-muted hover:bg-border text-sm font-mono transition-colors"
      >
        Download image
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
