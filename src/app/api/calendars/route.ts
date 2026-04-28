import { NextResponse } from "next/server";
import { google } from "googleapis";
import { getAuthedClient } from "@/lib/google";

export async function GET() {
  try {
    const auth = await getAuthedClient();
    if (!auth) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const calendar = google.calendar({ version: "v3", auth });
    // freeBusyReader includes calendars shared as "see only free/busy".
    // We try events.list first per calendar, then fall back to /freeBusy
    // when we don't have event-detail access (handled in /api/availability).
    const { data } = await calendar.calendarList.list({
      minAccessRole: "freeBusyReader",
      showHidden: true,
      showDeleted: false,
      maxResults: 250,
    });

    const calendars =
      data.items?.map((c) => ({
        id: c.id!,
        summary: c.summaryOverride || c.summary || c.id || "(untitled)",
        description: c.description || "",
        backgroundColor: c.backgroundColor || "#4285F4",
        foregroundColor: c.foregroundColor || "#ffffff",
        primary: Boolean(c.primary),
        accessRole: c.accessRole || "",
        timeZone: c.timeZone || "",
      })) || [];

    calendars.sort((a, b) => {
      if (a.primary && !b.primary) return -1;
      if (!a.primary && b.primary) return 1;
      return a.summary.localeCompare(b.summary);
    });

    return NextResponse.json({ calendars });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/calendars] error:", msg);
    // Google auth errors (expired/revoked token) should be treated as 401
    // so the client re-directs to sign-in rather than showing a generic 500.
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? (err as { code?: number | string }).code
        : undefined;
    const isAuthError =
      code === 401 ||
      code === "401" ||
      msg.toLowerCase().includes("invalid_grant") ||
      msg.toLowerCase().includes("token") ||
      msg.toLowerCase().includes("unauthorized");
    if (isAuthError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
