import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

// Admin-only: clear device fingerprint so a user can log in from a new device
export async function POST(req: Request) {
  const session = (await cookies()).get("session")?.value;
  const callerUsername = session?.split(".")[0];

  if (callerUsername !== process.env.ADMIN_USERNAME) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { username } = await req.json();
  if (!username) return Response.json({ error: "Missing username" }, { status: 400 });

  const supabase = createClient(
    process.env.leguide_SUPABASE_URL!,
    process.env.leguide_SUPABASE_SERVICE_ROLE_KEY!
  );

  await supabase
    .from("users")
    .update({ device_fingerprint: null })
    .eq("username", username);

  return Response.json({ ok: true, message: `Device reset for ${username}` });
}
