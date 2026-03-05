import { NextRequest, NextResponse } from "next/server";
import { InferenceClient } from "@huggingface/inference";
import { cleanImage } from "@/lib/clean-image";
import { reconcile } from "@/lib/silent-ledger";
import { buildEditPrompt } from "@/lib/prompt-engine";
import type { OCRResult, EditRequest } from "@/types/receipt";

const hf = new InferenceClient(process.env.HF_TOKEN ?? "");

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

    // Build descriptive prompt for FLUX.1 Kontext
    const prompt = buildEditPrompt(body.edits, ledgerResult);

    // Extract image buffer from data URL
    const base64Data = body.imageUrl.replace(/^data:image\/\w+;base64,/, "");
    const imageBuffer = Buffer.from(base64Data, "base64");
    const imageBlob = new Blob([imageBuffer], { type: "image/jpeg" });

    // Call FLUX.1 Kontext [dev] via fal-ai provider for image editing
    const resultBlob = await hf.imageToImage({
      model: "black-forest-labs/FLUX.1-Kontext-dev",
      provider: "fal-ai",
      inputs: imageBlob,
      parameters: {
        prompt,
        strength: 0.75,
        num_inference_steps: 28,
        guidance_scale: 7.5,
      },
    });

    // Clean the result image (strip EXIF)
    const resultBuffer = Buffer.from(await resultBlob.arrayBuffer());
    const cleaned = await cleanImage(resultBuffer);
    const editedDataUrl = `data:image/jpeg;base64,${cleaned.buffer.toString("base64")}`;

    return NextResponse.json({
      editedImageUrl: editedDataUrl,
      ledgerResult,
      prompt, // for debugging
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Image edit failed: ${message}` }, { status: 500 });
  }
}
