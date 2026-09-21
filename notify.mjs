#!/usr/bin/env node
// Texts a game-day summary via the email-to-SMS gateway when a game is today.
// Cron fires at 14:00 and 15:00 UTC (one is 10am ET year-round); this script
// only proceeds when it is 10am in America/New_York so exactly one runs.
// Env: TEST_DATE (ISO date for local testing), TEST_MESSAGE (bypass detection).

import { appendFileSync, existsSync, readFileSync } from "node:fs";

const TZ = "America/New_York";
const now = process.env.TEST_DATE ? new Date(process.env.TEST_DATE) : new Date();

function et(parts) {
	return new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...parts }).format(now);
}

function setOutput(key, value) {
	const out = process.env.GITHUB_OUTPUT;
	if (out) appendFileSync(out, `${key}=${value}\n`);
}

function setMessage(message) {
	const env = process.env.GITHUB_ENV;
	if (env) {
		appendFileSync(env, `SMS_MESSAGE<<GAMEDAY_EOF\n${message}\nGAMEDAY_EOF\n`);
	} else {
		console.log(message);
	}
}

const testMessage = process.env.TEST_MESSAGE;
if (testMessage) {
	setOutput("games", "true");
	setMessage(testMessage);
	process.exit(0);
}

if (
	Number.parseInt(et({ hour: "numeric", hour12: false }), 10) !== 10 &&
	!process.env.TEST_FORCE
) {
	console.log(`Not 10am ET; skipping.`);
	process.exit(0);
}

if (!existsSync("calendar.ics")) {
	console.error("calendar.ics not found");
	process.exit(1);
}

const unfolded = readFileSync("calendar.ics", "utf8")
	.replace(/\r\n[ \t]/g, "")
	.split(/\r?\n/);

const events = [];
let current = null;
for (const line of unfolded) {
	if (line === "BEGIN:VEVENT") current = {};
	else if (line === "END:VEVENT" && current) {
		events.push(current);
		current = null;
	} else if (current && line.startsWith("DTSTART")) {
		current.dtstart = line.slice(line.indexOf(":") + 1);
	} else if (current && line.startsWith("SUMMARY")) {
		current.summary = line.slice(line.indexOf(":") + 1);
	}
}

const todayEt = new Intl.DateTimeFormat("en-CA", {
	timeZone: TZ,
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
}).format(now);
const todays = [];

for (const { dtstart, summary } of events) {
	if (!dtstart || !summary) continue;
	if (dtstart.length === 8) {
		if (
			`${dtstart.slice(0, 4)}-${dtstart.slice(4, 6)}-${dtstart.slice(6, 8)}` ===
			todayEt
		) {
			todays.push(`${summary} (time TBD)`);
		}
		continue;
	}
	const start = new Date(
		`${dtstart.slice(0, 4)}-${dtstart.slice(4, 6)}-${dtstart.slice(6, 8)}T${dtstart.slice(9, 11)}:${dtstart.slice(11, 13)}:${dtstart.slice(13, 15)}Z`,
	);
	if (Number.isNaN(start.getTime())) continue;
	const dateEt = new Intl.DateTimeFormat("en-CA", {
		timeZone: TZ,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(start);
	if (dateEt !== todayEt) continue;
	const timeEt = new Intl.DateTimeFormat("en-US", {
		timeZone: TZ,
		hour: "numeric",
		minute: "2-digit",
	}).format(start);
	todays.push(`${summary} ${timeEt}`);
}

if (todays.length === 0) {
	setOutput("games", "false");
	console.log(`No games today (${todayEt}).`);
	process.exit(0);
}

const prefix = todays.length === 1 ? "Game day" : `Game day (${todays.length})`;
setMessage(`${prefix}: ${todays.join("; ")}`);
setOutput("games", "true");
console.log(`Games today (${todayEt}): ${todays.join("; ")}`);
