import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { cleanImage, injectExif } from "@/lib/clean-image";
import { reconcile } from "@/lib/silent-ledger";
import { planEdits } from "@/lib/qwen-reason";
import { runVerifyLoop } from "@/lib/verify-loop";
import { buildEditPrompt, buildPlanPrompt } from "@/lib/prompt-engine";
import { getUserApiKey } from "@/lib/get-user-api-key";
import { getSessionUsername } from "@/lib/session";
import type { OCRResult, ReceiptStructure, LedgerResult } from "@/types/receipt";
import type { DocType, EditTarget, EditPlan } from "@/lib/document-types";

export const runtime = "nodejs";
export const maxDuration = 60;

function formatSEK(value: number): string {
  return value.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildTargetMd(args: {
  target: EditTarget;
  ledgerResult: LedgerResult;
  ocrResult: OCRResult;
}): string {
  const { target, ledgerResult, ocrResult } = args;
  const sections: string[] = [];

  // Section helper that mirrors verify-loop's formatActualMd vocabulary so the
  // judge compares like-for-like across kvitto and faktura.
  const push = (heading: string, lines: string[]) => {
    if (lines.length === 0) return;
    sections.push([heading, ...lines.map(l => `- ${l}`)].join("\n"));
  };

  const itemsByType = (type: string) =>
    ocrResult.items.filter(i => i.type === type).map(i => i.text.trim());

  if (target.docType === "faktura") {
    // Faktura: seller block (preserved verbatim from OCR), then editable target fields.
    push("## Seller name",      itemsByType("seller_name"));
    push("## Seller org nr",    itemsByType("seller_org_nr"));
    push("## Seller bankgiro",  itemsByType("seller_bankgiro"));
    push("## Seller plusgiro",  itemsByType("seller_plusgiro"));

    push("## Invoice number",   target.invoiceNumber ? [target.invoiceNumber] : itemsByType("invoice_number"));
    push("## Invoice date",     [target.invoiceDate]);
    push("## Due date",         [target.dueDate]);
    push("## Payment reference", target.paymentReference ? [target.paymentReference] : itemsByType("payment_reference"));
    push("## Customer name",    target.customer?.name ? [target.customer.name] : itemsByType("customer_name"));
    push("## Customer org nr",  target.customer?.orgNr ? [target.customer.orgNr] : itemsByType("customer_org_nr"));
    push("## Customer address", target.customer?.address ? [target.customer.address] : itemsByType("customer_address"));

    push("## Line descriptions", itemsByType("line_description"));
    push("## Line unit prices",  itemsByType("line_unit_price"));
    push("## Line quantities",   itemsByType("line_quantity"));
    push("## Line totals",       itemsByType("line_total"));
  } else {
    push("## Org", itemsByType("org"));
    sections.push(["## Date", `- ${target.time ? `${target.date} ${target.time}` : target.date}`].join("\n"));
    push("## Items",  itemsByType("item"));
    push("## Prices", itemsByType("price"));
  }

  if (ledgerResult.vatBreakdown.length > 0) {
    push("## VAT", ledgerResult.vatBreakdown.map(v => `Moms ${v.rate}%: ${formatSEK(v.vat)}`));
  }

  sections.push(["## Total", `- ${formatSEK(target.total)}`].join("\n"));

  return sections.join("\n\n");
}

export async function POST(req: NextRequest) {
  let targetTotalForLog: number | undefined;
  let dateForLog: string | undefined;
  try {
    const { apiKey, username } = await getUserApiKey();
    const ai = new GoogleGenAI({ apiKey });

    const body = await req.json() as {
      imageUrl: string;
      ocrResult: OCRResult;
      receiptStructure: ReceiptStructure;
      targetTotal: number;
      date: string; // YYYY-MM-DD — for kvitto: transaction date; for faktura: invoice_date
      time?: string; // HH:MM (kvitto only)
      originalFilename: string;
      originalExif: string | null;
      docType?: DocType; // defaults to "kvitto" for backward compat
      // Faktura-specific (ignored for kvitto):
      dueDate?: string;
      invoiceNumber?: string;
      paymentReference?: string;
      customer?: { name?: string; orgNr?: string; address?: string };
    };

    targetTotalForLog = body.targetTotal;
    dateForLog = body.date;

    if (!body.imageUrl || !body.ocrResult || !body.targetTotal || !body.date) {
      return NextResponse.json(
        { error: "Missing imageUrl, ocrResult, targetTotal, or date" },
        { status: 400 }
      );
    }

    const docType: DocType = body.docType ?? "kvitto";
    if (docType === "faktura" && !body.dueDate) {
      return NextResponse.json({ error: "Faktura requires dueDate" }, { status: 400 });
    }

    const target: EditTarget = docType === "faktura"
      ? {
          docType: "faktura",
          total: body.targetTotal,
          invoiceDate: body.date,
          dueDate: body.dueDate!,
          invoiceNumber: body.invoiceNumber,
          paymentReference: body.paymentReference,
          customer: body.customer,
        }
      : {
          docType: "kvitto",
          total: body.targetTotal,
          date: body.date,
          time: body.time,
        };

    // Try the smart planner. On failure, fall back directly to silent-ledger
    // (the deprecated recalculateVAT wrapper just re-calls planEdits, so it
    // would fail identically — skip it).
    let editPlan: EditPlan | null = null;
    let ledgerResult: LedgerResult;
    try {
      editPlan = await planEdits(body.ocrResult, target);
      ledgerResult = {
        adjustedItems: body.ocrResult.items,
        newTotal: body.targetTotal,
        vatBreakdown: editPlan.vatBreakdown,
        warnings: editPlan.warnings,
      };
    } catch (err) {
      console.error("[edit-image] planEdits failed, falling back to silent-ledger:", err);
      ledgerResult = reconcile(body.ocrResult, body.targetTotal);
    }

    const originalTotal = body.ocrResult.items.find(i => i.type === "total")?.value;

    // Plan-based prompt when the planner ran; otherwise the legacy single-shot prompt.
    const initialPrompt = editPlan
      ? buildPlanPrompt({ plan: editPlan, ocrResult: body.ocrResult, target })
      : buildEditPrompt({
          targetTotal: body.targetTotal,
          date: body.date,
          time: body.time,
          originalTotal,
          receiptStructure: body.receiptStructure,
        });

    const base64Data = body.imageUrl.replace(/^data:image\/\w+;base64,/, "");

    const imageModel = process.env.GEMINI_IMAGE_MODEL ?? "gemini-3-pro-image-preview";

    async function generateOnce(
      promptToUse: string,
      imageBase64: string,
    ): Promise<{ image: Buffer; usage: { inputTokens: number; outputTokens: number } }> {
      const response = await ai.models.generateContent({
        model: imageModel,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
              { text: promptToUse },
            ],
          },
        ],
        config: {
          responseModalities: ["TEXT", "IMAGE"],
        },
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find((p: { inlineData?: { data?: string } }) => p.inlineData?.data);
      if (!imagePart?.inlineData?.data) {
        throw new Error("Gemini did not return an edited image");
      }

      const meta = response.usageMetadata as Record<string, unknown> | undefined;
      const inputTokens = Number(meta?.promptTokenCount ?? meta?.inputTokenCount ?? 0);
      const outputTokens = Number(meta?.candidatesTokenCount ?? meta?.outputTokenCount ?? 0);

      return {
        image: Buffer.from(imagePart.inlineData.data, "base64"),
        usage: { inputTokens, outputTokens },
      };
    }

    // First generation (single-shot or seed for verify-loop)
    let first: { image: Buffer; usage: { inputTokens: number; outputTokens: number } };
    try {
      first = await generateOnce(initialPrompt, base64Data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "Gemini did not return an edited image") {
        return NextResponse.json({ error: msg }, { status: 502 });
      }
      throw err;
    }

    let finalRawBuffer: Buffer = first.image;
    const totalUsage = {
      inputTokens: first.usage.inputTokens,
      outputTokens: first.usage.outputTokens,
    };
    let verifyAttempts: number | undefined;
    let verifyVerdict: "PASS" | "FAIL" | undefined;
    let bailedOut: boolean | undefined;
    let targetMdForLog: string | undefined;
    let attemptsLogForDb: Array<{
      attempt: number;
      verdict: "PASS" | "FAIL";
      bailout: boolean;
      diff_summary: string;
      correction: string | null;
      confidence: number;
      actual_md: string;
      reocr_usage: { inputTokens: number; outputTokens: number };
      judge_usage: { inputTokens: number; outputTokens: number };
      generate_usage: { inputTokens: number; outputTokens: number } | null;
    }> | undefined;

    if (process.env.VERIFY_LOOP_ENABLED === "1") {
      const targetMd = buildTargetMd({ target, ledgerResult, ocrResult: body.ocrResult });
      targetMdForLog = targetMd;
      const result = await runVerifyLoop({
        initialImage: first.image,
        targetMd,
        generate: async (correction: string, image: Buffer) => {
          const retryPrompt = `${initialPrompt}\n\nCORRECTION FROM PREVIOUS ATTEMPT:\n${correction}`;
          return generateOnce(retryPrompt, image.toString("base64"));
        },
      });
      finalRawBuffer = result.finalImage;
      verifyAttempts = result.attempts.length;
      verifyVerdict = result.passed ? "PASS" : "FAIL";
      bailedOut = result.bailedOut;
      attemptsLogForDb = result.attempts.map(a => ({
        attempt: a.attempt,
        verdict: a.verdict,
        bailout: a.bailout,
        diff_summary: a.diffSummary,
        correction: a.correction,
        confidence: a.confidence,
        actual_md: a.actualMd,
        reocr_usage: a.reocrUsage,
        judge_usage: a.judgeUsage,
        generate_usage: a.generateUsage ?? null,
      }));
      for (const a of result.attempts) {
        totalUsage.inputTokens +=
          a.reocrUsage.inputTokens + a.judgeUsage.inputTokens + (a.generateUsage?.inputTokens ?? 0);
        totalUsage.outputTokens +=
          a.reocrUsage.outputTokens + a.judgeUsage.outputTokens + (a.generateUsage?.outputTokens ?? 0);
      }
    }

    // Clean the result image (strip all AI/Gemini metadata)
    const cleaned = await cleanImage(finalRawBuffer);

    // Re-inject original camera EXIF so it looks like the original file
    let finalBuffer = cleaned.buffer;
    if (body.originalExif) {
      const exifBuffer = Buffer.from(body.originalExif, "base64");
      finalBuffer = injectExif(finalBuffer, exifBuffer);
    }
    const editedDataUrl = `data:image/jpeg;base64,${finalBuffer.toString("base64")}`;

    // Use original filename (preserve extension, rename if needed)
    const downloadFilename = body.originalFilename || cleaned.filename;

    // Aggregate cost across Gemini image gen + Qwen re-OCR + GPT judge tokens
    // at approximate Gemini-rate pricing — per-model costs will be normalized later.
    const apiCostUSD = (totalUsage.inputTokens * 0.15 + totalUsage.outputTokens * 0.60) / 1_000_000;

    // Log generate event + full debug spår to edit_runs (when verify loop ran).
    if (username) {
      const supabase = createClient(process.env.leguide_SUPABASE_URL!, process.env.leguide_SUPABASE_SERVICE_ROLE_KEY!);
      await supabase.from("activity_log").insert({
        username,
        action: "generate",
        metadata: {
          target_total: body.targetTotal,
          date: body.date,
          doc_type: docType,
          ...(editPlan !== null && {
            operations_count: editPlan.operations.length,
            plan_warnings_count: editPlan.warnings.length,
          }),
          ...(verifyAttempts !== undefined && {
            verify_attempts: verifyAttempts,
            verify_verdict: verifyVerdict,
            bailed_out: bailedOut,
          }),
        },
      });
      if (attemptsLogForDb !== undefined) {
        await supabase.from("edit_runs").insert({
          username,
          doc_type: docType,
          original_filename: body.originalFilename,
          target_total: body.targetTotal,
          target_date: body.date,
          target_time: body.time ?? null,
          edit_plan: editPlan,
          target_md: targetMdForLog ?? null,
          passed: verifyVerdict === "PASS",
          bailed_out: bailedOut ?? false,
          attempts: verifyAttempts ?? 0,
          final_verdict: verifyVerdict ?? null,
          attempts_log: attemptsLogForDb,
          total_input_tokens: totalUsage.inputTokens,
          total_output_tokens: totalUsage.outputTokens,
          total_cost_usd: apiCostUSD,
        });
      }
    }

    return NextResponse.json({
      editedImageUrl: editedDataUrl,
      ledgerResult,
      apiCostUSD,
      downloadFilename,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[edit-image] failed:", err);
    try {
      const username = await getSessionUsername();
      if (username) {
        const supabase = createClient(
          process.env.leguide_SUPABASE_URL!,
          process.env.leguide_SUPABASE_SERVICE_ROLE_KEY!
        );
        await supabase.from("activity_log").insert({
          username,
          action: "generate_error",
          metadata: { error: message, target_total: targetTotalForLog, date: dateForLog },
        });
      }
    } catch (logErr) {
      console.error("[edit-image] failed to log error:", logErr);
    }
    return NextResponse.json({ error: `Image edit failed: ${message}` }, { status: 500 });
  }
}
