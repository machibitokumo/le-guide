import { NextRequest, NextResponse } from "next/server";
import { scryptSync, timingSafeEqual } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { signToken } from "@/lib/session";

const rateStore = new Map<string, number[]>();
const RATE_MAX = 10;
const RATE_WINDOW_MS = 15 * 60 * 1000;

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const attempts = (rateStore.get(key) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  if (attempts.length >= RATE_MAX) return true;
  attempts.push(now);
  rateStore.set(key, attempts);

  if (rateStore.size > 50) {
    for (const [k, v] of rateStore) {
      const live = v.filter(t => now - t < RATE_WINDOW_MS);
      if (live.length === 0) rateStore.delete(k);
      else rateStore.set(k, live);
    }
  }

  return false;
}

function verifyPassword(password: string, hash: string, salt: string): boolean {
  try {
    const derived = scryptSync(password, salt, 64);
    return timingSafeEqual(derived, Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}

function setSessionCookie(res: NextResponse, username: string) {
  res.cookies.set("session", signToken(username), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

function getSupabase(): SupabaseClient {
  return createClient(
    process.env.leguide_SUPABASE_URL!,
    process.env.leguide_SUPABASE_SERVICE_ROLE_KEY!
  );
}

function deviceInfo(req: NextRequest, ip: string): Record<string, unknown> {
  return {
    ip,
    user_agent: req.headers.get("user-agent") ?? null,
    accept_language: req.headers.get("accept-language") ?? null,
    sec_ch_ua: req.headers.get("sec-ch-ua") ?? null,
    sec_ch_ua_mobile: req.headers.get("sec-ch-ua-mobile") ?? null,
    sec_ch_ua_platform: req.headers.get("sec-ch-ua-platform") ?? null,
    referer: req.headers.get("referer") ?? null,
  };
}

async function logLogin(
  supabase: SupabaseClient,
  username: string,
  action: "login_success" | "login_fail",
  metadata: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from("activity_log")
    .insert({ username, action, metadata });
  if (error) console.error("[login] activity_log insert failed:", error.message);
}

export async function POST(req: NextRequest) {
  const supabase = getSupabase();

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const device = deviceInfo(req, ip);

  if (isRateLimited(ip)) {
    await logLogin(supabase, "(unknown)", "login_fail", { ...device, reason: "rate_limited" });
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429 }
    );
  }

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    await logLogin(supabase, "(unknown)", "login_fail", { ...device, reason: "bad_request" });
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { username, password } = body;
  if (!username || !password) {
    await logLogin(supabase, username ?? "(unknown)", "login_fail", { ...device, reason: "missing_fields" });
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (
    process.env.ADMIN_USERNAME &&
    process.env.ADMIN_PASSWORD &&
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    const res = NextResponse.json({ ok: true });
    setSessionCookie(res, username);
    await logLogin(supabase, username, "login_success", { ...device, admin: true });
    return res;
  }

  const { data: user } = await supabase
    .from("users")
    .select("username, password_hash, salt")
    .eq("username", username)
    .maybeSingle();

  if (!user) {
    await logLogin(supabase, username, "login_fail", { ...device, reason: "no_user" });
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  if (!verifyPassword(password, user.password_hash, user.salt)) {
    await logLogin(supabase, username, "login_fail", { ...device, reason: "wrong_password" });
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  setSessionCookie(res, username);
  await logLogin(supabase, username, "login_success", device);
  return res;
}
