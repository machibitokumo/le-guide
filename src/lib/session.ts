import { createHmac } from "crypto";
import { cookies } from "next/headers";

/**
 * Verify an HMAC-signed session token.
 * Returns the username if valid, null otherwise.
 */
export function verifySessionToken(token: string): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;

  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;

  const username = token.slice(0, dot);
  const sigHex = token.slice(dot + 1);

  const expected = createHmac("sha256", secret).update(username).digest("hex");

  // Constant-time comparison — prevent timing oracle
  if (sigHex.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= sigHex.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0 ? username : null;
}

/**
 * Sign a username into a session token.
 */
export function signToken(username: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET environment variable is not set");
  return `${username}.${createHmac("sha256", secret).update(username).digest("hex")}`;
}

/**
 * Read and verify the session cookie from the current request.
 * Returns the authenticated username, or null if missing / invalid.
 */
export async function getSessionUsername(): Promise<string | null> {
  const token = (await cookies()).get("session")?.value;
  return token ? verifySessionToken(token) : null;
}
