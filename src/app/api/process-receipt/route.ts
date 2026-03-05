import { NextRequest, NextResponse } from "next/server";
import { InferenceClient } from "@huggingface/inference";
import { cleanImage, getImageDimensions } from "@/lib/clean-image";
import { buildOCRSystemPrompt } from "@/lib/prompt-engine";
import type { OCRItem, OCRResult } from "@/types/receipt";
import { randomUUID } from "crypto";

const hf = new InferenceClient(process.env.HF_TOKEN ?? "");

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
    const { width, height } = await getImageDimensions(rawBuffer);
    const cleaned = await cleanImage(rawBuffer);

    // Convert to base64 for the vision model
    const base64Image = cleaned.buffer.toString("base64");
    const dataUrl = `data:image/jpeg;base64,${base64Image}`;

    // Call Qwen2.5-VL for OCR via chat completion
    const response = await hf.chatCompletion({
      model: "Qwen/Qwen2.5-VL-7B-Instruct",
      provider: "nebius",
      messages: [
        {
          role: "system",
          content: buildOCRSystemPrompt(),
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: dataUrl },
            },
            {
              type: "text",
              text: "Extract all text from this receipt with bounding boxes. Return ONLY a JSON array.",
            },
          ],
        },
      ],
      max_tokens: 4096,
      temperature: 0.1,
    });

    const rawText = response.choices?.[0]?.message?.content ?? "[]";

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

    // Return OCR result + cleaned image as base64 data URL
    return NextResponse.json({
      ocr: ocrResult,
      imageUrl: dataUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `OCR failed: ${message}` }, { status: 500 });
  }
}
