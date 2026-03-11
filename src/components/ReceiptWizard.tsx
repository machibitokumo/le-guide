"use client";

import { useReducer, useState, useRef, useEffect } from "react";
import type { PipelineState, OCRResult, LedgerResult, ReceiptStructure } from "@/types/receipt";
import UploadZone from "./UploadZone";
import FooterActions from "./FooterActions";
import PixelLoader from "./PixelLoader";

type Action =
  | { type: "UPLOAD_START" }
  | { type: "UPLOAD_ERROR"; message: string }
  | { type: "OCR_COMPLETE"; ocrResult: OCRResult; imageUrl: string; receiptStructure: ReceiptStructure; originalFilename: string; originalExif: string | null }
  | { type: "GENERATE_START"; targetTotal: number; date: string; originalFilename: string; originalExif: string | null }
  | { type: "GENERATE_COMPLETE"; editedImageUrl: string; ledgerResult: LedgerResult; originalImageUrl: string; targetTotal: number; date: string; downloadFilename: string }
  | { type: "ERROR"; message: string }
  | { type: "RESTART" }
  | { type: "SET_SAVED" };

function reducer(state: PipelineState, action: Action): PipelineState {
  switch (action.type) {
    case "UPLOAD_START":
      return { step: "uploading" };
    case "UPLOAD_ERROR":
      return { step: "error", message: action.message, previousStep: "idle" };
    case "OCR_COMPLETE":
      return { step: "targeting", ocrResult: action.ocrResult, imageUrl: action.imageUrl, receiptStructure: action.receiptStructure, originalFilename: action.originalFilename, originalExif: action.originalExif };
    case "GENERATE_START":
      return { step: "generating", targetTotal: action.targetTotal, date: action.date, originalFilename: action.originalFilename, originalExif: action.originalExif };
    case "GENERATE_COMPLETE":
      return {
        step: "done",
        editedImageUrl: action.editedImageUrl,
        ledgerResult: action.ledgerResult,
        originalImageUrl: action.originalImageUrl,
        targetTotal: action.targetTotal,
        date: action.date,
        downloadFilename: action.downloadFilename,
        saved: false,
      };
    case "ERROR":
      return { step: "error", message: action.message };
    case "SET_SAVED":
      if (state.step !== "done") return state;
      return { ...state, saved: true };
    case "RESTART":
      return { step: "idle" };
    default:
      return state;
  }
}

const STEP_LABELS: Record<string, string> = {
  idle: "",
  uploading: "Analyzing receipt...",
  targeting: "Set target",
  generating: "Generating edited receipt...",
  done: "Done",
  error: "Error",
};

interface ReceiptWizardProps {
  onGenerated?: (targetTotal: number, apiCostUSD: number) => void;
}

export default function ReceiptWizard({ onGenerated }: ReceiptWizardProps) {
  const [state, dispatch] = useReducer(reducer, { step: "idle" });
  const [targetTotal, setTargetTotal] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  });
  const [saving, setSaving] = useState(false);
  const [loaderPhase, setLoaderPhase] = useState<"off" | "loading" | "done">("off");
  const ocrCostRef = useRef(0);

  const isLoading = state.step === "uploading" || state.step === "generating";

  // Drive loader phase from step transitions
  useEffect(() => {
    if (isLoading) {
      setLoaderPhase("loading");
    } else if (loaderPhase === "loading") {
      setLoaderPhase("done");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

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
      ocrCostRef.current = data.apiCostUSD ?? 0;
      dispatch({
        type: "OCR_COMPLETE",
        ocrResult: data.ocr,
        imageUrl: data.imageUrl,
        receiptStructure: data.receiptStructure,
        originalFilename: data.originalFilename ?? file.name,
        originalExif: data.originalExif ?? null,
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

    const { ocrResult, imageUrl, receiptStructure, originalFilename, originalExif } = state;
    dispatch({ type: "GENERATE_START", targetTotal: total, date, originalFilename, originalExif });

    try {
      const res = await fetch("/api/edit-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, ocrResult, receiptStructure, targetTotal: total, date, time, originalFilename, originalExif }),
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
        targetTotal: total,
        date,
        downloadFilename: data.downloadFilename ?? originalFilename,
      });
      onGenerated?.(total, ocrCostRef.current + (data.apiCostUSD ?? 0));
    } catch (err) {
      dispatch({
        type: "ERROR",
        message: err instanceof Error ? err.message : "Generation failed",
      });
    }
  };

  const handleSave = async () => {
    if (state.step !== "done" || state.saved || saving) return;
    setSaving(true);
    try {
      await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalImageUrl: state.originalImageUrl,
          editedImageUrl: state.editedImageUrl,
          targetTotal: state.targetTotal,
          date: state.date,
        }),
      });
      dispatch({ type: "SET_SAVED" });
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = async () => {
    await fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "discard" }),
    });
    handleRestart();
  };

  const handleRestart = () => {
    setTargetTotal("");
    setDate(new Date().toISOString().slice(0, 10));
    const now = new Date();
    setTime(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
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

      {/* Pixel loader */}
      {loaderPhase !== "off" && (
        <div className="flex flex-col items-center gap-3 py-8">
          <PixelLoader
            done={loaderPhase === "done"}
            onExplodeDone={() => setLoaderPhase("off")}
          />
          {loaderPhase === "loading" && (
            <p className="text-xs text-foreground/40 font-mono animate-pulse">
              {state.step === "uploading" ? "Analyzing receipt..." : "Generating edited image..."}
            </p>
          )}
        </div>
      )}

      {/* Idle → Upload */}
      {state.step === "idle" && (
        <UploadZone onUpload={handleUpload} />
      )}

      {/* Targeting */}
      {state.step === "targeting" && loaderPhase === "off" && (
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
            <div className="grid grid-cols-2 gap-3">
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
              <div>
                <label className="block text-xs text-foreground/50 font-mono mb-1">
                  Time
                </label>
                <input
                  type="time"
                  value={time}
                  onChange={e => setTime(e.target.value)}
                  className="w-full bg-muted border border-border rounded-lg px-4 py-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
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
      {state.step === "done" && loaderPhase === "off" && (
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

          {!state.saved ? (
            <div className="w-full max-w-2xl mx-auto flex gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-3 rounded-lg bg-accent text-background text-sm font-mono font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                {saving ? "Saving..." : "Save to Library"}
              </button>
              <button
                onClick={handleDiscard}
                disabled={saving}
                className="flex-1 py-3 rounded-lg bg-danger/20 hover:bg-danger/30 text-danger text-sm font-mono transition-colors disabled:opacity-40"
              >
                Discard
              </button>
            </div>
          ) : (
            <div className="w-full max-w-2xl mx-auto">
              <p className="text-center text-xs text-foreground/40 font-mono">Saved to Library</p>
            </div>
          )}

          <FooterActions
            editedImageUrl={state.editedImageUrl}
            ledgerResult={state.ledgerResult}
            onRestart={handleRestart}
            downloadFilename={state.downloadFilename}
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
