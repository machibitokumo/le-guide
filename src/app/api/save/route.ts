import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { getSessionUsername } from "@/lib/session";

export async function POST(req: Request) {
  const username = await getSessionUsername();
  if (!username) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient(
    process.env.leguide_SUPABASE_URL!,
    process.env.leguide_SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    let body: { originalImageUrl?: string; editedImageUrl?: string; targetTotal?: number; date?: string };
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { originalImageUrl, editedImageUrl, targetTotal, date } = body;
    if (!originalImageUrl || !editedImageUrl) {
      return Response.json({ error: "Missing image data" }, { status: 400 });
    }

    const bucket = `receipts-${username.toLowerCase()}`;

    // Ensure bucket exists (no-op if already created)
    await supabase.storage.createBucket(bucket, { public: false }).catch(() => {});
    const id = randomUUID();

    async function uploadBase64(dataUrl: string, suffix: string): Promise<{ path: string | null; error: string | null }> {
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64, "base64");
      const filename = `${date}_${id}_${suffix}.jpg`;
      const { error } = await supabase.storage
        .from(bucket)
        .upload(filename, buffer, { contentType: "image/jpeg", upsert: false });
      return { path: error ? null : filename, error: error?.message ?? null };
    }

    const [originalUp, editedUp] = await Promise.all([
      uploadBase64(originalImageUrl, "original"),
      uploadBase64(editedImageUrl, "edited"),
    ]);

    if (!originalUp.path || !editedUp.path) {
      console.error("[save] storage upload failed:", { original: originalUp.error, edited: editedUp.error });
      await supabase.from("activity_log").insert({
        username,
        action: "save_error",
        metadata: {
          error: originalUp.error ?? editedUp.error ?? "upload returned null",
          original_error: originalUp.error,
          edited_error: editedUp.error,
          target_total: targetTotal,
          date,
        },
      });
      return Response.json({ error: "Storage upload failed" }, { status: 500 });
    }

    // Log save event
    await supabase.from("activity_log").insert({
      username,
      action: "save",
      metadata: { original_path: originalUp.path, edited_path: editedUp.path, target_total: targetTotal, date },
    });

    return Response.json({ ok: true, originalPath: originalUp.path, editedPath: editedUp.path });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[save] failed:", err);
    try {
      await supabase.from("activity_log").insert({
        username,
        action: "save_error",
        metadata: { error: message },
      });
    } catch (logErr) {
      console.error("[save] failed to log error:", logErr);
    }
    return Response.json({ error: `Save failed: ${message}` }, { status: 500 });
  }
}
