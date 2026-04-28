# Calendar Availability — v1.0

A local-first Next.js app that finds open times across your Google calendars —
including calendars shared with you by family and coworkers — and lets you
copy the results as clean text.

## Features

- **Multi-calendar selection** — pick any combination of your own calendars
  plus ones shared with you (family, coworkers, work email). Calendars with
  only free/busy access are supported via a fallback path and labeled
  "(busy only)".
- **Hide/unhide calendars** — declutter the list without losing the calendar;
  hidden calendars are unselected automatically and can be restored with
  "Show hidden (N)".
- **"Free" event filter** — toggle *Include "Free" events as available* (on by
  default) to exclude events marked Free in Google Calendar (typically personal
  to-dos) so they don't block availability.
- **Snap to :00/:30** — trim free slots so they start and end on the nearest
  half-hour, giving cleaner windows to propose.
- **Minimum slot length** — filter out gaps shorter than 15 min / 30 min /
  45 min / 1 hr / 1.5 hr / 2 hr.
- **Configurable work window** — set day start/end (defaults 5:00 AM – 6:00 PM)
  and choose which days of the week count as working days.
- **Date picker** — click either date field to open a calendar popover that
  opens on the currently selected month.  Choosing a start date automatically
  advances the end date if needed.
- **Text view** — one line per day in `Thu Apr.30:  7:00AM-9:00AM, 1:00PM-3:00PM`
  format. A **Copy to clipboard** button copies all days/times as plain text.
- **Grid view** — visual timeline with green bars for free slots, one column
  per day, hour markers on the left.
- **Session persistence** — all preferences (selected calendars, hidden
  calendars, date range, work window, checkboxes, view mode) survive page
  refreshes via localStorage.
- **Graceful auth recovery** — if the Google OAuth token expires the app shows
  the sign-in prompt instead of a confusing empty screen.
- **Debug panel** — when no busy events are found a collapsible panel shows
  exactly how many events were fetched per calendar and how many were skipped,
  making it easy to diagnose misconfigured calendar selections.

---

## One-time setup

### 1. Create a Google OAuth client

You need your own OAuth client because this app reads your calendar data
directly — it never goes through a third-party server.

1. Go to [console.cloud.google.com](https://console.cloud.google.com/).
2. Create a new project (top bar → project selector → **New Project**).
   Name it anything, e.g. `calendar-availability`.
3. In the left nav: **APIs & Services → Library**. Search for **Google
   Calendar API** and click **Enable**.
4. Left nav: **APIs & Services → OAuth consent screen**.
   - User Type: **External**. Click **Create**.
   - App name: `Calendar Availability`. User support email: your email.
     Developer contact: your email. **Save and continue**.
   - Scopes: skip (we request scopes at runtime). **Save and continue**.
   - Test users: click **Add users** and add your own Google account.
     **Save and continue**.
5. Left nav: **APIs & Services → Credentials → Create Credentials → OAuth
   client ID**.
   - Application type: **Web application**.
   - Name: `Calendar Availability Local`.
   - Authorized redirect URIs: add `http://localhost:3000/api/auth/callback`.
   - Click **Create**. Copy the **Client ID** and **Client secret**.

### 2. Configure the app

From the `calendar-app` directory:

```bash
cp .env.local.example .env.local
```

Open `.env.local` and fill in:

| Variable | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | Client ID from step 1 |
| `GOOGLE_CLIENT_SECRET` | Client secret from step 1 |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3000/api/auth/callback` |
| `SESSION_SECRET` | Random 32+ char string (see below) |

Generate `SESSION_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Install dependencies

```bash
npm install
```

---

## Running the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with the
Google account you added as a test user.

### Access from your phone (same Wi-Fi)

```bash
npm run dev -- -H 0.0.0.0
```

Find your Mac's LAN IP (`ipconfig getifaddr en0`), then on your phone visit
`http://<that-ip>:3000`.

> **Note:** Google's OAuth redirect URI must match exactly. The easiest
> workaround for phone access: sign in on your laptop first (the session is
> stored in an encrypted cookie), then visit from your phone — you'll need to
> sign in on the phone separately. For a proper multi-device setup, add
> `http://<lan-ip>:3000/api/auth/callback` to the Google Cloud Console
> authorized redirect URIs and set `GOOGLE_REDIRECT_URI` accordingly.

---

## How the "Free event" filter works

Google Calendar has two per-event settings for how the time appears to others:
**Busy** (opaque) and **Free** (transparent). Many people mark personal to-dos
as Free so they don't block others' scheduling. With *Include "Free" events as
available* checked (the default), those events are ignored when computing
availability — only Busy events block time. Uncheck it to treat Free events as
busy too.

> Calendars marked "(busy only)" in the list only expose free/busy information,
> not individual event details. The "Free" filter cannot apply to those
> calendars — all their busy periods are always counted regardless of the
> checkbox.

---

## Reverting to this version

This repo uses git tags. To return to v1.0:

```bash
git checkout v1.0
npm install
npm run dev
```

To get back to the latest:

```bash
git checkout main
```

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.2 (App Router, TypeScript) |
| Styling | Tailwind CSS v4 |
| Calendar UI | react-day-picker v9 |
| Google auth | google-auth-library + googleapis |
| Session | iron-session v8 (encrypted cookie, 30-day) |
| Date math | date-fns + date-fns-tz |

### Key files

```
src/
  app/
    page.tsx                  # Main UI (client component)
    globals.css               # Tailwind + always-visible scrollbar styles
    api/
      auth/
        login/route.ts        # Redirect to Google OAuth consent
        callback/route.ts     # Exchange code for tokens, save to session
        logout/route.ts       # Clear session cookie
        status/route.ts       # { authed: boolean }
      calendars/route.ts      # List user's calendars via calendarList.list
      availability/route.ts   # POST → computeAvailability()
  lib/
    availability.ts           # Core availability engine
    google.ts                 # OAuth client factory + getAuthedClient()
    session.ts                # iron-session wrapper
```

### Availability engine (`src/lib/availability.ts`)

1. Fetches events for each selected calendar via `events.list` (preserves
   `transparency` field needed for the Free filter). Falls back to
   `freebusy.query` for calendars that return 403 (free/busy-only access).
2. Filters out transparent events (if the option is on) and events the signed-in
   user has declined.
3. Merges all busy intervals across calendars.
4. For each working day in the range, subtracts busy from the work window.
5. Optionally snaps slot edges to the nearest :00 or :30 (start rounds up, end
   rounds down).
6. Drops slots shorter than the minimum slot length.

---

## What's next (future work)

- **Deployment** — Fly.io / Railway / Render (Docker) or Vercel for
  single-user cloud hosting with Tailscale for private access.
- **Multiple attendees** — enter other people's emails and check their
  free/busy alongside your own.
- **Event creation** — click a slot to create a Google Calendar event.
- **iCal / other providers** — read `.ics` feeds from non-Google calendars.
