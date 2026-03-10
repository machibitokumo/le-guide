import { cookies } from "next/headers";

export async function GET() {
  const session = (await cookies()).get("session")?.value;
  if (!session) return Response.json({ username: null }, { status: 401 });
  // Session format is "username.hmac" — middleware already verified it
  const username = session.split(".")[0];
  return Response.json({ username });
}
