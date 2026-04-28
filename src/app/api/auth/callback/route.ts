import { NextRequest, NextResponse } from "next/server";
import { getOAuthClient } from "@/lib/google";
import { getSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/?error=${error}`, req.url));
  }
  if (!code) {
    return NextResponse.redirect(new URL("/?error=missing_code", req.url));
  }

  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);

  const session = await getSession();
  session.tokens = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? session.tokens?.refresh_token,
    scope: tokens.scope,
    token_type: tokens.token_type,
    expiry_date: tokens.expiry_date,
  };
  await session.save();

  return NextResponse.redirect(new URL("/", req.url));
}
