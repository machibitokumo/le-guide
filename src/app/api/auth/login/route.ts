import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

function signToken(username: string): string {
  const sig = createHmac("sha256", process.env.SESSION_SECRET!)
    .update(username)
    .digest("hex");
  return `${username}.${sig}`;
}

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  if (
    username !== process.env.ADMIN_USERNAME ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = signToken(username);
  const res = NextResponse.json({ ok: true });

  res.cookies.set("session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  return res;
}
