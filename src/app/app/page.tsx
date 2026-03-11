"use client";

import { useState, useEffect } from "react";
import ReceiptWizard from "@/components/ReceiptWizard";
import AddToHomeScreen from "@/components/AddToHomeScreen";

function formatSEK(amount: number): string {
  return amount.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " kr";
}

interface Receipt {
  name: string;
  url: string;
  created_at: string;
}

export default function AppPage() {
  const [accumulated, setAccumulated] = useState<number | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);

  useEffect(() => {
    fetch("/api/stats")
      .then(r => r.json())
      .then(d => setAccumulated(d.accumulated_total ?? 0));
  }, []);

  const handleGenerated = async (_total: number, apiCostUSD: number) => {
    // Store in USD; display converts to SEK
    const res = await fetch("/api/stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: apiCostUSD }),
    });
    const data = await res.json();
    setAccumulated(data.accumulated_total ?? 0);
  };

  // accumulated is USD; convert to SEK at ~10.5, then ×2 markup
  const SEK_RATE = 10.5;
  const displayCost = accumulated === null ? "..." : formatSEK(accumulated * SEK_RATE * 2);

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-8">

      {/* Header */}
      <div className="w-full max-w-2xl mb-10">
        <div className="grid grid-cols-3 items-start">

          {/* Left — API cost */}
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-mono text-foreground/40">API cost</span>
            <span className="text-sm font-mono text-foreground/70">{displayCost}</span>
          </div>

          {/* Center — title */}
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight font-mono">Le Guide</h1>
            <p className="text-foreground/30 text-xs font-mono mt-1">
              Brought to you by 見えない技術クラウド
            </p>
          </div>

          {/* Right — Library */}
          <div className="flex flex-col items-end gap-0.5">
            <button
              onClick={() => {
                setShowLibrary(true);
                setLibraryLoading(true);
                fetch("/api/library")
                  .then(r => r.json())
                  .then(d => setReceipts(d.receipts ?? []))
                  .finally(() => setLibraryLoading(false));
              }}
              className="flex flex-col items-center gap-1 opacity-50 hover:opacity-100 transition-opacity"
            >
              <span style={{ fontSize: "2rem", lineHeight: 1 }}>🗂</span>
              <span className="text-xs font-mono text-foreground/60">Library</span>
            </button>
          </div>

        </div>
      </div>

      {/* Wizard */}
      <ReceiptWizard onGenerated={handleGenerated} />

      {/* Add to Home Screen */}
      <AddToHomeScreen />

      {/* Library overlay */}
      {showLibrary && (
        <div
          className="fixed inset-0 bg-black/40 flex items-end justify-center z-50"
          onClick={() => setShowLibrary(false)}
        >
          <div
            className="w-full max-w-2xl bg-background rounded-t-2xl p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-mono font-bold text-sm">Library</h2>
              <button
                onClick={() => setShowLibrary(false)}
                className="text-foreground/40 hover:text-foreground font-mono text-xs"
              >
                close
              </button>
            </div>
            {libraryLoading && (
              <p className="text-xs font-mono text-foreground/40">Loading...</p>
            )}
            {!libraryLoading && receipts.length === 0 && (
              <p className="text-xs font-mono text-foreground/40">No receipts yet.</p>
            )}
            {!libraryLoading && receipts.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {receipts.map(r => (
                  <a key={r.name} href={r.url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={r.url}
                      alt={r.name}
                      className="w-full rounded-lg object-cover aspect-[3/4] hover:opacity-80 transition-opacity"
                    />
                    <p className="text-xs font-mono text-foreground/40 mt-1 truncate">
                      {r.name.slice(0, 10)}
                    </p>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

    </main>
  );
}
