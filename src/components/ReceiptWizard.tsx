"use client";

import { useReducer } from "react";
import type { PipelineState, OCRResult, EditRequest, LedgerResult } from "@/types/receipt";
import UploadZone from "./UploadZone";
import ReceiptEditor from "./ReceiptEditor";
import FooterActions from "./FooterActions";

type Action =
  | { type: "UPLOAD_START" }
  | { type: "UPLOAD_ERROR"; message: string }
  | { type: "OCR_COMPLETE"; ocrResult: OCRResult; imageUrl: string }
  | { type: "GENERATE_START"; edits: EditRequest[] }
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
      return { step: "editing", ocrResult: action.ocrResult, imageUrl: action.imageUrl };
    case "GENERATE_START":
      return { step: "generating", edits: action.edits };
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
  uploading: "Uploading...",
  processing: "Analyzing receipt...",
  editing: "Edit prices",
  generating: "Generating edited receipt...",
  done: "Done",
  error: "Error",
};

export default function ReceiptWizard() {
  const [state, dispatch] = useReducer(reducer, { step: "idle" });

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
      });
    } catch (err) {
      dispatch({
        type: "UPLOAD_ERROR",
        message: err instanceof Error ? err.message : "Upload failed",
      });
    }
  };

  const handleSubmitEdits = async (edits: EditRequest[]) => {
    if (state.step !== "editing") return;
    const { ocrResult, imageUrl } = state;

    dispatch({ type: "GENERATE_START", edits });

    try {
      const res = await fetch("/api/edit-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl,
          ocrResult,
          edits,
        }),
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
    } catch (err) {
      dispatch({
        type: "ERROR",
        message: err instanceof Error ? err.message : "Generation failed",
      });
    }
  };

  const handleRestart = () => dispatch({ type: "RESTART" });

  // Progress steps
  const steps = ["upload", "analyze", "edit", "generate", "done"];
  const currentStepIndex = {
    idle: 0,
    uploading: 0,
    processing: 1,
    editing: 2,
    generating: 3,
    done: 4,
    error: -1,
  }[state.step];

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

      {/* Editing */}
      {state.step === "editing" && (
        <ReceiptEditor
          ocrResult={state.ocrResult}
          imageUrl={state.imageUrl}
          onSubmitEdits={handleSubmitEdits}
        />
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
              <p className="text-xs text-warning font-mono mb-1">Ledger adjustments:</p>
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
