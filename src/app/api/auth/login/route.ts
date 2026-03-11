import { NextRequest, NextResponse } from "next/server";
import { scryptSync, timingSafeEqual } from "crypto";
import { createClient } from "@supabase/supabase-js";
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
  return false;
}

// ---------------------------------------------------------------------------

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

export async function POST(req: NextRequest) {
  // Rate limit by IP
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429 }
    );
  }

  const { username, password, deviceFingerprint } = await req.json();
  if (!username || !password) {
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
    return res;
  }

  // Check Supabase users table
  const supabase = createClient(
    process.env.leguide_SUPABASE_URL!,
    process.env.leguide_SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: user } = await supabase
    .from("users")
    .select("username, password_hash, salt, device_fingerprint")
    .eq("username", username)
    .maybeSingle();

  if (!user || !verifyPassword(password, user.password_hash, user.salt)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (user.device_fingerprint) {
    if (user.device_fingerprint !== deviceFingerprint) {
      return NextResponse.json(
        { error: "Account locked to a different device" },
        { status: 403 }
      );
    }
  } else if (deviceFingerprint) {
    // First login — lock the account to this device
    await supabase
      .from("users")
      .update({ device_fingerprint: deviceFingerprint })
      .eq("username", username);
  }

  const res = NextResponse.json({ ok: true });
  setSessionCookie(res, username);
  return res;
}
