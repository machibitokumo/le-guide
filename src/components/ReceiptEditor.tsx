"use client";

import { useState } from "react";
import type { OCRResult, EditRequest } from "@/types/receipt";
import PriceOverlay from "./PriceOverlay";

interface ReceiptEditorProps {
  ocrResult: OCRResult;
  imageUrl: string;
  onSubmitEdits: (edits: EditRequest[]) => void;
  disabled?: boolean;
}

export default function ReceiptEditor({
  ocrResult,
  imageUrl,
  onSubmitEdits,
  disabled,
}: ReceiptEditorProps) {
  const [edits, setEdits] = useState<Map<string, EditRequest>>(new Map());

  const handleEdit = (itemId: string, newValue: number) => {
    const item = ocrResult.items.find((i) => i.id === itemId);
    if (!item || item.value === undefined) return;

    const updated = new Map(edits);
    if (newValue === item.value) {
      updated.delete(itemId);
    } else {
      updated.set(itemId, {
        itemId,
        originalValue: item.value,
        newValue,
      });
    }
    setEdits(updated);
  };

  const handleGenerate = () => {
    if (edits.size === 0) return;
    onSubmitEdits(Array.from(edits.values()));
  };

  const editableItems = ocrResult.items.filter(
    (i) => i.type === "price" || i.type === "total"
  );

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4">
      <div className="relative inline-block w-full">
        <img
          src={imageUrl}
          alt="Receipt"
          className="w-full rounded-lg"
          draggable={false}
        />

        {/* Overlay container — same dimensions as image */}
        <div className="absolute inset-0">
          {editableItems.map((item) => (
            <PriceOverlay
              key={item.id}
              item={item}
              onEdit={handleEdit}
              isEdited={edits.has(item.id)}
            />
          ))}
        </div>
      </div>

      {/* Edit summary */}
      {edits.size > 0 && (
        <div className="bg-muted rounded-lg p-4 space-y-2">
          <p className="text-xs text-foreground/50 uppercase tracking-wider">
            Pending edits ({edits.size})
          </p>
          {Array.from(edits.values()).map((edit) => {
            const item = ocrResult.items.find((i) => i.id === edit.itemId);
            return (
              <div key={edit.itemId} className="flex justify-between text-sm">
                <span className="text-foreground/70">{item?.text ?? "?"}</span>
                <span>
                  <span className="text-danger line-through mr-2">
                    {edit.originalValue.toFixed(2)}
                  </span>
                  <span className="text-success">{edit.newValue.toFixed(2)}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      <button
        onClick={handleGenerate}
        disabled={disabled || edits.size === 0}
        className={`
          w-full py-3 rounded-lg font-mono text-sm transition-all duration-200
          ${edits.size > 0
            ? "bg-accent hover:bg-accent-hover text-white cursor-pointer"
            : "bg-border text-foreground/30 cursor-not-allowed"
          }
        `}
      >
        {edits.size > 0
          ? `Generate edited receipt (${edits.size} change${edits.size > 1 ? "s" : ""})`
          : "Click on prices to edit them"}
      </button>

      {/* Item list for non-editable items */}
      <details className="text-xs text-foreground/40">
        <summary className="cursor-pointer hover:text-foreground/60">
          All detected items ({ocrResult.items.length})
        </summary>
        <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
          {ocrResult.items.map((item) => (
            <div key={item.id} className="flex justify-between">
              <span className="truncate mr-4">[{item.type}] {item.text}</span>
              <span>{(item.confidence * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
