#!/usr/bin/env node
// Generates calendar.ics from ESPN's public schedule API:
// NC State football, NC State men's basketball, Carolina Hurricanes.
// Zero dependencies. Run: node generate.mjs

import { writeFileSync } from "node:fs";

const YEAR = new Date().getUTCFullYear();
const TZ = "America/New_York";
const PAST_CUTOFF_DAYS = 21;

const FEEDS = [
	{
		key: "fb",
		label: "NC State Football",
		sport: "football/college-football",
		teamParam: "152",
		mineAbbr: "NCSU",
		seasons: [YEAR, YEAR + 1],
		seasonTypes: [2, 3],
		durationHours: 3.5,
		alarmHours: 4,
	},
	{
		key: "mbb",
		label: "NC State Basketball",
		sport: "basketball/mens-college-basketball",
		teamParam: "152",
		mineAbbr: "NCSU",
		seasons: [YEAR + 1, YEAR + 2],
		seasonTypes: [2, 3],
		durationHours: 2.5,
		alarmHours: 2,
	},
	{
		key: "nhl",
		label: "Carolina Hurricanes",
		sport: "hockey/nhl",
		teamParam: "car",
		mineAbbr: "CAR",
		seasons: [YEAR + 1, YEAR + 2],
		seasonTypes: [2, 3],
		durationHours: 3,
		alarmHours: 2,
	},
];

async function fetchJson(url) {
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const res = await fetch(url, { headers: { accept: "application/json" } });
			if (!res.ok) return null;
			return await res.json();
		} catch {
			if (attempt === 2) return null;
			await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
		}
	}
	return null;
}

function etDate(d) {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: TZ,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(d);
}

function icsUtc(d) {
	return `${d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`;
}

function parseEvent(feed, event) {
	const comp = event.competitions?.[0];
	if (!comp) return null;
	const competitors = comp.competitors ?? [];
	const mine = competitors.find((c) => c.team?.abbreviation === feed.mineAbbr);
	const opp = competitors.find((c) => c !== mine);
	if (!mine || !opp) return null;

	const start = new Date(event.date);
	if (Number.isNaN(start.getTime())) return null;

	const timeValid = event.timeValid === true && comp.timeValid !== false;
	const conn = comp.neutralSite || mine.homeAway === "home" ? "vs." : "at";
	const oppName = opp.team.shortDisplayName || opp.team.displayName;

	const tv = [
		...new Set(
			(comp.broadcasts ?? []).map((b) => b.media?.shortName).filter(Boolean),
		),
	].join(", ");
	const venue = [
		comp.venue?.fullName,
		comp.venue?.address?.city,
		comp.venue?.address?.state,
	]
		.filter(Boolean)
		.join(", ");

	const summary =
		`${feed.label} ${conn} ${oppName}` +
		(comp.neutralSite ? " (Neutral)" : "") +
		(timeValid ? "" : " (Time TBD)");

	const description = [
		tv ? `TV: ${tv}` : null,
		event.week?.text,
		venue,
	].filter(Boolean).join("\n");

	return { id: event.id, start, timeValid, summary, description, venue, feed };
}

function esc(s) {
	return s
		.replaceAll("\\", "\\\\")
		.replaceAll(";", "\\;")
		.replaceAll(",", "\\,")
		.replaceAll("\n", "\\n");
}

function vevent({ id, start, timeValid, summary, description, venue, feed }) {
	const alarm = timeValid
		? `TRIGGER:-PT${feed.alarmHours}H`
		: "TRIGGER:-PT12H";
	const lines = [
		"BEGIN:VEVENT",
		`UID:${id}@nc-canes-calendar`,
		`DTSTAMP:${icsUtc(new Date())}`,
	];
	if (timeValid) {
		const end = new Date(start.getTime() + feed.durationHours * 3600_000);
		lines.push(`DTSTART:${icsUtc(start)}`, `DTEND:${icsUtc(end)}`);
	} else {
		const d = etDate(start).replaceAll("-", "");
		const next = new Date(start.getTime() + 24 * 3600_000);
		lines.push(
			`DTSTART;VALUE=DATE:${d}`,
			`DTEND;VALUE=DATE:${etDate(next).replaceAll("-", "")}`,
		);
	}
	lines.push(`SUMMARY:${esc(summary)}`);
	if (venue) lines.push(`LOCATION:${esc(venue)}`);
	if (description) lines.push(`DESCRIPTION:${esc(description)}`);
	lines.push(
		"BEGIN:VALARM",
		"ACTION:DISPLAY",
		"DESCRIPTION:Game reminder",
		alarm,
		"END:VALARM",
		"END:VEVENT",
	);
	return lines;
}

function fold(line) {
	const bytes = Buffer.from(line, "utf8");
	if (bytes.length <= 75) return line;
	const parts = [];
	let start = 0;
	let limit = 75;
	while (start < bytes.length) {
		let end = Math.min(start + limit, bytes.length);
		while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80)
			end--;
		parts.push(bytes.subarray(start, end).toString("utf8"));
		start = end;
		limit = 74;
	}
	return parts.join("\r\n ");
}

const cutoff = Date.now() - PAST_CUTOFF_DAYS * 24 * 3600_000;
const byId = new Map();
const counts = {};

for (const feed of FEEDS) {
	counts[feed.key] = 0;
	const urls = feed.seasons.flatMap((season) =>
		feed.seasonTypes.map(
			(st) =>
				`https://site.api.espn.com/apis/site/v2/sports/${feed.sport}/teams/${feed.teamParam}/schedule?season=${season}&seasontype=${st}`,
		),
	);
	const responses = await Promise.all(urls.map(fetchJson));
	for (const json of responses) {
		for (const event of json?.events ?? []) {
			if (byId.has(event.id)) continue;
			const parsed = parseEvent(feed, event);
			if (!parsed || parsed.start.getTime() < cutoff) continue;
			byId.set(event.id, parsed);
			counts[feed.key]++;
		}
	}
}

const events = [...byId.values()].sort((a, b) => a.start - b.start);

const ics = [
	"BEGIN:VCALENDAR",
	"VERSION:2.0",
	"PRODID:-//nc-canes-calendar//ESPN schedules//EN",
	"CALSCALE:GREGORIAN",
	"METHOD:PUBLISH",
	"X-WR-CALNAME:NC State + Canes",
	`X-WR-TIMEZONE:${TZ}`,
	"REFRESH-INTERVAL;VALUE=DURATION:PT12H",
	"X-PUBLISHED-TTL:PT12H",
	...events.flatMap(vevent),
	"END:VCALENDAR",
]
	.map(fold)
	.join("\r\n");

writeFileSync(new URL("./calendar.ics", import.meta.url), `${ics}\r\n`);
console.log(
	`Wrote calendar.ics with ${events.length} events —`,
	Object.entries(counts)
		.map(([k, v]) => `${k}: ${v}`)
		.join(", "),
);
