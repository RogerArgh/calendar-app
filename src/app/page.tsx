"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";

type Calendar = {
  id: string;
  summary: string;
  description: string;
  backgroundColor: string;
  foregroundColor: string;
  primary: boolean;
  accessRole: string;
  timeZone: string;
};

type Slot = { start: string; end: string };
type DayResult = {
  date: string;
  workWindow: { start: string; end: string };
  freeSlots: Slot[];
};
type EventBlock = {
  calendarId: string;
  summary: string | null;
  start: string;
  end: string;
  isAllDay: boolean;
  isTransparent: boolean;
  backgroundColor: string;
  foregroundColor: string;
};
type CalDebug = {
  calendarId: string;
  fetchKind: "events" | "freeBusy";
  totalFetched: number;
  skippedTransparent: number;
  skippedDeclined: number;
  counted: number;
};
type AvailDebug = {
  perCalendar: CalDebug[];
  totalBusyIntervals: number;
};

// Workday-selector buttons, ordered Mon → Sun for display.
// `dow` is the JS Date.getDay() number (0=Sun..6=Sat) — what `workDays` stores.
const WORKDAY_BUTTONS: { label: string; dow: number }[] = [
  { label: "Mon", dow: 1 },
  { label: "Tue", dow: 2 },
  { label: "Wed", dow: 3 },
  { label: "Thu", dow: 4 },
  { label: "Fri", dow: 5 },
  { label: "Sat", dow: 6 },
  { label: "Sun", dow: 0 },
];

function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function formatTime(iso: string, tz: string): string {
  return new Date(iso)
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: tz,
    })
    .replace(/\s?(AM|PM)/i, (m) => m.trim());
}

function formatDate(iso: string, tz: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return dt.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: tz,
  });
}

export default function Home() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [loadingCals, setLoadingCals] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const [startDate, setStartDate] = useState(todayLocalISO());
  const [endDate, setEndDate] = useState(addDaysISO(todayLocalISO(), 7));
  const [workStart, setWorkStart] = useState("05:00");
  const [workEnd, setWorkEnd] = useState("18:00");
  const [workDays, setWorkDays] = useState<Set<number>>(
    new Set([1, 2, 3, 4, 5]),
  );
  const [minSlotMinutes, setMinSlotMinutes] = useState(30);
  // When checked, events marked "Free" are NOT treated as busy — i.e. those
  // time slots ARE included as available time. The state name still reflects
  // the underlying behavior (exclude from busy), but the UI label is "Include".
  const [excludeTransparent, setExcludeTransparent] = useState(true);
  const [snapToHalfHour, setSnapToHalfHour] = useState(true);
  const [viewMode, setViewMode] = useState<"text" | "grid">("text");
  const [showEvents, setShowEvents] = useState(true);
  const [showFreeSlots, setShowFreeSlots] = useState(true);

  const [results, setResults] = useState<DayResult[] | null>(null);
  const [eventBlocks, setEventBlocks] = useState<EventBlock[]>([]);
  const [availDebug, setAvailDebug] = useState<AvailDebug | null>(null);
  const [loadingAvail, setLoadingAvail] = useState(false);
  const [availError, setAvailError] = useState<string | null>(null);

  const tz = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );

  useEffect(() => {
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((d) => setAuthed(Boolean(d.authed)))
      .catch(() => setAuthed(false));
  }, []);

  // Load saved preferences from localStorage on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("calendarAppSettings");
      if (raw) {
        const s = JSON.parse(raw);
        if (Array.isArray(s.selectedIds))
          setSelectedIds(new Set(s.selectedIds));
        if (Array.isArray(s.hiddenIds)) setHiddenIds(new Set(s.hiddenIds));
        if (typeof s.startDate === "string") setStartDate(s.startDate);
        if (typeof s.endDate === "string") setEndDate(s.endDate);
        if (typeof s.workStart === "string") setWorkStart(s.workStart);
        if (typeof s.workEnd === "string") setWorkEnd(s.workEnd);
        if (Array.isArray(s.workDays)) setWorkDays(new Set(s.workDays));
        if (typeof s.minSlotMinutes === "number")
          setMinSlotMinutes(s.minSlotMinutes);
        if (typeof s.excludeTransparent === "boolean")
          setExcludeTransparent(s.excludeTransparent);
        if (typeof s.snapToHalfHour === "boolean")
          setSnapToHalfHour(s.snapToHalfHour);
        if (s.viewMode === "text" || s.viewMode === "grid")
          setViewMode(s.viewMode);
        if (typeof s.showEvents === "boolean") setShowEvents(s.showEvents);
        if (typeof s.showFreeSlots === "boolean") setShowFreeSlots(s.showFreeSlots);
      } else {
        // Migration: an earlier version saved hidden IDs under their own key.
        // Pull them in once if the consolidated key doesn't exist yet.
        const legacyHidden = localStorage.getItem("hiddenCalendarIds");
        if (legacyHidden) {
          try {
            const ids = JSON.parse(legacyHidden);
            if (Array.isArray(ids)) setHiddenIds(new Set(ids));
          } catch {}
          localStorage.removeItem("hiddenCalendarIds");
        }
      }
    } catch {
      // ignore parse errors
    }
    setHydrated(true);
  }, []);

  // Persist preferences whenever they change (after hydration).
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        "calendarAppSettings",
        JSON.stringify({
          selectedIds: [...selectedIds],
          hiddenIds: [...hiddenIds],
          startDate,
          endDate,
          workStart,
          workEnd,
          workDays: [...workDays],
          minSlotMinutes,
          excludeTransparent,
          snapToHalfHour,
          viewMode,
          showEvents,
          showFreeSlots,
        }),
      );
    } catch {
      // ignore quota errors
    }
  }, [
    hydrated,
    selectedIds,
    hiddenIds,
    startDate,
    endDate,
    workStart,
    workEnd,
    workDays,
    minSlotMinutes,
    excludeTransparent,
    snapToHalfHour,
    viewMode,
    showEvents,
    showFreeSlots,
  ]);

  const loadCalendars = useCallback(async () => {
    setLoadingCals(true);
    setCalendarError(null);
    try {
      const r = await fetch("/api/calendars");
      if (r.status === 401) {
        setAuthed(false);
        return;
      }
      const d = await r.json();
      if (!r.ok) {
        setCalendarError(d.error || `Failed to load calendars (${r.status})`);
        return;
      }
      setCalendars(d.calendars || []);
      setSelectedIds((prev) => {
        if (prev.size > 0) return prev;
        const primary = (d.calendars || []).find((c: Calendar) => c.primary);
        return primary ? new Set([primary.id]) : new Set();
      });
    } catch (err) {
      setCalendarError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoadingCals(false);
    }
  }, []);

  useEffect(() => {
    if (authed) loadCalendars();
  }, [authed, loadCalendars]);

  // ISO date strings (YYYY-MM-DD) sort lexicographically, so plain string
  // comparison is correct here.
  function changeStartDate(iso: string) {
    setStartDate(iso);
    setEndDate((prevEnd) => (iso > prevEnd ? iso : prevEnd));
  }

  function toggleCalendar(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function hideCalendar(id: string) {
    // Hiding a calendar also unselects it so it isn't silently used.
    setHiddenIds((prev) => new Set(prev).add(id));
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function unhideCalendar(id: string) {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function toggleWorkDay(d: number) {
    setWorkDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  async function runAvailability() {
    setAvailError(null);
    setAvailDebug(null);
    setLoadingAvail(true);
    setResults(null);
    setEventBlocks([]);
    try {
      const [sh, sm] = workStart.split(":").map(Number);
      const [eh, em] = workEnd.split(":").map(Number);
      const workStartHour = sh + (sm || 0) / 60;
      const workEndHour = eh + (em || 0) / 60;

      // Build a generous UTC window covering the date range in the user's tz.
      const [sy, smo, sd] = startDate.split("-").map(Number);
      const [ey, emo, ed] = endDate.split("-").map(Number);
      const timeMin = new Date(sy, smo - 1, sd, 0, 0, 0);
      const timeMax = new Date(ey, emo - 1, ed, 23, 59, 59);

      // Build a calendarId → { bg, fg } map from the loaded calendar list so
      // the server can resolve per-event color overrides against each calendar's
      // base color without needing an extra calendarList call.
      const calendarColors = Object.fromEntries(
        calendars.map((c) => [c.id, { bg: c.backgroundColor, fg: c.foregroundColor }]),
      );

      const r = await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calendarIds: [...selectedIds],
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          timeZone: tz,
          workStartHour,
          workEndHour,
          workDays: [...workDays],
          minSlotMinutes,
          excludeTransparent,
          snapToHalfHour,
          calendarColors,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setAvailError(d.error || `Request failed: ${r.status}`);
        return;
      }
      const d = await r.json();
      setResults(d.days || []);
      setEventBlocks(d.eventBlocks || []);
      if (d.debug) setAvailDebug(d.debug);
    } catch (err) {
      setAvailError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoadingAvail(false);
    }
  }

  if (authed === null) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <p className="text-zinc-500">Loading…</p>
      </main>
    );
  }

  if (!authed) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8 bg-zinc-50 dark:bg-zinc-950">
        <div className="max-w-md w-full bg-white dark:bg-zinc-900 rounded-xl shadow p-8 space-y-5">
          <h1 className="text-2xl font-semibold">Calendar Availability</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Find open times across your Google calendars and the ones shared
            with you. Filter out events marked &ldquo;Free&rdquo; to skip
            personal to-dos.
          </p>
          <a
            href="/api/auth/login"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2.5 rounded-lg transition-colors"
          >
            Sign in with Google
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">Calendar Availability</h1>
          <div className="flex items-center gap-4">
            <Clock tz={tz} />
            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                className="text-sm text-zinc-600 dark:text-zinc-400 hover:underline"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
          {/* Left panel: calendars + controls */}
          <aside className="space-y-6">
            <section className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm p-4">
              <div className="flex items-center justify-between mb-3 gap-2">
                <h2 className="font-medium">
                  Calendars
                  {calendars.length > 0 && (
                    <span className="text-xs text-zinc-500 font-normal ml-1.5">
                      ({selectedIds.size}/
                      {calendars.length - hiddenIds.size})
                    </span>
                  )}
                </h2>
                {loadingCals ? (
                  <span className="text-xs text-zinc-500">Loading…</span>
                ) : calendarError ? (
                  <button
                    type="button"
                    onClick={loadCalendars}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Retry
                  </button>
                ) : hiddenIds.size > 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowHidden((v) => !v)}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {showHidden ? "Done" : `Show hidden (${hiddenIds.size})`}
                  </button>
                ) : null}
              </div>
              {calendarError && (
                <div className="text-xs text-red-600 dark:text-red-400 mb-2 break-words">
                  Error: {calendarError}
                </div>
              )}
              <ul
                className="always-scroll space-y-1.5 max-h-72 overflow-y-auto"
                style={{ direction: "rtl" }}
              >
                {calendars
                  .filter((c) => showHidden || !hiddenIds.has(c.id))
                  .map((c) => {
                    const isHidden = hiddenIds.has(c.id);
                    return (
                      <li key={c.id} style={{ direction: "ltr" }}>
                        <div
                          className={`group flex items-center gap-2 text-sm rounded pl-3 pr-1 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 ${
                            isHidden ? "opacity-50" : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.has(c.id)}
                            disabled={isHidden}
                            onChange={() => toggleCalendar(c.id)}
                            className="shrink-0 w-4 h-4 cursor-pointer"
                          />
                          <span
                            className="w-3 h-3 rounded-sm shrink-0"
                            style={{ backgroundColor: c.backgroundColor }}
                          />
                          <span className="truncate flex-1">
                            {c.summary}
                            {c.primary && (
                              <span className="text-xs text-zinc-500 ml-1">
                                (primary)
                              </span>
                            )}
                            {c.accessRole === "freeBusyReader" && (
                              <span
                                className="text-xs text-amber-600 dark:text-amber-400 ml-1"
                                title="Only free/busy info available — the 'Free' filter doesn't apply to this calendar"
                              >
                                (busy only)
                              </span>
                            )}
                          </span>
                          {isHidden ? (
                            <button
                              type="button"
                              onClick={() => unhideCalendar(c.id)}
                              className="text-xs text-blue-600 dark:text-blue-400 hover:underline px-1.5 py-0.5 shrink-0"
                              title="Unhide this calendar"
                            >
                              Unhide
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => hideCalendar(c.id)}
                              className="text-xs text-zinc-500 hover:text-red-600 dark:hover:text-red-400 px-1.5 py-0.5 shrink-0 sm:opacity-0 sm:group-hover:opacity-100 sm:transition-opacity"
                              title="Hide this calendar from the list"
                            >
                              Hide
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
              </ul>
            </section>

            <section className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm p-4 space-y-3">
              <h2 className="font-medium">Window</h2>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <DateField
                  label="From"
                  value={startDate}
                  onChange={changeStartDate}
                />
                <DateField label="To" value={endDate} onChange={setEndDate} align="right" />
                <label className="flex flex-col gap-1">
                  <span className="text-zinc-600 dark:text-zinc-400">
                    Day start
                  </span>
                  <input
                    type="time"
                    value={workStart}
                    onChange={(e) => setWorkStart(e.target.value)}
                    className="rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-zinc-600 dark:text-zinc-400">
                    Day end
                  </span>
                  <input
                    type="time"
                    value={workEnd}
                    onChange={(e) => setWorkEnd(e.target.value)}
                    className="rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1"
                  />
                </label>
              </div>
              <div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400 mb-1">
                  Days
                </div>
                <div className="flex flex-wrap gap-1">
                  {WORKDAY_BUTTONS.map(({ label, dow }) => (
                    <button
                      key={dow}
                      type="button"
                      onClick={() => toggleWorkDay(dow)}
                      className={`flex-1 min-w-[2.5rem] text-xs py-2 rounded border transition-colors ${
                        workDays.has(dow)
                          ? "bg-blue-600 border-blue-600 text-white"
                          : "border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-zinc-600 dark:text-zinc-400">
                  Min slot length
                </span>
                <select
                  value={minSlotMinutes}
                  onChange={(e) => setMinSlotMinutes(Number(e.target.value))}
                  className="rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1"
                >
                  <option value={15}>15 min</option>
                  <option value={30}>30 min</option>
                  <option value={45}>45 min</option>
                  <option value={60}>1 hour</option>
                  <option value={90}>1.5 hours</option>
                  <option value={120}>2 hours</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={excludeTransparent}
                  onChange={(e) => setExcludeTransparent(e.target.checked)}
                />
                <span>Include &ldquo;Free&rdquo; events as available</span>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={snapToHalfHour}
                  onChange={(e) => setSnapToHalfHour(e.target.checked)}
                />
                <span>30/60 start &amp; finish</span>
              </label>
              <button
                onClick={runAvailability}
                disabled={selectedIds.size === 0 || loadingAvail}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-400 text-white font-medium py-2 rounded-lg transition-colors"
              >
                {loadingAvail ? "Finding times…" : "Find times"}
              </button>
            </section>
          </aside>

          {/* Right panel: results */}
          <section className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm p-4 min-h-96">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h2 className="font-medium">Available times</h2>
              <div className="flex items-center gap-3 flex-wrap">
                {viewMode === "grid" && (
                  <>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={showEvents}
                        onChange={(e) => setShowEvents(e.target.checked)}
                      />
                      <span className="text-zinc-600 dark:text-zinc-400">Events</span>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={showFreeSlots}
                        onChange={(e) => setShowFreeSlots(e.target.checked)}
                      />
                      <span className="text-green-700 dark:text-green-400 font-medium">Free slots</span>
                    </label>
                  </>
                )}
                <div className="inline-flex rounded-lg border border-zinc-300 dark:border-zinc-700 overflow-hidden text-sm">
                  <button
                    onClick={() => setViewMode("text")}
                    className={`px-3 py-1 ${viewMode === "text" ? "bg-zinc-200 dark:bg-zinc-800" : ""}`}
                  >
                    Text
                  </button>
                  <button
                    onClick={() => setViewMode("grid")}
                    className={`px-3 py-1 border-l border-zinc-300 dark:border-zinc-700 ${viewMode === "grid" ? "bg-zinc-200 dark:bg-zinc-800" : ""}`}
                  >
                    Grid
                  </button>
                </div>
              </div>
            </div>

            {availError && (
              <div className="text-sm text-red-600 dark:text-red-400 mb-3">
                {availError}
              </div>
            )}

            {!results && !loadingAvail && (
              <p className="text-sm text-zinc-500">
                Pick calendars and click &ldquo;Find times&rdquo;.
              </p>
            )}

            {results && viewMode === "text" && (
              <TextView days={results} tz={tz} />
            )}
            {results && viewMode === "grid" && (
              <GridView
                days={results}
                tz={tz}
                workStart={workStart}
                workEnd={workEnd}
                eventBlocks={eventBlocks}
                calendars={calendars}
                showEvents={showEvents}
                showFreeSlots={showFreeSlots}
              />
            )}
            {availDebug && availDebug.totalBusyIntervals === 0 && (
              <details className="mt-4 text-xs text-zinc-500 border border-zinc-200 dark:border-zinc-700 rounded p-3">
                <summary className="cursor-pointer font-medium text-zinc-600 dark:text-zinc-400">
                  ⚠ No busy events found — expand for details
                </summary>
                <div className="mt-2 space-y-1">
                  {availDebug.perCalendar.map((c) => (
                    <div key={c.calendarId} className="font-mono">
                      <span className="text-zinc-700 dark:text-zinc-300">{c.calendarId}</span>
                      {" · "}
                      {c.fetchKind === "freeBusy" ? (
                        <span className="text-amber-600 dark:text-amber-400">free/busy only</span>
                      ) : (
                        <span className="text-blue-600 dark:text-blue-400">full events</span>
                      )}
                      {" · "}
                      {c.totalFetched} fetched
                      {c.skippedTransparent > 0 && `, ${c.skippedTransparent} skipped (Free)`}
                      {c.skippedDeclined > 0 && `, ${c.skippedDeclined} skipped (declined)`}
                      {", "}
                      <span className={c.counted > 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                        {c.counted} busy
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

// Live clock + time-zone readout. Shows the time the *system* (browser) thinks
// it is, in the same IANA zone the availability calc uses, so a traveler can
// confirm their machine's clock/zone before reading any results. The time is
// only rendered after mount — server and first client render both show the
// placeholder, avoiding a hydration mismatch on the ticking value.
function Clock({ tz }: { tz: string }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Short zone abbreviation for the current offset, e.g. "GMT+2" / "PDT".
  const zoneAbbr = useMemo(() => {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        timeZoneName: "short",
      }).formatToParts(now ?? new Date());
      return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    } catch {
      return "";
    }
  }, [tz, now]);

  const time = now
    ? now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
        timeZone: tz,
      })
    : "--:--:-- --";

  const date = now
    ? now.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: tz,
      })
    : "";

  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 shadow-sm"
      title="The time and zone your system is currently set to"
    >
      <svg
        className="w-4 h-4 text-zinc-400 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.8}
      >
        <circle cx="12" cy="12" r="9" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
      </svg>
      <div className="leading-tight">
        <div
          className="font-mono text-base font-semibold tabular-nums"
          suppressHydrationWarning
        >
          {time}
        </div>
        <div
          className="text-[11px] text-zinc-500 dark:text-zinc-400"
          suppressHydrationWarning
        >
          {date && `${date} · `}
          {tz}
          {zoneAbbr && ` (${zoneAbbr})`}
        </div>
      </div>
    </div>
  );
}

function isoToLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function localDateToIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function DateField({
  label,
  value,
  onChange,
  align = "left",
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const display = isoToLocalDate(value).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="flex flex-col gap-1 relative" ref={ref}>
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-left rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1 hover:border-zinc-400 dark:hover:border-zinc-600"
      >
        {display}
      </button>
      {open && (
        <div className={`absolute top-full mt-1 z-20 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg p-2 max-w-[calc(100vw-2rem)] overflow-auto ${align === "right" ? "right-0" : "left-0"}`}>
          <DayPicker
            mode="single"
            selected={isoToLocalDate(value)}
            // Each time the popover opens, this DayPicker is freshly mounted,
            // so defaultMonth makes it always open on the selected date's month
            // — never the current month or a stale prior view.
            defaultMonth={isoToLocalDate(value)}
            onSelect={(d) => {
              if (d) {
                onChange(localDateToIso(d));
                setOpen(false);
              }
            }}
            showOutsideDays
            captionLayout="dropdown"
            weekStartsOn={1}
          />
        </div>
      )}
    </div>
  );
}

// "Thu Apr.30" — always in English for consistent copy/paste output.
function formatDateHeading(iso: string, tz: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const weekday = dt.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: tz,
  });
  const month = dt.toLocaleDateString("en-US", {
    month: "short",
    timeZone: tz,
  });
  return `${weekday} ${month}.${d}`;
}

function formatSlot(s: Slot, tz: string): string {
  return `${formatTime(s.start, tz)}-${formatTime(s.end, tz)}`;
}

function buildClipboardText(days: DayResult[], tz: string): string {
  const withSlots = days.filter((d) => d.freeSlots.length > 0);
  return withSlots
    .map((d) => {
      const heading = formatDateHeading(d.date, tz);
      const times = d.freeSlots.map((s) => formatSlot(s, tz)).join(", ");
      return `${heading}:  ${times}`;
    })
    .join("\n");
}

function TextView({ days, tz }: { days: DayResult[]; tz: string }) {
  const [copied, setCopied] = useState(false);
  const withSlots = days.filter((d) => d.freeSlots.length > 0);

  async function copyToClipboard() {
    const text = buildClipboardText(days, tz);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers that block clipboard API without user gesture
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.focus();
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (withSlots.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No free slots in the selected window.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {withSlots.map((d) => (
          <li key={d.date} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium whitespace-nowrap">
              {formatDateHeading(d.date, tz)}:
            </span>
            {d.freeSlots.map((s, i) => (
              <span
                key={i}
                className="text-xs bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 px-2 py-1 rounded"
              >
                {formatSlot(s, tz)}
              </span>
            ))}
          </li>
        ))}
      </ul>
      <button
        onClick={copyToClipboard}
        className="inline-flex items-center gap-1.5 text-xs px-3 py-2.5 sm:py-1.5 rounded border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
      >
        {copied ? (
          <>
            <svg className="w-3.5 h-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Copied!
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
            Copy to clipboard
          </>
        )}
      </button>
    </div>
  );
}

// Return the ISO date string for the Monday of the week containing `iso`.
function mondayOfWeek(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay(); // 0=Sun..6=Sat
  const delta = dow === 0 ? -6 : 1 - dow; // days back to Monday
  dt.setDate(dt.getDate() + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// Short date label: "Apr 28"
function shortDate(iso: string, tz: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: tz,
  });
}

// Format a 0-23 hour integer as a short label: 12a, 1a…11a, 12p, 1p…11p
function formatHourLabel(h: number): string {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

const HOUR_PX = 40; // pixels per hour — keeps 13-hour default window at 520 px

function GridView({
  days,
  tz,
  workStart,
  workEnd,
  eventBlocks,
  calendars,
  showEvents,
  showFreeSlots,
}: {
  days: DayResult[];
  tz: string;
  workStart: string;
  workEnd: string;
  eventBlocks: EventBlock[];
  calendars: Calendar[];
  showEvents: boolean;
  showFreeSlots: boolean;
}) {
  const [weekIdx, setWeekIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Group days into calendar weeks (keyed by their Monday).
  const weekGroups = useMemo(() => {
    const map = new Map<string, DayResult[]>();
    for (const d of days) {
      const key = mondayOfWeek(d.date);
      const arr = map.get(key) ?? [];
      arr.push(d);
      map.set(key, arr);
    }
    return [...map.values()];
  }, [days]);

  // Reset to first week whenever a new result set arrives.
  useEffect(() => { setWeekIdx(0); }, [days]);

  const [sh, sm] = workStart.split(":").map(Number);
  const [eh, em] = workEnd.split(":").map(Number);
  const wStartHour = sh + (sm || 0) / 60;
  const wEndHour   = eh + (em || 0) / 60;

  const FULL_H   = 24 * HOUR_PX;                                  // 960 px — full day
  const visibleH = Math.round((wEndHour - wStartHour) * HOUR_PX); // default viewport height

  // Auto-scroll so the work-window start sits at the top of the viewport on
  // mount and whenever the user pages to a different week.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = wStartHour * HOUR_PX;
    }
  }, [weekIdx, wStartHour, days]);

  if (days.length === 0) {
    return <p className="text-sm text-zinc-500">No days matched the working-day filter.</p>;
  }

  const multiWeek = weekGroups.length > 1;
  const visibleDays = multiWeek ? (weekGroups[weekIdx] ?? []) : days;
  const nCols = visibleDays.length;

  // Build a calMap only for the legend (calendar name + swatch).
  const calMap = new Map(
    calendars.map((c) => [c.id, { bg: c.backgroundColor, fg: c.foregroundColor, summary: c.summary }]),
  );

  // Convert an ISO timestamp to pixels from midnight (in the user's timezone).
  // midnightMs is the UTC epoch ms corresponding to 00:00 local on that day.
  function toTopPx(iso: string, midnightMs: number): number {
    return Math.max(0, (new Date(iso).getTime() - midnightMs) / 3_600_000 * HOUR_PX);
  }

  const rangeLabel = visibleDays.length > 0
    ? `${shortDate(visibleDays[0].date, tz)} – ${shortDate(visibleDays[visibleDays.length - 1].date, tz)}`
    : "";

  return (
    <div className="flex flex-col gap-2">

      {/* ── week navigation (only when range spans >1 week) ── */}
      {multiWeek && (
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => setWeekIdx((i) => Math.max(0, i - 1))}
            disabled={weekIdx === 0}
            className="flex items-center gap-1 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 text-sm disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            ← Prev
          </button>
          <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400 text-center">
            {rangeLabel}
            <span className="text-zinc-400 dark:text-zinc-500 ml-2 text-xs">
              Week {weekIdx + 1} / {weekGroups.length}
            </span>
          </span>
          <button
            onClick={() => setWeekIdx((i) => Math.min(weekGroups.length - 1, i + 1))}
            disabled={weekIdx === weekGroups.length - 1}
            className="flex items-center gap-1 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 text-sm disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            Next →
          </button>
        </div>
      )}

      {/* ── day-label header row + scroll area, horizontally scrollable on mobile ── */}
      <div className="overflow-x-auto -mx-1 px-1">
      <div style={{ minWidth: `${48 + nCols * 72}px` }}>
      <div
        className="w-full grid gap-x-1.5"
        style={{ gridTemplateColumns: `48px repeat(${nCols}, 1fr)` }}
      >
        <div /> {/* empty corner above time axis */}
        {visibleDays.map((d) => {
          // midnight in the user's tz for this day
          const midnightMs = new Date(d.workWindow.start).getTime() - wStartHour * 3_600_000;
          const dayEndMs   = midnightMs + 24 * 3_600_000;
          const allDay = showEvents ? eventBlocks.filter((e) => {
            if (!e.isAllDay) return false;
            const eS = new Date(e.start).getTime();
            const eE = new Date(e.end).getTime();
            return eE > midnightMs && eS < dayEndMs;
          }) : [];
          return (
            <div key={d.date} className="flex flex-col gap-0.5 pb-1 min-w-0">
              <div className="text-xs text-center font-semibold text-zinc-700 dark:text-zinc-300 truncate">
                {formatDate(d.date, tz)}
              </div>
              {allDay.map((e, i) => (
                <div
                  key={i}
                  className="text-[10px] truncate rounded px-1 py-0.5 leading-tight"
                  style={{
                    backgroundColor: e.backgroundColor,
                    color: e.foregroundColor,
                    opacity: e.isTransparent ? 0.5 : 1,
                  }}
                  title={e.summary ?? "(all-day)"}
                >
                  {e.summary ?? "(all-day)"}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* ── scrollable time grid — scrollbar on the LEFT via direction:rtl ── */}
      <div
        ref={scrollRef}
        className="always-scroll overflow-y-auto rounded"
        style={{ height: visibleH, direction: "rtl" }}
      >
        {/* inner grid: reset direction so content reads left-to-right */}
        <div
          className="grid gap-x-1.5"
          style={{
            direction: "ltr",
            gridTemplateColumns: `48px repeat(${nCols}, 1fr)`,
            height: FULL_H,
          }}
        >
          {/* time axis — all 24 hours */}
          <div className="relative select-none" style={{ height: FULL_H }}>
            {Array.from({ length: 25 }, (_, h) => (
              <div
                key={h}
                className="absolute text-[11px] text-zinc-400 right-1 leading-none"
                style={{ top: h * HOUR_PX, transform: "translateY(-50%)" }}
              >
                {h < 24 ? formatHourLabel(h) : ""}
              </div>
            ))}
          </div>

          {/* day columns */}
          {visibleDays.map((d) => {
            const midnightMs = new Date(d.workWindow.start).getTime() - wStartHour * 3_600_000;
            const dayEndMs   = midnightMs + 24 * 3_600_000;
            const timedEvents = eventBlocks.filter((e) => {
              if (e.isAllDay) return false;
              const eS = new Date(e.start).getTime();
              const eE = new Date(e.end).getTime();
              return eE > midnightMs && eS < dayEndMs;
            });
            return (
              <div
                key={d.date}
                className="relative bg-zinc-100 dark:bg-zinc-800 rounded overflow-hidden min-w-0"
                style={{ height: FULL_H }}
              >
                {/* hour lines for all 24 hours */}
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-zinc-200 dark:border-zinc-700"
                    style={{ top: h * HOUR_PX }}
                  />
                ))}

                {/* dim pre-work hours */}
                {wStartHour > 0 && (
                  <div
                    className="absolute left-0 right-0 bg-zinc-900/10 dark:bg-zinc-950/30 pointer-events-none"
                    style={{ top: 0, height: wStartHour * HOUR_PX }}
                  />
                )}
                {/* dim post-work hours */}
                {wEndHour < 24 && (
                  <div
                    className="absolute left-0 right-0 bg-zinc-900/10 dark:bg-zinc-950/30 pointer-events-none"
                    style={{ top: wEndHour * HOUR_PX, height: (24 - wEndHour) * HOUR_PX }}
                  />
                )}

                {/* existing events — exact colors from Google Calendar */}
                {showEvents && timedEvents.map((e, i) => {
                  const top    = toTopPx(e.start, midnightMs);
                  const height = Math.max(
                    HOUR_PX * 0.25,
                    (new Date(e.end).getTime() - new Date(e.start).getTime()) / 3_600_000 * HOUR_PX,
                  );
                  return (
                    <div
                      key={i}
                      className="absolute left-px right-px rounded px-1 overflow-hidden leading-tight"
                      style={{
                        top,
                        height,
                        backgroundColor: e.backgroundColor,
                        color: e.foregroundColor,
                        opacity: e.isTransparent ? 0.4 : 1,
                        fontSize: "11px",
                      }}
                      title={`${e.summary ?? "(busy)"} · ${formatTime(e.start, tz)}–${formatTime(e.end, tz)}`}
                    >
                      <span className="font-semibold leading-none">{e.summary ?? "(busy)"}</span>
                      <span className="block opacity-90">{formatTime(e.start, tz)}</span>
                    </div>
                  );
                })}

                {/* free slots — bright green, rendered on top */}
                {showFreeSlots && d.freeSlots.map((s, i) => {
                  const top    = toTopPx(s.start, midnightMs);
                  const height = Math.max(
                    HOUR_PX * 0.25,
                    (new Date(s.end).getTime() - new Date(s.start).getTime()) / 3_600_000 * HOUR_PX,
                  );
                  return (
                    <div
                      key={i}
                      className="absolute left-px right-px rounded px-1 overflow-hidden leading-tight
                                 bg-green-400/30 dark:bg-green-400/25 border border-green-500/50"
                      style={{ top, height, fontSize: "10px" }}
                      title={formatSlot(s, tz)}
                    >
                      <span className="font-bold text-green-800 dark:text-green-300">
                        {formatSlot(s, tz)}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      </div>{/* minWidth wrapper */}
      </div>{/* overflow-x-auto wrapper */}

      {/* legend */}
      <div className="flex flex-wrap gap-3 text-xs text-zinc-500 pt-1">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm bg-green-400/40 border border-green-500/50" />
          Free
        </span>
        {[...calMap.values()]
          .filter((c) => eventBlocks.some((e) => {
            const cal = calMap.get(e.calendarId);
            return cal === c && !e.isAllDay;
          }))
          .map((c) => (
            <span key={c.summary} className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: c.bg }} />
              {c.summary}
            </span>
          ))}
      </div>
    </div>
  );
}
