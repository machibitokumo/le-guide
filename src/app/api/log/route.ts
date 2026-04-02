import { createClient } from "@supabase/supabase-js";
import { getSessionUsername } from "@/lib/session";

export async function POST(req: Request) {
  const username = await getSessionUsername();
  if (!username) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: { action?: string; metadata?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { action, metadata } = body;
  if (!action) return Response.json({ error: "Missing action" }, { status: 400 });

  const supabase = createClient(
    process.env.leguide_SUPABASE_URL!,
    process.env.leguide_SUPABASE_SERVICE_ROLE_KEY!
  );

  await supabase.from("activity_log").insert({ username, action, metadata: metadata ?? {} });

  return Response.json({ ok: true });
}
