"use client";

import { useReducer, useState } from "react";
import type { PipelineState, OCRResult, LedgerResult, ReceiptStructure } from "@/types/receipt";
import UploadZone from "./UploadZone";
import FooterActions from "./FooterActions";

type Action =
  | { type: "UPLOAD_START" }
  | { type: "UPLOAD_ERROR"; message: string }
  | { type: "OCR_COMPLETE"; ocrResult: OCRResult; imageUrl: string; receiptStructure: ReceiptStructure }
  | { type: "GENERATE_START"; targetTotal: number; date: string }
  | { type: "GENERATE_COMPLETE"; editedImageUrl: string; ledgerResult: LedgerResult; originalImageUrl: string }
  | { type: "ERROR"; message: string }
  | { type: "RESTART" };

function reducer(state: PipelineState, action: Action): PipelineState {
  switch (action.type) {
    case "UPLOAD_START":
      return { step: "uploading" };
    case "UPLOAD_ERROR":
      return { step: "error", message: action.message, previousStep: "idle" };
    case "OCR_COMPLETE":
      return { step: "targeting", ocrResult: action.ocrResult, imageUrl: action.imageUrl, receiptStructure: action.receiptStructure };
    case "GENERATE_START":
      return { step: "generating", targetTotal: action.targetTotal, date: action.date };
    case "GENERATE_COMPLETE":
      return {
        step: "done",
        editedImageUrl: action.editedImageUrl,
        ledgerResult: action.ledgerResult,
        originalImageUrl: action.originalImageUrl,
      };
    case "ERROR":
      return { step: "error", message: action.message };
    case "RESTART":
      return { step: "idle" };
    default:
      return state;
  }
}

const STEP_LABELS: Record<string, string> = {
  idle: "Upload a receipt",
  uploading: "Analyzing receipt...",
  targeting: "Set target",
  generating: "Generating edited receipt...",
  done: "Done",
  error: "Error",
};

interface ReceiptWizardProps {
  onGenerated?: (targetTotal: number) => void;
}

export default function ReceiptWizard({ onGenerated }: ReceiptWizardProps) {
  const [state, dispatch] = useReducer(reducer, { step: "idle" });
  const [targetTotal, setTargetTotal] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const handleUpload = async (file: File) => {
    dispatch({ type: "UPLOAD_START" });

    try {
      const formData = new FormData();
      formData.append("receipt", file);

      const res = await fetch("/api/process-receipt", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "OCR request failed");
      }

      const data = await res.json();
      dispatch({
        type: "OCR_COMPLETE",
        ocrResult: data.ocr,
        imageUrl: data.imageUrl,
        receiptStructure: data.receiptStructure,
      });
    } catch (err) {
      dispatch({
        type: "UPLOAD_ERROR",
        message: err instanceof Error ? err.message : "Upload failed",
      });
    }
  };

  const handleGenerate = async () => {
    if (state.step !== "targeting") return;
    const total = parseFloat(targetTotal.replace(",", "."));
    if (isNaN(total) || total <= 0) return;

    const { ocrResult, imageUrl, receiptStructure } = state;
    dispatch({ type: "GENERATE_START", targetTotal: total, date });

    try {
      const res = await fetch("/api/edit-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, ocrResult, receiptStructure, targetTotal: total, date }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Image edit failed");
      }

      const data = await res.json();
      dispatch({
        type: "GENERATE_COMPLETE",
        editedImageUrl: data.editedImageUrl,
        ledgerResult: data.ledgerResult,
        originalImageUrl: imageUrl,
      });
      onGenerated?.(total);
    } catch (err) {
      dispatch({
        type: "ERROR",
        message: err instanceof Error ? err.message : "Generation failed",
      });
    }
  };

  const handleRestart = () => {
    setTargetTotal("");
    setDate(new Date().toISOString().slice(0, 10));
    dispatch({ type: "RESTART" });
  };

  const steps = ["upload", "analyze", "target", "generate", "done"];
  const currentStepIndex = {
    idle: 0,
    uploading: 1,
    processing: 1,
    targeting: 2,
    generating: 3,
    done: 4,
    error: -1,
  }[state.step] ?? 0;

  return (
    <div className="space-y-8">
      {/* Progress bar */}
      <div className="w-full max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center">
              <div
                className={`
                  w-2.5 h-2.5 rounded-full transition-colors duration-300
                  ${i <= currentStepIndex ? "bg-accent" : "bg-border"}
                  ${i === currentStepIndex ? "ring-2 ring-accent/30" : ""}
                `}
              />
              {i < steps.length - 1 && (
                <div
                  className={`
                    w-12 sm:w-20 h-px mx-1 transition-colors duration-300
                    ${i < currentStepIndex ? "bg-accent" : "bg-border"}
                  `}
                />
              )}
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-foreground/40 font-mono">
          {STEP_LABELS[state.step] ?? state.step}
        </p>
      </div>

      {/* Loading spinner */}
      {(state.step === "uploading" || state.step === "generating") && (
        <div className="flex flex-col items-center gap-4 py-12">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-foreground/50 font-mono animate-pulse">
            {state.step === "uploading" ? "Analyzing receipt..." : "Generating edited image..."}
          </p>
        </div>
      )}

      {/* Idle → Upload */}
      {state.step === "idle" && (
        <UploadZone onUpload={handleUpload} />
      )}

      {/* Targeting */}
      {state.step === "targeting" && (
        <div className="w-full max-w-md mx-auto space-y-6">
          <img
            src={state.imageUrl}
            alt="Uploaded receipt"
            className="w-full rounded-lg opacity-70"
          />
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-foreground/50 font-mono mb-1">
                Target total
              </label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="e.g. 349.90"
                value={targetTotal}
                onChange={e => setTargetTotal(e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-4 py-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div>
              <label className="block text-xs text-foreground/50 font-mono mb-1">
                Receipt date
              </label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-4 py-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <button
              onClick={handleGenerate}
              disabled={!targetTotal || !date}
              className="w-full py-3 rounded-lg bg-accent text-background text-sm font-mono font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              Generate edited receipt
            </button>
          </div>
        </div>
      )}

      {/* Done */}
      {state.step === "done" && (
        <div className="space-y-6">
          <div className="w-full max-w-2xl mx-auto grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-foreground/40 mb-2 font-mono">Original</p>
              <img
                src={state.originalImageUrl}
                alt="Original receipt"
                className="w-full rounded-lg opacity-60"
              />
            </div>
            <div>
              <p className="text-xs text-foreground/40 mb-2 font-mono">Edited</p>
              <img
                src={state.editedImageUrl}
                alt="Edited receipt"
                className="w-full rounded-lg ring-1 ring-success/30"
              />
            </div>
          </div>

          {state.ledgerResult.warnings.length > 0 && (
            <div className="w-full max-w-2xl mx-auto bg-warning/10 rounded-lg p-3">
              <p className="text-xs text-warning font-mono mb-1">Ledger summary:</p>
              {state.ledgerResult.warnings.map((w, i) => (
                <p key={i} className="text-xs text-foreground/60">{w}</p>
              ))}
            </div>
          )}

          <FooterActions
            editedImageUrl={state.editedImageUrl}
            ledgerResult={state.ledgerResult}
            onRestart={handleRestart}
          />
        </div>
      )}

      {/* Error */}
      {state.step === "error" && (
        <div className="w-full max-w-2xl mx-auto text-center space-y-4">
          <div className="bg-danger/10 rounded-lg p-6">
            <p className="text-danger font-mono text-sm">{state.message}</p>
          </div>
          <button
            onClick={handleRestart}
            className="px-6 py-2 rounded-lg bg-muted hover:bg-border text-sm font-mono transition-colors"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
