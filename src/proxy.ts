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

  const hexPairs = sigHex.match(/.{2}/g);
  if (!hexPairs) return false;
  const sigBytes = new Uint8Array(hexPairs.map(b => parseInt(b, 16)));
  const dataBytes = new TextEncoder().encode(username);

  return crypto.subtle.verify("HMAC", key, sigBytes, dataBytes);
}

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Auth routes are always public
  if (path.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  const token = req.cookies.get("session")?.value;
  const valid = token && (await verifySession(token));

  if (!valid) {
    // API routes → JSON 401, not a redirect
    if (path.startsWith("/api/")) {
      return new NextResponse(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/api/:path*"],
};
