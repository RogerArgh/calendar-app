import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { getSession } from "./session";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
];

export function getOAuthClient(): OAuth2Client {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } =
    process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error(
      "Missing Google OAuth env vars. See .env.local.example.",
    );
  }
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
  );
}

export async function getAuthedClient(): Promise<OAuth2Client | null> {
  const session = await getSession();
  if (!session.tokens?.access_token && !session.tokens?.refresh_token) {
    return null;
  }
  const client = getOAuthClient();
  const t = session.tokens;
  client.setCredentials({
    access_token: t.access_token ?? undefined,
    refresh_token: t.refresh_token ?? undefined,
    scope: t.scope ?? undefined,
    token_type: t.token_type ?? undefined,
    expiry_date: t.expiry_date ?? undefined,
  });

  client.on("tokens", async (tokens) => {
    const s = await getSession();
    s.tokens = { ...s.tokens, ...tokens };
    await s.save();
  });

  return client;
}
