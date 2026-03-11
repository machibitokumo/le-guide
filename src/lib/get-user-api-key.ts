import { createClient } from "@supabase/supabase-js";
import { getSessionUsername } from "@/lib/session";

/**
 * Returns the Gemini API key for the currently logged-in user.
 * Falls back to the shared env var (used for admin / local dev).
 */
export async function getUserApiKey(): Promise<{ apiKey: string; username: string | null }> {
  const username = await getSessionUsername();

  if (username) {
    const supabase = createClient(
      process.env.leguide_SUPABASE_URL!,
      process.env.leguide_SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data } = await supabase
      .from("users")
      .select("gemini_api_key")
      .eq("username", username)
      .maybeSingle();

    if (data?.gemini_api_key) {
      return { apiKey: data.gemini_api_key, username };
    }
  }

  // Fallback: shared key (admin or env var)
  return { apiKey: process.env.leguide_GEMINI_API_KEY!, username };
}
