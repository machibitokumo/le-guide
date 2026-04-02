import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { getSessionUsername } from "@/lib/session";

export async function POST(req: Request) {
  const username = await getSessionUsername();
  if (!username) return Response.json({ error: "Unauthorized" }, { status: 401 });

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

  const supabase = createClient(
    process.env.leguide_SUPABASE_URL!,
    process.env.leguide_SUPABASE_SERVICE_ROLE_KEY!
  );

  const bucket = `receipts-${username.toLowerCase()}`;

  // Ensure bucket exists (no-op if already created)
  await supabase.storage.createBucket(bucket, { public: false }).catch(() => {});
  const id = randomUUID();

  async function uploadBase64(dataUrl: string, suffix: string): Promise<string | null> {
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64, "base64");
    const filename = `${date}_${id}_${suffix}.jpg`;
    const { error } = await supabase.storage
      .from(bucket)
      .upload(filename, buffer, { contentType: "image/jpeg", upsert: false });
    return error ? null : filename;
  }

  const [originalPath, editedPath] = await Promise.all([
    uploadBase64(originalImageUrl, "original"),
    uploadBase64(editedImageUrl, "edited"),
  ]);

  // Log save event
  await supabase.from("activity_log").insert({
    username,
    action: "save",
    metadata: { original_path: originalPath, edited_path: editedPath, target_total: targetTotal, date },
  });

  return Response.json({ ok: true, originalPath, editedPath });
}
