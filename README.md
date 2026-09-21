# NC State + Canes calendar

Subscribe-able iCal feed of NC State football, NC State men's basketball, and Carolina Hurricanes games, built daily from ESPN's public schedule API.

## Subscribe

- URL: `https://jkbutler11.github.io/nc-canes-calendar/calendar.ics`
- iPhone/iPad: Calendar app → Calendars → Add Calendar → Add Subscribed Calendar
- Google Calendar: Settings → Add calendar → From URL

Events include a built-in reminder (4h before football, 2h before basketball/hockey). Time-TBD games appear as all-day events and gain a real time automatically once ESPN publishes it (the feed regenerates daily).

## How it works

`generate.mjs` (Node 24, zero dependencies) fetches regular-season + postseason schedules for each team from ESPN, dedupes, drops games older than 21 days, and writes `calendar.ics`. GitHub Actions regenerates and commits it daily at 10:17 UTC; GitHub Pages serves it from the repo root.

To re-run locally: `node generate.mjs`
