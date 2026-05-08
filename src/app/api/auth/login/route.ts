import { NextRequest, NextResponse } from "next/server";
import { scryptSync, timingSafeEqual, randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { signToken } from "@/lib/session";

// ---------------------------------------------------------------------------
// Rate limiter — best-effort in serverless; protects within a single instance
// ---------------------------------------------------------------------------
const rateStore = new Map<string, number[]>();
const RATE_MAX = 10;
const RATE_WINDOW_MS = 15 * 60 * 1000;

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const attempts = (rateStore.get(key) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  if (attempts.length >= RATE_MAX) return true;
  attempts.push(now);
  rateStore.set(key, attempts);

  // Prune expired keys periodically (every 50 calls)
  if (rateStore.size > 50) {
    for (const [k, v] of rateStore) {
      const live = v.filter(t => now - t < RATE_WINDOW_MS);
      if (live.length === 0) rateStore.delete(k);
      else rateStore.set(k, live);
    }
  }

  return false;
}

// ---------------------------------------------------------------------------

const DEVICE_COOKIE = "device_id";
const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 2; // 2 years

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

function setDeviceCookie(res: NextResponse, deviceId: string) {
  res.cookies.set(DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: DEVICE_COOKIE_MAX_AGE,
  });
}

function getSupabase(): SupabaseClient {
  return createClient(
    process.env.leguide_SUPABASE_URL!,
    process.env.leguide_SUPABASE_SERVICE_ROLE_KEY!
  );
}

function logLogin(
  supabase: SupabaseClient,
  username: string,
  action: "login_success" | "login_fail",
  metadata: Record<string, unknown>
) {
  supabase
    .from("activity_log")
    .insert({ username, action, metadata })
    .then(({ error }) => {
      if (error) console.error("[login] activity_log insert failed:", error.message);
    });
}

export async function POST(req: NextRequest) {
  const supabase = getSupabase();

  // Rate limit by IP
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (isRateLimited(ip)) {
    logLogin(supabase, "(unknown)", "login_fail", { reason: "rate_limited", ip });
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429 }
    );
  }

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    logLogin(supabase, "(unknown)", "login_fail", { reason: "bad_request", ip });
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { username, password } = body;
  if (!username || !password) {
    logLogin(supabase, username ?? "(unknown)", "login_fail", { reason: "missing_fields", ip });
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // Admin — no device lock; requires env vars to be explicitly set
  if (
    process.env.ADMIN_USERNAME &&
    process.env.ADMIN_PASSWORD &&
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    const res = NextResponse.json({ ok: true });
    setSessionCookie(res, username);
    logLogin(supabase, username, "login_success", { admin: true, ip });
    return res;
  }

  // Check Supabase users table
  const { data: user } = await supabase
    .from("users")
    .select("username, password_hash, salt, device_fingerprint")
    .eq("username", username)
    .maybeSingle();

  if (!user) {
    logLogin(supabase, username, "login_fail", { reason: "no_user", ip });
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  if (!verifyPassword(password, user.password_hash, user.salt)) {
    logLogin(supabase, username, "login_fail", { reason: "wrong_password", ip });
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const deviceCookie = req.cookies.get(DEVICE_COOKIE)?.value ?? null;

  if (user.device_fingerprint) {
    // Locked account — cookie must match the stored token exactly.
    if (!deviceCookie || deviceCookie !== user.device_fingerprint) {
      logLogin(supabase, username, "login_fail", {
        reason: "locked",
        ip,
        had_device_cookie: deviceCookie != null,
      });
      return NextResponse.json(
        { error: "Account locked to a different device" },
        { status: 403 }
      );
    }
    const res = NextResponse.json({ ok: true });
    setSessionCookie(res, username);
    logLogin(supabase, username, "login_success", { ip });
    return res;
  }

  // First login (or admin-reset) — mint a new device token and lock to it.
  const newDeviceId = randomUUID();
  await supabase
    .from("users")
    .update({ device_fingerprint: newDeviceId })
    .eq("username", username);

  const res = NextResponse.json({ ok: true });
  setSessionCookie(res, username);
  setDeviceCookie(res, newDeviceId);
  logLogin(supabase, username, "login_success", { ip, first_login: true });
  return res;
}
