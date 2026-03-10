import { NextRequest, NextResponse } from "next/server";

async function verifySession(token: string): Promise<boolean> {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return false;

  const username = token.slice(0, dot);
  const sigHex = token.slice(dot + 1);

  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const sigBytes = new Uint8Array(sigHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const dataBytes = new TextEncoder().encode(username);

  return crypto.subtle.verify("HMAC", key, sigBytes, dataBytes);
}

export async function middleware(req: NextRequest) {
  const token = req.cookies.get("session")?.value;

  if (!token || !(await verifySession(token))) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
