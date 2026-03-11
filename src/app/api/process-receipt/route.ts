import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { cleanImage, getImageDimensions, extractExif } from "@/lib/clean-image";
import { buildOCRSystemPrompt } from "@/lib/prompt-engine";
import { analyzeReceiptStructure } from "@/lib/receipt-analyzer";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { OCRItem, OCRResult } from "@/types/receipt";
import { randomUUID } from "crypto";

if (!process.env.leguide_GEMINI_API_KEY) {
  throw new Error("leguide_GEMINI_API_KEY environment variable is not set");
}
const ai = new GoogleGenAI({ apiKey: process.env.leguide_GEMINI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("receipt") as File | null;

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
    const [{ width, height }, originalExifBuffer] = await Promise.all([
      getImageDimensions(rawBuffer),
      extractExif(rawBuffer),
    ]);
    const originalFilename = file.name;
    const originalExif = originalExifBuffer ? originalExifBuffer.toString("base64") : null;
    const cleaned = await cleanImage(rawBuffer);

    const base64Image = cleaned.buffer.toString("base64");
    const dataUrl = `data:image/jpeg;base64,${base64Image}`;

    // Call Gemini 2.0 Flash for OCR
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: buildOCRSystemPrompt() },
            { inlineData: { mimeType: "image/jpeg", data: base64Image } },
            { text: "Extract all text from this receipt with bounding boxes. Return ONLY a JSON array." },
          ],
        },
      ],
    });

    const rawText = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";

    // Parse the JSON response — strip markdown fences if present
    let jsonStr = rawText.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    let parsedItems: Array<{
      text: string;
      type: string;
      confidence: number;
      boundingBox: { x: number; y: number; width: number; height: number };
      value?: number;
    }>;

    try {
      parsedItems = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json({
        error: "Failed to parse OCR response",
        raw: rawText,
      }, { status: 502 });
    }

    const items: OCRItem[] = parsedItems.map((item) => ({
      id: randomUUID(),
      text: item.text,
      type: (item.type as OCRItem["type"]) || "unknown",
      confidence: item.confidence ?? 0.5,
      boundingBox: {
        x: Math.max(0, Math.min(1, item.boundingBox?.x ?? 0)),
        y: Math.max(0, Math.min(1, item.boundingBox?.y ?? 0)),
        width: Math.max(0, Math.min(1, item.boundingBox?.width ?? 0.1)),
        height: Math.max(0, Math.min(1, item.boundingBox?.height ?? 0.03)),
      },
      value: item.value,
    }));

    const ocrResult: OCRResult = {
      items,
      rawText,
      imageWidth: width,
      imageHeight: height,
    };

    const { structure: receiptStructure, tokenCostUSD: analyzerCostUSD } = await analyzeReceiptStructure(ocrResult);

    // Calculate OCR token cost
    const ocrMeta = response.usageMetadata as Record<string, unknown> | undefined;
    const ocrInput = Number(ocrMeta?.promptTokenCount ?? ocrMeta?.inputTokenCount ?? 0);
    const ocrOutput = Number(ocrMeta?.candidatesTokenCount ?? ocrMeta?.outputTokenCount ?? 0);
    const ocrCostUSD = (ocrInput * 0.15 + ocrOutput * 0.60) / 1_000_000;
    const apiCostUSD = ocrCostUSD + analyzerCostUSD;

    // Log upload event
    const session = (await cookies()).get("session")?.value;
    const username = session?.split(".")[0];
    if (username) {
      const supabase = createClient(process.env.leguide_SUPABASE_URL!, process.env.leguide_SUPABASE_SERVICE_ROLE_KEY!);
      await supabase.from("activity_log").insert({
        username,
        action: "upload",
        metadata: { file_size: file.size, mime_type: file.type, image_width: width, image_height: height },
      });
    }

    // Return OCR result + structure + cleaned image + original file identity
    return NextResponse.json({
      ocr: ocrResult,
      receiptStructure,
      imageUrl: dataUrl,
      apiCostUSD,
      originalFilename,
      originalExif,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `OCR failed: ${message}` }, { status: 500 });
  }
}
