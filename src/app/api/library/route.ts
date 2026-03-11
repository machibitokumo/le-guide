import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export async function GET() {
  const session = (await cookies()).get("session")?.value;
  const username = session?.split(".")[0];
  if (!username) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient(
    process.env.leguide_SUPABASE_URL!,
    process.env.leguide_SUPABASE_SERVICE_ROLE_KEY!
  );

  const bucket = `receipts-${username}`;

  // List files in bucket
  const { data: files, error } = await supabase.storage
    .from(bucket)
    .list("", { sortBy: { column: "created_at", order: "desc" } });

  if (error) return Response.json({ error: error.message }, { status: 500 });
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
