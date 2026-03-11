import { NextRequest, NextResponse } from "next/server";
import { createHmac, scryptSync } from "crypto";
import { createClient } from "@supabase/supabase-js";

function signToken(username: string): string {
  const sig = createHmac("sha256", process.env.SESSION_SECRET!)
    .update(username)
    .digest("hex");
  return `${username}.${sig}`;
}

function verifyPassword(password: string, hash: string, salt: string): boolean {
  try {
    const derived = scryptSync(password, salt, 64).toString("hex");
    return derived === hash;
  } catch {
    return false;
  }
}

function setSessionCookie(res: NextResponse, username: string) {
  const token = signToken(username);
  res.cookies.set("session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function POST(req: NextRequest) {
  const { username, password, deviceFingerprint } = await req.json();
  if (!username || !password) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // Admin (cloud99) — no device lock
  if (
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
    // Account already locked to a device — reject if fingerprint differs
    if (user.device_fingerprint !== deviceFingerprint) {
      return NextResponse.json(
        { error: "This account is locked to another device" },
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
