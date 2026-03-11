import { createClient } from "@supabase/supabase-js";
import { getSessionUsername } from "@/lib/session";

export async function GET() {
  const username = await getSessionUsername();
  if (!username) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient(
    process.env.leguide_SUPABASE_URL!,
    process.env.leguide_SUPABASE_SERVICE_ROLE_KEY!
  );

  const bucket = `receipts-${username.toLowerCase()}`;

  // Ensure bucket exists
  await supabase.storage.createBucket(bucket, { public: false }).catch(() => {});

  // List files in bucket
  const { data: files, error } = await supabase.storage
    .from(bucket)
    .list("", { sortBy: { column: "created_at", order: "desc" } });

  if (error) return Response.json({ receipts: [] });
  if (!files?.length) return Response.json({ receipts: [] });

  // Generate signed URLs (valid 1 hour)
  const { data: signed } = await supabase.storage
    .from(bucket)
    .createSignedUrls(files.map(f => f.name), 3600);

  const receipts = (signed ?? []).map((s, i) => ({
    name: files[i].name,
    url: s.signedUrl,
    created_at: files[i].created_at,
  }));

  return Response.json({ receipts });
}
