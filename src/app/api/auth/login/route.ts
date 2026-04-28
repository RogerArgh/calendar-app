import { NextResponse } from "next/server";
import { getOAuthClient, GOOGLE_SCOPES } from "@/lib/google";

export async function GET() {
  const client = getOAuthClient();
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
  });
  return NextResponse.redirect(url);
}
