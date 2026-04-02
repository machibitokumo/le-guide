import { getSessionUsername } from "@/lib/session";

export async function GET() {
  const username = await getSessionUsername();
  if (!username) return Response.json({ username: null }, { status: 401 });
  return Response.json({ username });
}
