import { createClient } from "@supabase/supabase-js";
import { getSessionUsername } from "@/lib/session";

function getSupabase() {
  return createClient(
    process.env.leguide_SUPABASE_URL!,
    process.env.leguide_SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET — return accumulated total for current user
export async function GET() {
  const username = await getSessionUsername();
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
  const username = await getSessionUsername();
  if (!username) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: { amount?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { amount } = body;
  if (typeof amount !== "number" || amount <= 0) {
    return Response.json({ error: "Invalid amount" }, { status: 400 });
  }

  const supabase = getSupabase();

  // Atomic increment via upsert — avoids read-then-write race condition
  // First try to increment existing row
  const { data: updated, error: updateErr } = await supabase.rpc("increment_user_stat", {
    p_username: username,
    p_amount: amount,
  });

  if (updateErr) {
    // Fallback: if the RPC doesn't exist, use the old upsert approach
    const { data: current } = await supabase
      .from("user_stats")
      .select("accumulated_total")
      .eq("username", username)
      .maybeSingle();

    const newTotal = Number(current?.accumulated_total ?? 0) + amount;

    const { error } = await supabase
      .from("user_stats")
      .upsert(
        { username, accumulated_total: newTotal, updated_at: new Date().toISOString() },
        { onConflict: "username" }
      );

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ accumulated_total: newTotal });
  }

  return Response.json({ accumulated_total: updated });
}
