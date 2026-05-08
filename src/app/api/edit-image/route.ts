import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { cleanImage, injectExif } from "@/lib/clean-image";
import { reconcile } from "@/lib/silent-ledger";
import { buildEditPrompt } from "@/lib/prompt-engine";
import { getUserApiKey } from "@/lib/get-user-api-key";
import { getSessionUsername } from "@/lib/session";
import type { OCRResult, ReceiptStructure } from "@/types/receipt";

export const runtime = "nodejs";
export const maxDuration = 60;

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
      date: string; // YYYY-MM-DD
      time?: string; // HH:MM
      originalFilename: string;
      originalExif: string | null;
    };

    targetTotalForLog = body.targetTotal;
    dateForLog = body.date;

    if (!body.imageUrl || !body.ocrResult || !body.targetTotal || !body.date) {
      return NextResponse.json(
        { error: "Missing imageUrl, ocrResult, targetTotal, or date" },
        { status: 400 }
      );
    }

    // Reconcile VAT and totals from target
    const ledgerResult = reconcile(body.ocrResult, body.targetTotal);

    // Extract original total from OCR
    const originalTotal = body.ocrResult.items.find(i => i.type === "total")?.value;

    // Build prompt with receipt structure so model knows exactly what it can edit
    const prompt = buildEditPrompt({
      targetTotal: body.targetTotal,
      date: body.date,
      time: body.time,
      originalTotal,
      receiptStructure: body.receiptStructure,
    });

    const base64Data = body.imageUrl.replace(/^data:image\/\w+;base64,/, "");

    // Call Gemini for image editing
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-image-preview",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: base64Data } },
            { text: prompt },
          ],
        },
      ],
      config: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    });

    // Extract the generated image from response
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p: { inlineData?: { data?: string } }) => p.inlineData?.data);
    if (!imagePart?.inlineData?.data) {
      return NextResponse.json({ error: "Gemini did not return an edited image" }, { status: 502 });
    }

    // Clean the result image (strip all AI/Gemini metadata)
    const resultBuffer = Buffer.from(imagePart.inlineData.data, "base64");
    const cleaned = await cleanImage(resultBuffer);

    // Re-inject original camera EXIF so it looks like the original file
    let finalBuffer = cleaned.buffer;
    if (body.originalExif) {
      const exifBuffer = Buffer.from(body.originalExif, "base64");
      finalBuffer = injectExif(finalBuffer, exifBuffer);
    }
    const editedDataUrl = `data:image/jpeg;base64,${finalBuffer.toString("base64")}`;

    // Use original filename (preserve extension, rename if needed)
    const downloadFilename = body.originalFilename || cleaned.filename;

    // Log generate event
    if (username) {
      const supabase = createClient(process.env.leguide_SUPABASE_URL!, process.env.leguide_SUPABASE_SERVICE_ROLE_KEY!);
      await supabase.from("activity_log").insert({
        username,
        action: "generate",
        metadata: { target_total: body.targetTotal, date: body.date },
      });
    }

    // Calculate edit token cost
    const editMeta = response.usageMetadata as Record<string, unknown> | undefined;
    const editInput = Number(editMeta?.promptTokenCount ?? editMeta?.inputTokenCount ?? 0);
    const editOutput = Number(editMeta?.candidatesTokenCount ?? editMeta?.outputTokenCount ?? 0);
    const apiCostUSD = (editInput * 0.15 + editOutput * 0.60) / 1_000_000;

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
