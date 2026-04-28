import { google, calendar_v3 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

export type Interval = { start: Date; end: Date };

export type AvailabilityInput = {
  calendarIds: string[];
  timeMin: Date;
  timeMax: Date;
  timeZone: string;
  workStartHour: number; // 0-24, decimal allowed (e.g. 9.5 = 9:30)
  workEndHour: number;
  workDays: number[]; // 0=Sunday..6=Saturday
  minSlotMinutes: number;
  excludeTransparent: boolean;
  snapToHalfHour: boolean;
};

export type DayAvailability = {
  date: string; // YYYY-MM-DD in the requested timezone
  workWindow: Interval;
  freeSlots: Interval[];
};

export type AvailabilityDebug = {
  perCalendar: Array<{
    calendarId: string;
    fetchKind: "events" | "freeBusy";
    totalFetched: number;
    skippedTransparent: number;
    skippedDeclined: number;
    counted: number;
  }>;
  totalBusyIntervals: number;
};

type FetchResult =
  | { kind: "events"; events: calendar_v3.Schema$Event[] }
  | { kind: "freeBusy"; intervals: Interval[] };

async function fetchEventsForCalendar(
  auth: OAuth2Client,
  calendarId: string,
  timeMin: Date,
  timeMax: Date,
  timeZone: string,
): Promise<FetchResult> {
  const calendar = google.calendar({ version: "v3", auth });
  try {
    const all: calendar_v3.Schema$Event[] = [];
    let pageToken: string | undefined;
    do {
      const { data } = await calendar.events.list({
        calendarId,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 2500,
        timeZone,
        pageToken,
        showDeleted: false,
      });
      if (data.items) all.push(...data.items);
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
    return { kind: "events", events: all };
  } catch (err: unknown) {
    // freeBusyReader-only calendars return 403 from events.list.
    // Fall back to /freeBusy which only needs free/busy access.
    const status =
      typeof err === "object" && err !== null && "code" in err
        ? (err as { code?: number }).code
        : undefined;
    if (status !== 403 && status !== 401) {
      console.error(`events.list failed for ${calendarId}:`, err);
    }
    const { data } = await calendar.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        timeZone,
        items: [{ id: calendarId }],
      },
    });
    const busy = data.calendars?.[calendarId]?.busy ?? [];
    const intervals: Interval[] = [];
    for (const b of busy) {
      if (b.start && b.end) {
        intervals.push({ start: new Date(b.start), end: new Date(b.end) });
      }
    }
    return { kind: "freeBusy", intervals };
  }
}

function eventToInterval(
  e: calendar_v3.Schema$Event,
  timeZone: string,
): Interval | null {
  // All-day events use .date (YYYY-MM-DD), timed events use .dateTime.
  let start: Date;
  let end: Date;
  if (e.start?.dateTime && e.end?.dateTime) {
    start = new Date(e.start.dateTime);
    end = new Date(e.end.dateTime);
  } else if (e.start?.date && e.end?.date) {
    // All-day: interpret the YYYY-MM-DD in the requested timezone.
    start = fromZonedTime(`${e.start.date}T00:00:00`, timeZone);
    end = fromZonedTime(`${e.end.date}T00:00:00`, timeZone);
  } else {
    return null;
  }
  if (end <= start) return null;
  return { start, end };
}

function userDeclined(e: calendar_v3.Schema$Event): boolean {
  const attendees = e.attendees;
  if (!attendees) return false;
  const self = attendees.find((a) => a.self);
  return self?.responseStatus === "declined";
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  const out: Interval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      if (cur.end > last.end) last.end = cur.end;
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

function subtract(window: Interval, busy: Interval[]): Interval[] {
  const relevant = busy
    .filter((b) => b.end > window.start && b.start < window.end)
    .map((b) => ({
      start: b.start < window.start ? window.start : b.start,
      end: b.end > window.end ? window.end : b.end,
    }));
  const merged = mergeIntervals(relevant);
  const free: Interval[] = [];
  let cursor = window.start;
  for (const b of merged) {
    if (b.start > cursor) free.push({ start: cursor, end: b.start });
    if (b.end > cursor) cursor = b.end;
  }
  if (cursor < window.end) free.push({ start: cursor, end: window.end });
  return free;
}

function toDateKey(d: Date, timeZone: string): string {
  const zoned = toZonedTime(d, timeZone);
  const y = zoned.getFullYear();
  const m = String(zoned.getMonth() + 1).padStart(2, "0");
  const day = String(zoned.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function workWindowForDate(
  dateKey: string,
  startHour: number,
  endHour: number,
  timeZone: string,
): Interval {
  const startH = Math.floor(startHour);
  const startM = Math.round((startHour - startH) * 60);
  const endH = Math.floor(endHour);
  const endM = Math.round((endHour - endH) * 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  const startLocal = `${dateKey}T${pad(startH)}:${pad(startM)}:00`;
  const endLocal = `${dateKey}T${pad(endH)}:${pad(endM)}:00`;
  return {
    start: fromZonedTime(startLocal, timeZone),
    end: fromZonedTime(endLocal, timeZone),
  };
}

function dayOfWeekInZone(dateKey: string, timeZone: string): number {
  // dateKey is YYYY-MM-DD local to timeZone; get its day-of-week.
  const d = fromZonedTime(`${dateKey}T12:00:00`, timeZone);
  const zoned = toZonedTime(d, timeZone);
  return zoned.getDay();
}

/**
 * Snap an interval so its start rounds UP and its end rounds DOWN to the
 * nearest :00 or :30 in the given timezone. Returns null if the snapped
 * interval becomes empty.
 */
function snapIntervalToHalfHour(
  slot: Interval,
  timeZone: string,
): Interval | null {
  const HALF = 30 * 60 * 1000;

  // Get the timezone offset for each end of the slot (handles DST changes
  // mid-slot correctly). Offset = local - UTC, in ms.
  function offsetMs(d: Date): number {
    const local = toZonedTime(d, timeZone);
    // toZonedTime returns a Date whose UTC fields display the local clock.
    // (local-as-UTC) − (real UTC) = offset.
    return local.getTime() - d.getTime();
  }

  const startOff = offsetMs(slot.start);
  const endOff = offsetMs(slot.end);

  const startLocal = slot.start.getTime() + startOff;
  const endLocal = slot.end.getTime() + endOff;

  const snappedStartLocal = Math.ceil(startLocal / HALF) * HALF;
  const snappedEndLocal = Math.floor(endLocal / HALF) * HALF;

  if (snappedEndLocal <= snappedStartLocal) return null;

  return {
    start: new Date(snappedStartLocal - startOff),
    end: new Date(snappedEndLocal - endOff),
  };
}

function* iterDates(from: Date, to: Date, timeZone: string): Generator<string> {
  const endKey = toDateKey(to, timeZone);
  let key = toDateKey(from, timeZone);
  while (key <= endKey) {
    yield key;
    const [y, m, d] = key.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    const yy = next.getUTCFullYear();
    const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(next.getUTCDate()).padStart(2, "0");
    key = `${yy}-${mm}-${dd}`;
  }
}

export async function computeAvailability(
  auth: OAuth2Client,
  input: AvailabilityInput,
): Promise<{ days: DayAvailability[]; debug: AvailabilityDebug }> {
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
  } = input;

  const resultsByCal = await Promise.all(
    calendarIds.map((id) =>
      fetchEventsForCalendar(auth, id, timeMin, timeMax, timeZone).catch(
        (err) => {
          console.error(`Failed to fetch events for ${id}:`, err?.message ?? err);
          return { kind: "events" as const, events: [] };
        },
      ),
    ),
  );

  const busyIntervals: Interval[] = [];
  const debugPerCal: AvailabilityDebug["perCalendar"] = [];

  for (let ci = 0; ci < calendarIds.length; ci++) {
    const calendarId = calendarIds[ci];
    const result = resultsByCal[ci];
    let skippedTransparent = 0;
    let skippedDeclined = 0;
    let counted = 0;

    if (result.kind === "events") {
      for (const e of result.events) {
        if (excludeTransparent && e.transparency === "transparent") {
          skippedTransparent++;
          continue;
        }
        if (userDeclined(e)) {
          skippedDeclined++;
          continue;
        }
        const i = eventToInterval(e, timeZone);
        if (i) {
          busyIntervals.push(i);
          counted++;
        }
      }
      debugPerCal.push({
        calendarId,
        fetchKind: "events",
        totalFetched: result.events.length,
        skippedTransparent,
        skippedDeclined,
        counted,
      });
    } else {
      // freeBusy fallback: no transparency info, so the filter doesn't apply.
      // Treat all returned intervals as busy.
      for (const i of result.intervals) {
        busyIntervals.push(i);
        counted++;
      }
      debugPerCal.push({
        calendarId,
        fetchKind: "freeBusy",
        totalFetched: result.intervals.length,
        skippedTransparent: 0,
        skippedDeclined: 0,
        counted,
      });
    }
  }

  const merged = mergeIntervals(busyIntervals);
  const days: DayAvailability[] = [];
  const minMs = minSlotMinutes * 60 * 1000;

  for (const dateKey of iterDates(timeMin, timeMax, timeZone)) {
    const dow = dayOfWeekInZone(dateKey, timeZone);
    if (!workDays.includes(dow)) continue;
    const window = workWindowForDate(dateKey, workStartHour, workEndHour, timeZone);
    const clippedWindow = {
      start: window.start < timeMin ? timeMin : window.start,
      end: window.end > timeMax ? timeMax : window.end,
    };
    if (clippedWindow.end <= clippedWindow.start) continue;
    let freeSlots = subtract(clippedWindow, merged);
    if (snapToHalfHour) {
      freeSlots = freeSlots
        .map((s) => snapIntervalToHalfHour(s, timeZone))
        .filter((s): s is Interval => s !== null);
    }
    freeSlots = freeSlots.filter(
      (s) => s.end.getTime() - s.start.getTime() >= minMs,
    );
    days.push({ date: dateKey, workWindow: clippedWindow, freeSlots });
  }

  const debug: AvailabilityDebug = {
    perCalendar: debugPerCal,
    totalBusyIntervals: merged.length,
  };

  return { days, debug };
}
