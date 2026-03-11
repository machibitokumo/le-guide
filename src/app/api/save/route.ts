import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";

export async function POST(req: Request) {
  const session = (await cookies()).get("session")?.value;
  const username = session?.split(".")[0];
  if (!username) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { originalImageUrl, editedImageUrl, targetTotal, date } = await req.json();

  const supabase = createClient(
    process.env.leguide_SUPABASE_URL!,
    process.env.leguide_SUPABASE_SERVICE_ROLE_KEY!
  );

  const bucket = `receipts-${username}`;
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
