import { NextRequest, NextResponse } from "next/server";
import { cleanImage, getImageDimensions, extractExif, detectFormat } from "@/lib/clean-image";
import { ocrReceipt } from "@/lib/qwen-vl";
import { createClient } from "@supabase/supabase-js";
import { getSessionUsername } from "@/lib/session";
import type { OCRItem, OCRItemType, OCRResult, ReceiptStructure } from "@/types/receipt";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let fileSize: number | undefined;
  let fileType: string | undefined;
  try {
    const username = await getSessionUsername();

    const formData = await req.formData();
    const file = formData.get("receipt") as File | null;
    fileSize = file?.size;
    fileType = file?.type;

    if (!file) {
      return NextResponse.json({ error: "No receipt image provided" }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "File must be an image" }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File must be under 10MB" }, { status: 400 });
    }

    const rawBuffer = Buffer.from(await file.arrayBuffer());

    const format = detectFormat(rawBuffer);
    if (format === "heic") {
      return NextResponse.json(
        {
          error:
            "iPhone HEIC images aren't supported. In Settings → Camera → Formats, choose 'Most Compatible' and retake the photo, or share the receipt as a JPEG.",
        },
        { status: 415 }
      );
    }
    if (format !== "jpeg" && format !== "png") {
      return NextResponse.json(
        { error: "Unsupported image format. Please upload a JPEG or PNG." },
        { status: 415 }
      );
    }

    const [{ width, height }, originalExifBuffer] = await Promise.all([
      getImageDimensions(rawBuffer),
      extractExif(rawBuffer),
    ]);
    const originalFilename = file.name;
    const originalExif = originalExifBuffer ? originalExifBuffer.toString("base64") : null;
    const cleaned = await cleanImage(rawBuffer);

    const base64Image = cleaned.buffer.toString("base64");
    const dataUrl = `data:image/jpeg;base64,${base64Image}`;

    // OCR via Qwen-VL (DashScope). Wrapper normalizes types, clamps bboxes, parses values.
    const qwen = await ocrReceipt(base64Image);

    const items: OCRItem[] = qwen.items.map((item) => ({
      id: randomUUID(),
      text: item.text,
      type: item.type as OCRItemType,
      confidence: item.confidence,
      boundingBox: item.boundingBox,
      value: item.value,
    }));

    const ocrResult: OCRResult = {
      items,
      rawText: qwen.rawText,
      imageWidth: width,
      imageHeight: height,
    };

    const receiptStructure: ReceiptStructure = { items: [] };

    // Cost is APPROXIMATE — formula carried over from Gemini; Qwen pricing differs and will be refined later.
    const apiCostUSD = (qwen.usage.inputTokens * 0.15 + qwen.usage.outputTokens * 0.60) / 1_000_000;

    // Log upload event
    if (username) {
      const supabase = createClient(process.env.leguide_SUPABASE_URL!, process.env.leguide_SUPABASE_SERVICE_ROLE_KEY!);
      await supabase.from("activity_log").insert({
        username,
        action: "upload",
        metadata: {
          file_size: file.size,
          mime_type: file.type,
          image_width: width,
          image_height: height,
          doc_type: qwen.docType,
          classifier_confidence: qwen.classifierConfidence,
        },
      });
    }

    return NextResponse.json({
      ocr: ocrResult,
      receiptStructure,
      imageUrl: dataUrl,
      apiCostUSD,
      originalFilename,
      originalExif,
      docType: qwen.docType,
      classifierConfidence: qwen.classifierConfidence,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[process-receipt] OCR failed:", err);
    try {
      const username = await getSessionUsername();
      if (username) {
        const supabase = createClient(
          process.env.leguide_SUPABASE_URL!,
          process.env.leguide_SUPABASE_SERVICE_ROLE_KEY!
        );
        await supabase.from("activity_log").insert({
          username,
          action: "upload_error",
          metadata: { error: message, file_size: fileSize, mime_type: fileType },
        });
      }
    } catch (logErr) {
      console.error("[process-receipt] failed to log error:", logErr);
    }
    return NextResponse.json({ error: `OCR failed: ${message}` }, { status: 500 });
  }
}
