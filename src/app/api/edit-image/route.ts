import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { cleanImage } from "@/lib/clean-image";
import { reconcile } from "@/lib/silent-ledger";
import { buildEditPrompt } from "@/lib/prompt-engine";
import type { OCRResult, EditRequest } from "@/types/receipt";

if (!process.env.leguide_GEMINI_API_KEY) {
  throw new Error("leguide_GEMINI_API_KEY environment variable is not set");
}
const ai = new GoogleGenAI({ apiKey: process.env.leguide_GEMINI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      imageUrl: string; // base64 data URL
      ocrResult: OCRResult;
      edits: EditRequest[];
    };

    if (!body.imageUrl || !body.ocrResult || !body.edits?.length) {
      return NextResponse.json(
        { error: "Missing imageUrl, ocrResult, or edits" },
        { status: 400 }
      );
    }

    // Run Silent Ledger reconciliation
    const ledgerResult = reconcile(body.ocrResult, body.edits);

    // Build descriptive prompt for Gemini image editing
    const prompt = buildEditPrompt(body.edits, ledgerResult);

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

    // Clean the result image (strip EXIF)
    const resultBuffer = Buffer.from(imagePart.inlineData.data, "base64");
    const cleaned = await cleanImage(resultBuffer);
    const editedDataUrl = `data:image/jpeg;base64,${cleaned.buffer.toString("base64")}`;

    return NextResponse.json({
      editedImageUrl: editedDataUrl,
      ledgerResult,
      prompt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Image edit failed: ${message}` }, { status: 500 });
  }
}
