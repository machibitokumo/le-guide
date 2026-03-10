import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function getSupabase() {
  return createClient(
    process.env.leguide_SUPABASE_URL!,
    process.env.leguide_SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function getUsername(): Promise<string | null> {
  const session = (await cookies()).get("session")?.value;
  if (!session) return null;
  return session.split(".")[0];
}

// GET — return accumulated total for current user
export async function GET() {
  const username = await getUsername();
  if (!username) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await getSupabase()
    .from("user_stats")
    .select("accumulated_total")
    .eq("username", username)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ accumulated_total: Number(data?.accumulated_total ?? 0) });
}

// POST — increment accumulated total by amount
export async function POST(req: Request) {
  const username = await getUsername();
  if (!username) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { amount } = await req.json();
  if (typeof amount !== "number" || amount <= 0) {
    return Response.json({ error: "Invalid amount" }, { status: 400 });
  }

  const supabase = getSupabase();

  // Fetch current value (or 0 if first time)
  const { data: current } = await supabase
    .from("user_stats")
    .select("accumulated_total")
    .eq("username", username)
    .maybeSingle();

  const newTotal = Number(current?.accumulated_total ?? 0) + amount;

  // Upsert with new total
  const { error } = await supabase
    .from("user_stats")
    .upsert(
      { username, accumulated_total: newTotal, updated_at: new Date().toISOString() },
      { onConflict: "username" }
    );

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ accumulated_total: newTotal });
}
