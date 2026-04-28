import { NextRequest, NextResponse } from "next/server";
import { getAuthedClient } from "@/lib/google";
import { computeAvailability } from "@/lib/availability";

export async function POST(req: NextRequest) {
  let auth;
  try {
    auth = await getAuthedClient();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/availability] auth error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  if (!auth) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const body = await req.json();
  const {
    calendarIds,
    timeMin,
    timeMax,
    timeZone,
    workStartHour,
    workEndHour,
    workDays,
    minSlotMinutes,
    excludeTransparent,
    snapToHalfHour,
  } = body;

  if (!Array.isArray(calendarIds) || calendarIds.length === 0) {
    return NextResponse.json(
      { error: "calendarIds required" },
      { status: 400 },
    );
  }

  try {
    const result = await computeAvailability(auth, {
      calendarIds,
      timeMin: new Date(timeMin),
      timeMax: new Date(timeMax),
      timeZone: timeZone || "UTC",
      workStartHour: Number(workStartHour ?? 9),
      workEndHour: Number(workEndHour ?? 18),
      workDays: Array.isArray(workDays) ? workDays : [1, 2, 3, 4, 5],
      minSlotMinutes: Number(minSlotMinutes ?? 30),
      excludeTransparent: excludeTransparent !== false,
      snapToHalfHour: Boolean(snapToHalfHour),
    });

    return NextResponse.json({
      days: result.days.map((d) => ({
        date: d.date,
        workWindow: {
          start: d.workWindow.start.toISOString(),
          end: d.workWindow.end.toISOString(),
        },
        freeSlots: d.freeSlots.map((s) => ({
          start: s.start.toISOString(),
          end: s.end.toISOString(),
        })),
      })),
      debug: result.debug,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/availability] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
