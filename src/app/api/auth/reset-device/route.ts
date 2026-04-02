import { createClient } from "@supabase/supabase-js";
import { getSessionUsername } from "@/lib/session";

// Admin-only: clear device fingerprint so a user can log in from a new device
export async function POST(req: Request) {
  const caller = await getSessionUsername();

  if (caller !== process.env.ADMIN_USERNAME) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { username?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { username } = body;
  if (!username) return Response.json({ error: "Missing username" }, { status: 400 });

  const supabase = createClient(
    process.env.leguide_SUPABASE_URL!,
    process.env.leguide_SUPABASE_SERVICE_ROLE_KEY!
  );

  await supabase
    .from("users")
    .update({ device_fingerprint: null })
    .eq("username", username);

  return Response.json({ ok: true });
}
