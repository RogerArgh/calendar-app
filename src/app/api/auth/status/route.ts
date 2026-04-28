import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  return NextResponse.json({
    authed: Boolean(session.tokens?.access_token || session.tokens?.refresh_token),
  });
}
