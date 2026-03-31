const fs = require("fs");
const path = require("path");
const axios = require("axios");

loadEnvFile();

const CONFIG = {
    MIN_CONFIDENCE: 66,
    MIN_VALUE_EDGE: 3.5,
    MIN_DATA_QUALITY: 2,
    PARTIAL_STATS_MIN_DATA_QUALITY: 2,
    BALANCED_MAX_RANGE: 8,
    BALANCED_TOP_GAP: 5,
    MIN_WIN_PROBABILITY: 40,
    MIN_DOUBLE_CHANCE_PROBABILITY: 70,
    MIN_TOTALS_PROBABILITY: 58,
    ALLOW_FRIENDLIES: false,
    ALLOW_PARTIAL_STATS_FALLBACK: true,
    MAX_SUGGESTIONS: 2,
    REQUIRE_ODDS: false,
    REQUIRE_STATS: false,
    REQUIRE_PREDICTIONS: false,
    REJECT_BALANCED_PREDICTIONS: false,
    TIME_WINDOW_GRACE_MINUTES: 15,
    ALLOWED_FIXTURE_STATUSES: ["NS", "TBD", "PST", "1H", "HT", "2H"],
    ALLOW_NO_ODDS_SUGGESTIONS: true,
    NO_ODDS_MIN_CONFIDENCE: 60,
};

const API_KEY = process.env.API_FOOTBALL_KEY;
const API_HOST = "v3.football.api-sports.io";
const BASE_URL = `https://${API_HOST}`;

if (!API_KEY) {
    console.error("Missing API_FOOTBALL_KEY environment variable.");
    process.exit(1);
}

const http = axios.create({
    baseURL: BASE_URL,
    timeout: 30000,
    headers: {
        "x-apisports-key": API_KEY,
        "x-rapidapi-host": API_HOST,
    },
});

function loadEnvFile() {
    const envPath = path.join(__dirname, ".env");

    if (!fs.existsSync(envPath)) {
        return;
    }

    const content = fs.readFileSync(envPath, "utf8");
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }

        const separatorIndex = trimmed.indexOf("=");

        if (separatorIndex === -1) {
            continue;
        }

        const key = trimmed.slice(0, separatorIndex).trim();
        const rawValue = trimmed.slice(separatorIndex + 1).trim();
        const value = rawValue.replace(/^['"]|['"]$/g, "");

        if (key && process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

function parseArgs() {
    const args = process.argv.slice(2);
    const out = {
        date: null,
        from: null,
        to: null,
        timezone: "Europe/Athens",
        limit: 200,
        output: null,
    };

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];

        if (arg === "--date") {
            out.date = args[i + 1];
            i += 1;
            continue;
        }

        if (arg === "--from") {
            out.from = args[i + 1];
            i += 1;
            continue;
        }

        if (arg === "--to") {
            out.to = args[i + 1];
            i += 1;
            continue;
        }

        if (arg === "--timezone") {
            out.timezone = args[i + 1];
            i += 1;
            continue;
        }

        if (arg === "--limit") {
            out.limit = Number(args[i + 1]);
            i += 1;
            continue;
        }

        if (arg === "--output") {
            out.output = args[i + 1];
            i += 1;
        }
    }

    if (!out.date || !out.from || !out.to) {
        console.error("Usage: node betting-data.js --date 2026-03-29 --from 19:00 --to 20:00 [--timezone Europe/Athens] [--limit 200]");
        process.exit(1);
    }

    return out;
}

function getDefaultOutputPath(args) {
    if (args.output) {
        return path.resolve(args.output);
    }

    const downloadsDir = path.join(process.env.USERPROFILE || __dirname, "Downloads");
    const fileName = `betting-output-${args.date}-${args.from.replace(":", "-")}-${args.to.replace(":", "-")}.json`;
    return path.join(downloadsDir, fileName);
}

function writeOutputFile(filePath, data) {
    const dirPath = path.dirname(filePath);
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function timeToMinutes(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return (h * 60) + m;
}

function getLocalParts(dateIso, timezone) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    });

    const parts = formatter.formatToParts(new Date(dateIso));
    const map = {};

    for (const p of parts) {
        if (p.type !== "literal") {
            map[p.type] = p.value;
        }
    }

    return {
        date: `${map.year}-${map.month}-${map.day}`,
        time: `${map.hour}:${map.minute}`,
    };
}

function inTimeWindow(dateIso, targetDate, fromTime, toTime, timezone) {
    const local = getLocalParts(dateIso, timezone);

    if (local.date !== targetDate) {
        return false;
    }

    const current = timeToMinutes(local.time);
    const grace = CONFIG.TIME_WINDOW_GRACE_MINUTES || 0;
    const from = timeToMinutes(fromTime) - grace;
    const to = timeToMinutes(toTime) + grace;

    return current >= from && current <= to;
}

function safeGet(obj, pathExpression, fallback = null) {
    try {
        const value = pathExpression.split(".").reduce((acc, key) => acc[key], obj);
        return value ?? fallback;
    } catch (error) {
        return fallback;
    }
}

function roundNumber(value, digits = 2) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
        return null;
    }

    return Number(Number(value).toFixed(digits));
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function mean(values) {
    const valid = values.filter((value) => Number.isFinite(value));

    if (valid.length === 0) {
        return null;
    }

    const total = valid.reduce((sum, value) => sum + value, 0);
    return total / valid.length;
}

function parsePercent(value) {
    if (!value) {
        return 0;
    }

    return Number(String(value).replace("%", "").trim()) || 0;
}

function parseGoalsValue(value) {
    if (value === null || value === undefined) {
        return null;
    }

    const parsed = Number(String(value).replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeProbability(value) {
    return clamp(roundNumber(value, 2) || 0, 0, 100);
}

async function apiGet(url, params = {}) {
    try {
        const res = await http.get(url, { params });
        return res.data;
    } catch (error) {
        const responseData = error.response?.data;

        return {
            errors: {
                message: error.message,
                status: error.response?.status || null,
                details: responseData?.errors ?? responseData ?? null,
            },
            response: Array.isArray(responseData?.response) ? responseData.response : [],
        };
    }
}

function hasApiErrors(errors) {
    if (!errors) {
        return false;
    }

    if (Array.isArray(errors)) {
        return errors.length > 0;
    }

    if (typeof errors === "object") {
        return Object.keys(errors).length > 0;
    }

    if (typeof errors === "string") {
        return errors.trim().length > 0;
    }

    return true;
}

function formatApiErrorDetails(errors) {
    if (!errors) {
        return "Unknown API error";
    }

    if (typeof errors === "string") {
        return errors;
    }

    if (typeof errors === "object") {
        return JSON.stringify(errors);
    }

    return String(errors);
}

async function getFixturesByDate(date, timezone) {
    const data = await apiGet("/fixtures", { date, timezone });

    if (hasApiErrors(data.errors)) {
        throw new Error(`Failed to fetch fixtures for ${date} (${timezone}): ${formatApiErrorDetails(data.errors)}`);
    }

    return Array.isArray(data.response) ? data.response : [];
}

async function getPrediction(fixtureId) {
    const data = await apiGet("/predictions", { fixture: fixtureId });
    return Array.isArray(data.response) && data.response.length > 0 ? data.response[0] : null;
}

async function getStandings(leagueId, season, teamId) {
    const data = await apiGet("/standings", { league: leagueId, season });
    const response = Array.isArray(data.response) ? data.response : [];

    for (const leagueBlock of response) {
        const standingsGroups = leagueBlock.league?.standings || [];

        for (const group of standingsGroups) {
            for (const row of group) {
                if (row.team?.id === teamId) {
                    return {
                        rank: row.rank,
                        points: row.points,
                        goalsDiff: row.goalsDiff,
                        form: row.form,
                    };
                }
            }
        }
    }

    return null;
}

async function getTeamStatistics(leagueId, season, teamId) {
    const data = await apiGet("/teams/statistics", {
        league: leagueId,
        season,
        team: teamId,
    });

    return Array.isArray(data.response) && data.response.length > 0 ? data.response[0] : data.response || null;
}

async function getH2H(homeTeamId, awayTeamId) {
    const data = await apiGet("/fixtures/headtohead", {
        h2h: `${homeTeamId}-${awayTeamId}`,
        last: 5,
    });

    return Array.isArray(data.response) ? data.response : [];
}

async function getOdds(fixtureId) {
    const data = await apiGet("/odds", { fixture: fixtureId });
    return Array.isArray(data.response) ? data.response : [];
}

function summarizeStats(stats) {
    if (!stats) {
        return null;
    }

    return {
        form: stats.form || null,
        fixturesPlayed: safeGet(stats, "fixtures.played.total"),
        wins: safeGet(stats, "fixtures.wins.total"),
        draws: safeGet(stats, "fixtures.draws.total"),
        losses: safeGet(stats, "fixtures.loses.total"),
        goalsForAvg: Number(safeGet(stats, "goals.for.average.total")) || null,
        goalsAgainstAvg: Number(safeGet(stats, "goals.against.average.total")) || null,
        homeGoalsForAvg: Number(safeGet(stats, "goals.for.average.home")) || null,
        awayGoalsForAvg: Number(safeGet(stats, "goals.for.average.away")) || null,
        homeGoalsAgainstAvg: Number(safeGet(stats, "goals.against.average.home")) || null,
        awayGoalsAgainstAvg: Number(safeGet(stats, "goals.against.average.away")) || null,
        cleanSheets: Number(safeGet(stats, "clean_sheet.total")) || 0,
        cleanSheetsHome: Number(safeGet(stats, "clean_sheet.home")) || 0,
        cleanSheetsAway: Number(safeGet(stats, "clean_sheet.away")) || 0,
        failedToScore: Number(safeGet(stats, "failed_to_score.total")) || 0,
        failedToScoreHome: Number(safeGet(stats, "failed_to_score.home")) || 0,
        failedToScoreAway: Number(safeGet(stats, "failed_to_score.away")) || 0,
    };
}

function summarizeH2H(h2h) {
    return h2h.map((match) => ({
        date: safeGet(match, "fixture.date"),
        home: safeGet(match, "teams.home.name"),
        away: safeGet(match, "teams.away.name"),
        homeGoals: Number(safeGet(match, "goals.home")),
        awayGoals: Number(safeGet(match, "goals.away")),
        score: `${safeGet(match, "goals.home", "?")}-${safeGet(match, "goals.away", "?")}`,
    }));
}

function getFormPoints(form) {
    if (!form) {
        return 0;
    }

    return form
        .split("")
        .slice(-5)
        .reduce((total, result) => {
            if (result === "W") {
                return total + 3;
            }

            if (result === "D") {
                return total + 1;
            }

            return total;
        }, 0);
}

function getPerFixtureRate(total, played) {
    if (!played || !Number.isFinite(total)) {
        return null;
    }

    return total / played;
}

function hasBasicStatsData(match) {
    const homeStats = match.homeTeam.statistics;
    const awayStats = match.awayTeam.statistics;

    return Boolean(
        homeStats?.goalsForAvg !== null &&
        homeStats?.goalsAgainstAvg !== null &&
        awayStats?.goalsForAvg !== null &&
        awayStats?.goalsAgainstAvg !== null &&
        (homeStats?.form || awayStats?.form)
    );
}

function hasStandingsData(match) {
    return Boolean(match.homeTeam.standing?.rank && match.awayTeam.standing?.rank);
}

function hasOddsData(match) {
    return Object.keys(match.marketOdds || {}).length > 0;
}

function canUsePartialStatsFallback(match) {
    return Boolean(
        CONFIG.ALLOW_PARTIAL_STATS_FALLBACK &&
        hasOddsData(match) &&
        match.prediction &&
        !hasBasicStatsData(match) &&
        getDataQuality(match) >= CONFIG.PARTIAL_STATS_MIN_DATA_QUALITY &&
        !isFriendlyCompetition(match) &&
        !isBalancedPrediction(match)
    );
}

function getDataQuality(match) {
    let score = 0;

    if (match.prediction) {
        score += 2;
    }

    if (hasBasicStatsData(match)) {
        score += 2;
    }

    if (hasStandingsData(match)) {
        score += 1;
    }

    if (match.h2hLast5.length > 0) {
        score += 1;
    }

    if (Object.keys(match.marketOdds).length > 0) {
        score += 2;
    }

    return score;
}

function isPostponed(match) {
    const status = match.fixture.status?.short || "";
    return ["PST", "CANC", "ABD", "AWD", "WO"].includes(status);
}

function isFriendlyCompetition(match) {
    const textParts = [
        match.league.country,
        match.league.name,
        match.league.round,
        safeGet(match, "prediction.winner.comment"),
        safeGet(match, "fixture.status.long"),
    ].filter(Boolean);
    const combined = textParts.join(" ").toLowerCase();
    const friendlySignals = [
        "friendly",
        "friendlies",
        "club friendlies",
        "friendly international",
        "international friendly",
        "world friendlies",
    ];

    return friendlySignals.some((signal) => combined.includes(signal));
}

function isBalancedPrediction(match) {
    const percent = match.prediction?.percent;

    if (!percent) {
        return false;
    }

    const values = [parsePercent(percent.home), parsePercent(percent.draw), parsePercent(percent.away)].sort((a, b) => b - a);
    const range = values[0] - values[2];
    const topGap = values[0] - values[1];

    return range <= CONFIG.BALANCED_MAX_RANGE && topGap <= CONFIG.BALANCED_TOP_GAP;
}

function normalizeOddLabel(rawValue) {
    const value = String(rawValue || "").trim();
    const lower = value.toLowerCase();

    if (["home", "1"].includes(lower)) {
        return "1";
    }

    if (["draw", "x"].includes(lower)) {
        return "X";
    }

    if (["away", "2"].includes(lower)) {
        return "2";
    }

    if (["home/draw", "1x"].includes(lower)) {
        return "1X";
    }

    if (["draw/away", "x2"].includes(lower)) {
        return "X2";
    }

    if (["home/away", "12"].includes(lower)) {
        return "12";
    }

    if (lower === "yes") {
        return "GG";
    }

    if (lower === "no") {
        return "No GG";
    }

    if (/^[+-]?\d+(\.\d+)?$/.test(lower)) {
        const numeric = Number(lower);
        return numeric < 0 ? `Under ${Math.abs(numeric)}` : `Over ${numeric}`;
    }

    if (lower.startsWith("over ") || lower.startsWith("under ")) {
        return value.replace(/\s+/g, " ");
    }

    return value;
}

function pushBestOdd(store, market, label, bookmaker, odd) {
    if (!Number.isFinite(odd) || odd <= 1) {
        return;
    }

    if (!store[market]) {
        store[market] = {};
    }

    const current = store[market][label];

    if (!current || odd > current.odd) {
        store[market][label] = {
            odd,
            bookmaker,
        };
    }
}

function extractMarketOdds(oddsResponse) {
    const markets = {};

    for (const item of oddsResponse) {
        for (const bookmaker of item.bookmakers || []) {
            for (const bet of bookmaker.bets || []) {
                const betName = String(bet.name || "").toLowerCase();

                if (betName.includes("match winner") || betName === "winner") {
                    for (const value of bet.values || []) {
                        pushBestOdd(markets, "1X2", normalizeOddLabel(value.value), bookmaker.name, Number(value.odd));
                    }
                }

                if (betName.includes("double chance")) {
                    for (const value of bet.values || []) {
                        pushBestOdd(markets, "Double Chance", normalizeOddLabel(value.value), bookmaker.name, Number(value.odd));
                    }
                }

                if (betName.includes("draw no bet")) {
                    for (const value of bet.values || []) {
                        pushBestOdd(markets, "DNB", normalizeOddLabel(value.value), bookmaker.name, Number(value.odd));
                    }
                }

                if (betName.includes("both teams score")) {
                    for (const value of bet.values || []) {
                        pushBestOdd(markets, "BTTS", normalizeOddLabel(value.value), bookmaker.name, Number(value.odd));
                    }
                }

                if (betName.includes("goals over/under") || betName.includes("over/under")) {
                    for (const value of bet.values || []) {
                        const label = normalizeOddLabel(value.value);

                        if (["Over 1.5", "Over 2.5", "Under 3.5"].includes(label)) {
                            pushBestOdd(markets, "Totals", label, bookmaker.name, Number(value.odd));
                        }
                    }
                }
            }
        }
    }

    return markets;
}

function getMarketOdd(match, market, pick) {
    return match.marketOdds?.[market]?.[pick] || null;
}

function getImpliedProbability(odd) {
    if (!odd || odd <= 0) {
        return null;
    }

    return roundNumber(100 / odd, 2);
}

function getDnbImpliedProbability(odd, drawProbability) {
    if (!odd || odd <= 0) {
        return null;
    }

    return roundNumber((100 - drawProbability) / odd, 2);
}

function poissonProbability(lambda, goals) {
    if (!Number.isFinite(lambda) || lambda < 0 || goals < 0) {
        return 0;
    }

    let factorial = 1;

    for (let i = 2; i <= goals; i += 1) {
        factorial *= i;
    }

    return (Math.exp(-lambda) * (lambda ** goals)) / factorial;
}

function cumulativePoisson(lambda, maxGoals) {
    let total = 0;

    for (let goals = 0; goals <= maxGoals; goals += 1) {
        total += poissonProbability(lambda, goals);
    }

    return total;
}

function getExpectedGoals(match) {
    const predictionHomeGoals = parseGoalsValue(match.prediction?.goalsHome);
    const predictionAwayGoals = parseGoalsValue(match.prediction?.goalsAway);

    const homeAttack = mean([
        match.homeTeam.statistics?.homeGoalsForAvg,
        match.homeTeam.statistics?.goalsForAvg,
        predictionHomeGoals,
    ]);
    const awayDefense = mean([
        match.awayTeam.statistics?.awayGoalsAgainstAvg,
        match.awayTeam.statistics?.goalsAgainstAvg,
    ]);
    const awayAttack = mean([
        match.awayTeam.statistics?.awayGoalsForAvg,
        match.awayTeam.statistics?.goalsForAvg,
        predictionAwayGoals,
    ]);
    const homeDefense = mean([
        match.homeTeam.statistics?.homeGoalsAgainstAvg,
        match.homeTeam.statistics?.goalsAgainstAvg,
    ]);

    const homeExpected = mean([homeAttack, awayDefense, predictionHomeGoals]);
    const awayExpected = mean([awayAttack, homeDefense, predictionAwayGoals]);

    return {
        home: roundNumber(homeExpected || 0, 2),
        away: roundNumber(awayExpected || 0, 2),
        total: roundNumber((homeExpected || 0) + (awayExpected || 0), 2),
    };
}

function getGoalModelProbabilities(expectedGoals) {
    const totalLambda = expectedGoals.total || 0;
    const homeLambda = expectedGoals.home || 0;
    const awayLambda = expectedGoals.away || 0;

    const under1 = cumulativePoisson(totalLambda, 1);
    const under2 = cumulativePoisson(totalLambda, 2);
    const under3 = cumulativePoisson(totalLambda, 3);
    const homeBlank = poissonProbability(homeLambda, 0);
    const awayBlank = poissonProbability(awayLambda, 0);
    const bothTeamsScore = (1 - homeBlank) * (1 - awayBlank);

    return {
        over15: normalizeProbability((1 - under1) * 100),
        over25: normalizeProbability((1 - under2) * 100),
        under35: normalizeProbability(under3 * 100),
        gg: normalizeProbability(bothTeamsScore * 100),
        noGg: normalizeProbability((1 - bothTeamsScore) * 100),
    };
}

function getH2HFactor(match) {
    if (!match.h2hLast5.length) {
        return 0;
    }

    const recent = match.h2hLast5.slice(0, 3);
    let homeEdge = 0;
    let awayEdge = 0;

    for (const item of recent) {
        const homeGoals = Number.isFinite(item.homeGoals) ? item.homeGoals : null;
        const awayGoals = Number.isFinite(item.awayGoals) ? item.awayGoals : null;

        if (homeGoals === null || awayGoals === null) {
            continue;
        }

        const homeTeamIsCurrentHome = item.home === match.homeTeam.name;
        const currentHomeGoals = homeTeamIsCurrentHome ? homeGoals : awayGoals;
        const currentAwayGoals = homeTeamIsCurrentHome ? awayGoals : homeGoals;

        if (currentHomeGoals > currentAwayGoals) {
            homeEdge += 1;
        } else if (currentAwayGoals > currentHomeGoals) {
            awayEdge += 1;
        }
    }

    return clamp((homeEdge - awayEdge) * 0.75, -1.5, 1.5);
}

function getResultModel(match) {
    const percent = match.prediction?.percent || {};
    const homeBase = parsePercent(percent.home);
    const drawBase = parsePercent(percent.draw);
    const awayBase = parsePercent(percent.away);

    const homeFormPoints = getFormPoints(match.homeTeam.statistics?.form || match.homeTeam.standing?.form || "");
    const awayFormPoints = getFormPoints(match.awayTeam.statistics?.form || match.awayTeam.standing?.form || "");
    const formEdge = clamp((homeFormPoints - awayFormPoints) * 0.8, -6, 6);

    const homeRank = match.homeTeam.standing?.rank || 99;
    const awayRank = match.awayTeam.standing?.rank || 99;
    const rankGap = clamp((awayRank - homeRank) * 0.9, -8, 8);

    const homeAttack = mean([match.homeTeam.statistics?.homeGoalsForAvg, match.homeTeam.statistics?.goalsForAvg]) || 0;
    const awayAttack = mean([match.awayTeam.statistics?.awayGoalsForAvg, match.awayTeam.statistics?.goalsForAvg]) || 0;
    const homeDefense = mean([match.homeTeam.statistics?.homeGoalsAgainstAvg, match.homeTeam.statistics?.goalsAgainstAvg]) || 0;
    const awayDefense = mean([match.awayTeam.statistics?.awayGoalsAgainstAvg, match.awayTeam.statistics?.goalsAgainstAvg]) || 0;
    const goalEdge = clamp(((homeAttack - awayDefense) - (awayAttack - homeDefense)) * 5, -7, 7);

    const cleanSheetHomeRate = getPerFixtureRate(match.homeTeam.statistics?.cleanSheets, match.homeTeam.statistics?.fixturesPlayed) || 0;
    const cleanSheetAwayRate = getPerFixtureRate(match.awayTeam.statistics?.cleanSheets, match.awayTeam.statistics?.fixturesPlayed) || 0;
    const failedScoreHomeRate = getPerFixtureRate(match.homeTeam.statistics?.failedToScore, match.homeTeam.statistics?.fixturesPlayed) || 0;
    const failedScoreAwayRate = getPerFixtureRate(match.awayTeam.statistics?.failedToScore, match.awayTeam.statistics?.fixturesPlayed) || 0;
    const reliabilityEdge = clamp(((cleanSheetHomeRate - failedScoreHomeRate) - (cleanSheetAwayRate - failedScoreAwayRate)) * 10, -4, 4);
    const h2hFactor = getH2HFactor(match);

    const homeWin = normalizeProbability(homeBase + formEdge + rankGap + goalEdge + reliabilityEdge + h2hFactor);
    const awayWin = normalizeProbability(awayBase - formEdge - rankGap - goalEdge - reliabilityEdge - h2hFactor);
    const drawAdjustment = clamp((6 - Math.abs(formEdge) - Math.abs(goalEdge / 2)) + (Math.abs(homeBase - awayBase) < 6 ? 3 : 0), -6, 6);
    const draw = normalizeProbability(drawBase + drawAdjustment);

    return {
        homeWin,
        draw,
        awayWin,
        strengthGap: roundNumber(Math.abs(homeWin - awayWin), 2),
        rankGap: Math.abs((match.homeTeam.standing?.rank || 99) - (match.awayTeam.standing?.rank || 99)),
        formGap: Math.abs(homeFormPoints - awayFormPoints),
        goalEdge: roundNumber(goalEdge, 2),
        h2hFactor: roundNumber(h2hFactor, 2),
    };
}

function getMatchWarnings(match) {
    const warnings = [];

    if (match.h2hLast5.length === 0) {
        warnings.push("missing h2h context");
    }

    if (!hasStandingsData(match)) {
        warnings.push("missing standings context");
    }

    if (Object.keys(match.marketOdds).length <= 2) {
        warnings.push("limited odds coverage across markets");
    }

    if (canUsePartialStatsFallback(match)) {
        warnings.push("partial data fallback used");
    }

    return warnings;
}

function getMatchLevelRejectionReasons(match) {
    const reasons = [];
    const partialFallback = canUsePartialStatsFallback(match);

    if (isPostponed(match)) {
        reasons.push("postponed fixture");
    }

    if (!CONFIG.ALLOW_FRIENDLIES && isFriendlyCompetition(match)) {
        reasons.push("friendly competition excluded");
    }

    if (CONFIG.REQUIRE_PREDICTIONS && !match.prediction) {
        reasons.push("missing predictions");
    }

    if (CONFIG.REQUIRE_STATS && !hasBasicStatsData(match) && !partialFallback) {
        reasons.push("missing basic team stats");
    }

    if (CONFIG.REQUIRE_ODDS && !hasOddsData(match)) {
        reasons.push("missing odds");
    }

    if (CONFIG.REJECT_BALANCED_PREDICTIONS && match.prediction && isBalancedPrediction(match)) {
        reasons.push("balanced prediction profile");
    }

    const minDataQuality = partialFallback ? CONFIG.PARTIAL_STATS_MIN_DATA_QUALITY : CONFIG.MIN_DATA_QUALITY;

    if (getDataQuality(match) < minDataQuality) {
        reasons.push(`data quality below threshold (${getDataQuality(match)}/${minDataQuality})`);
    }

    return reasons;
}

function buildReasonList(match, market, estimatedProbability, impliedProbability, valueScore, modelMeta) {
    const reasons = [];

    if (market === "1X") {
        reasons.push(`home+draw model ${roundNumber(estimatedProbability, 1)}%`);
    }

    if (market === "X2") {
        reasons.push(`away+draw model ${roundNumber(estimatedProbability, 1)}%`);
    }

    if (market === "DNB") {
        reasons.push(`${modelMeta.side} win model ${roundNumber(estimatedProbability, 1)}%`);
    }

    if (["Over 1.5", "Over 2.5", "Under 3.5", "GG", "No GG"].includes(market)) {
        reasons.push(`goal model ${roundNumber(estimatedProbability, 1)}%`);
        reasons.push(`expected goals ${roundNumber(modelMeta.expectedGoals?.total, 2)}`);
    }

    if (modelMeta.rankGap >= 4) {
        reasons.push(`rank gap ${modelMeta.rankGap}`);
    }

    if (modelMeta.formGap >= 3) {
        reasons.push("clear recent form gap");
    }

    if (Math.abs(modelMeta.goalEdge || 0) >= 2.5 && ["1X", "X2", "DNB"].includes(market)) {
        reasons.push("home/away split supports the side");
    }

    if (Math.abs(modelMeta.h2hFactor || 0) >= 0.75) {
        reasons.push("h2h adds a small supporting lean");
    }

    if (valueScore >= CONFIG.MIN_VALUE_EDGE) {
        reasons.push(`value edge ${roundNumber(valueScore, 2)} pts over implied ${roundNumber(impliedProbability, 2)}%`);
    }

    return reasons.slice(0, 5);
}

function buildCandidateWarningList(match, market, valueScore, confidence) {
    const warnings = [...getMatchWarnings(match)];

    if (valueScore < CONFIG.MIN_VALUE_EDGE + 2) {
        warnings.push("edge is positive but not huge");
    }

    if (confidence < CONFIG.MIN_CONFIDENCE + 5) {
        warnings.push("confidence only slightly above threshold");
    }

    if (market === "DNB") {
        warnings.push("DNB implied probability is adjusted with draw probability fallback");
    }

    return [...new Set(warnings)].slice(0, 4);
}

function getCandidateStrength(estimatedProbability, market, modelMeta) {
    if (["Over 1.5", "Over 2.5", "Under 3.5", "GG", "No GG"].includes(market)) {
        const total = modelMeta.expectedGoals?.total || 0;
        return clamp((estimatedProbability / 100) + (total / 6), 0, 1.4);
    }

    return clamp((estimatedProbability / 100) + ((modelMeta.strengthGap || 0) / 30), 0, 1.4);
}

function computeConfidence(match, market, estimatedProbability, valueScore, modelMeta, warningsCount) {
    const dataQuality = getDataQuality(match);
    const strength = getCandidateStrength(estimatedProbability, market, modelMeta);
    const confidence = 38 + (dataQuality * 6) + (strength * 18) + (Math.max(valueScore, 0) * 2.2) - (warningsCount * 2.5);
    return clamp(Math.round(confidence), 0, 100);
}

function buildCandidate(match, market, pick, oddsInfo, estimatedProbability, impliedProbability, modelMeta, options = {}) {
    const reasons = [];
    const rejectionReasons = [];
    const partialFallbackUsed = Boolean(options.partialFallbackUsed);
    const allowedInPartialFallback = ["1X", "X2", "Under 3.5"].includes(market);

    if (partialFallbackUsed && !allowedInPartialFallback) {
        rejectionReasons.push("market not allowed in partial data fallback");
    }

    if (!oddsInfo) {
        rejectionReasons.push("missing odds for market");
    }

    if (!Number.isFinite(estimatedProbability)) {
        rejectionReasons.push("missing estimated probability");
    }

    if (!Number.isFinite(impliedProbability)) {
        rejectionReasons.push("missing implied probability");
    }

    const valueScore = Number.isFinite(estimatedProbability) && Number.isFinite(impliedProbability)
        ? roundNumber(estimatedProbability - impliedProbability, 2)
        : null;

    if (market === "1X" || market === "X2") {
        if (estimatedProbability < CONFIG.MIN_DOUBLE_CHANCE_PROBABILITY) {
            rejectionReasons.push("estimated probability below double chance threshold");
        }
    }

    if (market === "DNB") {
        if (estimatedProbability < CONFIG.MIN_WIN_PROBABILITY) {
            rejectionReasons.push("estimated win probability below DNB threshold");
        }
    }

    if (["Over 1.5", "Over 2.5", "Under 3.5", "GG", "No GG"].includes(market)) {
        if (estimatedProbability < CONFIG.MIN_TOTALS_PROBABILITY) {
            rejectionReasons.push("estimated probability below totals threshold");
        }
    }

    if (valueScore !== null && valueScore < CONFIG.MIN_VALUE_EDGE) {
        rejectionReasons.push("value score below threshold");
    }

    reasons.push(...buildReasonList(match, market, estimatedProbability, impliedProbability, valueScore, modelMeta));

    const warnings = buildCandidateWarningList(match, market, valueScore || 0, 0);
    const confidence = computeConfidence(match, market, estimatedProbability, valueScore || 0, modelMeta, warnings.length);

    if (confidence < CONFIG.MIN_CONFIDENCE) {
        rejectionReasons.push("confidence below threshold");
    }

    return {
        match: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
        kickoff: `${match.fixture.localDate} ${match.fixture.localTime}`,
        competition: formatCompetitionLabel(match.league),
        market,
        pick,
        odds: oddsInfo ? roundNumber(oddsInfo.odd, 2) : null,
        bookmaker: oddsInfo?.bookmaker || null,
        estimatedProbability: roundNumber(estimatedProbability, 2),
        impliedProbability: roundNumber(impliedProbability, 2),
        valueScore,
        confidence,
        reasons,
        warnings: buildCandidateWarningList(match, market, valueScore || 0, confidence),
        rejectionReasons: [...new Set(rejectionReasons)],
        partialFallbackUsed,
        qualified: rejectionReasons.length === 0,
    };
}

function formatCompetitionLabel(league) {
    const parts = [league.country, league.name].filter(Boolean);
    const base = parts.join(" - ");

    if (league.round) {
        return `${base} (${league.round})`;
    }

    return base || "Unknown competition";
}

function buildMarketCandidates(match) {
    const candidates = [];
    const partialFallbackUsed = canUsePartialStatsFallback(match);
    const resultModel = getResultModel(match);
    const expectedGoals = getExpectedGoals(match);
    const goalModel = getGoalModelProbabilities(expectedGoals);

    const homeDoubleChance = normalizeProbability(resultModel.homeWin + resultModel.draw);
    const awayDoubleChance = normalizeProbability(resultModel.awayWin + resultModel.draw);
    const predictionWinner = match.prediction?.winner?.name || null;
    const sideLean = predictionWinner === match.homeTeam.name ? "home" : predictionWinner === match.awayTeam.name ? "away" : null;
    const candidateOptions = { partialFallbackUsed };

    candidates.push(buildCandidate(
        match,
        "1X",
        "1X",
        getMarketOdd(match, "Double Chance", "1X"),
        homeDoubleChance,
        getImpliedProbability(getMarketOdd(match, "Double Chance", "1X")?.odd),
        {
            ...resultModel,
            expectedGoals,
            side: "home",
        },
        candidateOptions
    ));

    candidates.push(buildCandidate(
        match,
        "X2",
        "X2",
        getMarketOdd(match, "Double Chance", "X2"),
        awayDoubleChance,
        getImpliedProbability(getMarketOdd(match, "Double Chance", "X2")?.odd),
        {
            ...resultModel,
            expectedGoals,
            side: "away",
        },
        candidateOptions
    ));

    if (!partialFallbackUsed && sideLean === "home") {
        candidates.push(buildCandidate(
            match,
            "DNB",
            `${match.homeTeam.name} DNB`,
            getMarketOdd(match, "DNB", "1") || getMarketOdd(match, "DNB", "Home"),
            resultModel.homeWin,
            getDnbImpliedProbability((getMarketOdd(match, "DNB", "1") || getMarketOdd(match, "DNB", "Home"))?.odd, resultModel.draw),
            {
                ...resultModel,
                expectedGoals,
                side: match.homeTeam.name,
            },
            candidateOptions
        ));
    }

    if (!partialFallbackUsed && sideLean === "away") {
        candidates.push(buildCandidate(
            match,
            "DNB",
            `${match.awayTeam.name} DNB`,
            getMarketOdd(match, "DNB", "2") || getMarketOdd(match, "DNB", "Away"),
            resultModel.awayWin,
            getDnbImpliedProbability((getMarketOdd(match, "DNB", "2") || getMarketOdd(match, "DNB", "Away"))?.odd, resultModel.draw),
            {
                ...resultModel,
                expectedGoals,
                side: match.awayTeam.name,
            },
            candidateOptions
        ));
    }

    if (!partialFallbackUsed) {
        candidates.push(buildCandidate(
            match,
            "Over 1.5",
            "Over 1.5",
            getMarketOdd(match, "Totals", "Over 1.5"),
            goalModel.over15,
            getImpliedProbability(getMarketOdd(match, "Totals", "Over 1.5")?.odd),
            {
                ...resultModel,
                expectedGoals,
            },
            candidateOptions
        ));

        candidates.push(buildCandidate(
            match,
            "Over 2.5",
            "Over 2.5",
            getMarketOdd(match, "Totals", "Over 2.5"),
            goalModel.over25,
            getImpliedProbability(getMarketOdd(match, "Totals", "Over 2.5")?.odd),
            {
                ...resultModel,
                expectedGoals,
            },
            candidateOptions
        ));
    }

    candidates.push(buildCandidate(
        match,
        "Under 3.5",
        "Under 3.5",
        getMarketOdd(match, "Totals", "Under 3.5"),
        goalModel.under35,
        getImpliedProbability(getMarketOdd(match, "Totals", "Under 3.5")?.odd),
        {
            ...resultModel,
            expectedGoals,
        },
        candidateOptions
    ));

    if (!partialFallbackUsed) {
        candidates.push(buildCandidate(
            match,
            "GG",
            "GG",
            getMarketOdd(match, "BTTS", "GG"),
            goalModel.gg,
            getImpliedProbability(getMarketOdd(match, "BTTS", "GG")?.odd),
            {
                ...resultModel,
                expectedGoals,
            },
            candidateOptions
        ));

        candidates.push(buildCandidate(
            match,
            "No GG",
            "No GG",
            getMarketOdd(match, "BTTS", "No GG"),
            goalModel.noGg,
            getImpliedProbability(getMarketOdd(match, "BTTS", "No GG")?.odd),
            {
                ...resultModel,
                expectedGoals,
            },
            candidateOptions
        ));
    }

    return candidates;
}

function pickBestQualifiedCandidates(candidates) {
    return candidates
        .filter((candidate) => candidate.rejectionReasons.length === 0)
        .sort((a, b) => {
            if (b.valueScore !== a.valueScore) {
                return b.valueScore - a.valueScore;
            }

            return b.confidence - a.confidence;
        });
}

function pickBestFallbackCandidates(candidates) {
    const allowedFallbackRejections = new Set([
        "missing odds for market",
        "missing implied probability",
        "confidence below threshold",
    ]);

    return candidates
        .filter((candidate) => CONFIG.ALLOW_NO_ODDS_SUGGESTIONS)
        .filter((candidate) => candidate.confidence >= CONFIG.NO_ODDS_MIN_CONFIDENCE)
        .filter((candidate) => candidate.rejectionReasons.every((reason) => allowedFallbackRejections.has(reason)))
        .sort((a, b) => {
            if (b.confidence !== a.confidence) {
                return b.confidence - a.confidence;
            }

            return b.estimatedProbability - a.estimatedProbability;
        })
        .map((candidate) => ({
            ...candidate,
            selectionMode: "no_odds_test_fallback",
            warnings: [...new Set([...candidate.warnings, "fallback suggestion without odds/value validation"])],
        }));
}

function compactStanding(standing) {
    if (!standing) {
        return null;
    }

    return {
        rank: standing.rank,
        points: standing.points,
        goalsDiff: standing.goalsDiff,
        form: standing.form,
    };
}

function compactStats(stats) {
    if (!stats) {
        return null;
    }

    return {
        form: stats.form,
        goalsForAvg: stats.goalsForAvg,
        goalsAgainstAvg: stats.goalsAgainstAvg,
        homeGoalsForAvg: stats.homeGoalsForAvg,
        awayGoalsForAvg: stats.awayGoalsForAvg,
        homeGoalsAgainstAvg: stats.homeGoalsAgainstAvg,
        awayGoalsAgainstAvg: stats.awayGoalsAgainstAvg,
        cleanSheets: stats.cleanSheets,
        failedToScore: stats.failedToScore,
    };
}

function compactPrediction(prediction) {
    if (!prediction) {
        return null;
    }

    return {
        winner: prediction.winner ? {
            name: prediction.winner.name,
            comment: prediction.winner.comment,
        } : null,
        advice: prediction.advice,
        underOver: prediction.underOver,
        goalsHome: prediction.goalsHome,
        goalsAway: prediction.goalsAway,
        percent: prediction.percent,
    };
}

function compactCandidate(candidate) {
    return {
        market: candidate.market,
        pick: candidate.pick,
        odds: candidate.odds,
        estimatedProbability: candidate.estimatedProbability,
        impliedProbability: candidate.impliedProbability,
        valueScore: candidate.valueScore,
        confidence: candidate.confidence,
        reasons: candidate.reasons,
        warnings: candidate.warnings,
        qualified: candidate.qualified,
        partialFallbackUsed: candidate.partialFallbackUsed,
        rejectionReasons: candidate.rejectionReasons,
    };
}

function analyzeMatch(match) {
    const matchWarnings = getMatchWarnings(match);
    const matchRejectionReasons = getMatchLevelRejectionReasons(match);
    const candidates = buildMarketCandidates(match);
    const qualifiedCandidates = pickBestQualifiedCandidates(candidates);
    const fallbackCandidates = pickBestFallbackCandidates(candidates);
    const suggestedCandidate = qualifiedCandidates[0] || fallbackCandidates[0] || null;

    const allMatch = {
        match: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
        kickoff: `${match.fixture.localDate} ${match.fixture.localTime}`,
        competition: formatCompetitionLabel(match.league),
        status: match.fixture.status?.short || null,
        isFriendly: isFriendlyCompetition(match),
        dataQuality: getDataQuality(match),
        warnings: matchWarnings,
        rejectionReasons: matchRejectionReasons,
        teams: {
            home: {
                name: match.homeTeam.name,
                standing: compactStanding(match.homeTeam.standing),
                statistics: compactStats(match.homeTeam.statistics),
            },
            away: {
                name: match.awayTeam.name,
                standing: compactStanding(match.awayTeam.standing),
                statistics: compactStats(match.awayTeam.statistics),
            },
        },
        prediction: compactPrediction(match.prediction),
        usedPartialStatsFallback: canUsePartialStatsFallback(match),
        marketOdds: match.marketOdds,
        evaluatedMarkets: candidates.map(compactCandidate),
        topQualifiedMarket: qualifiedCandidates[0] ? compactCandidate(qualifiedCandidates[0]) : null,
    };

    if (matchRejectionReasons.length > 0) {
        return {
            allMatch,
            filteredOutMatch: {
                match: allMatch.match,
                kickoff: allMatch.kickoff,
                competition: allMatch.competition,
                reasons: matchRejectionReasons,
                warnings: matchWarnings,
            },
            suggestedCandidate: null,
        };
    }

    if (!suggestedCandidate) {
        const candidateReasons = [...new Set(candidates.flatMap((candidate) => candidate.rejectionReasons))];

        return {
            allMatch,
            filteredOutMatch: {
                match: allMatch.match,
                kickoff: allMatch.kickoff,
                competition: allMatch.competition,
                reasons: candidateReasons.length > 0 ? candidateReasons : ["no market passed value filters"],
                warnings: matchWarnings,
            },
            suggestedCandidate: null,
        };
    }

    return {
        allMatch,
        filteredOutMatch: null,
        suggestedCandidate,
    };
}

async function enrichFixture(fixture, timezone) {
    const fixtureId = fixture.fixture.id;
    const leagueId = fixture.league.id;
    const season = fixture.league.season;
    const homeTeamId = fixture.teams.home.id;
    const awayTeamId = fixture.teams.away.id;

    const [
        prediction,
        homeStanding,
        awayStanding,
        homeStatsRaw,
        awayStatsRaw,
        h2h,
        odds,
    ] = await Promise.all([
        getPrediction(fixtureId),
        getStandings(leagueId, season, homeTeamId),
        getStandings(leagueId, season, awayTeamId),
        getTeamStatistics(leagueId, season, homeTeamId),
        getTeamStatistics(leagueId, season, awayTeamId),
        getH2H(homeTeamId, awayTeamId),
        getOdds(fixtureId),
    ]);

    const local = getLocalParts(fixture.fixture.date, timezone);

    return {
        fixture: {
            id: fixtureId,
            dateUtc: fixture.fixture.date,
            localDate: local.date,
            localTime: local.time,
            status: fixture.fixture.status,
        },
        league: {
            id: leagueId,
            name: fixture.league.name,
            country: fixture.league.country,
            season,
            round: fixture.league.round,
        },
        homeTeam: {
            id: homeTeamId,
            name: fixture.teams.home.name,
            standing: homeStanding,
            statistics: summarizeStats(homeStatsRaw),
        },
        awayTeam: {
            id: awayTeamId,
            name: fixture.teams.away.name,
            standing: awayStanding,
            statistics: summarizeStats(awayStatsRaw),
        },
        prediction: prediction ? {
            winner: prediction.predictions?.winner || null,
            winOrDraw: prediction.predictions?.win_or_draw || null,
            underOver: prediction.predictions?.under_over || null,
            goalsHome: prediction.predictions?.goals?.home || null,
            goalsAway: prediction.predictions?.goals?.away || null,
            advice: prediction.predictions?.advice || null,
            percent: prediction.predictions?.percent || null,
        } : null,
        h2hLast5: summarizeH2H(h2h),
        marketOdds: extractMarketOdds(odds),
    };
}

async function main() {
    const args = parseArgs();
    const outputPath = getDefaultOutputPath(args);

    console.log(`\nSearching fixtures for ${args.date}, ${args.from}-${args.to}, timezone=${args.timezone}\n`);

    const fixtures = await getFixturesByDate(args.date, args.timezone);

    const filteredFixtures = fixtures
        .filter((fixture) => {
            const status = fixture.fixture?.status?.short;
            return CONFIG.ALLOWED_FIXTURE_STATUSES.includes(status);
        })
        .filter((fixture) => inTimeWindow(fixture.fixture.date, args.date, args.from, args.to, args.timezone))
        .slice(0, args.limit);

    if (filteredFixtures.length === 0) {
        const emptyOutput = {
            query: {
                date: args.date,
                from: args.from,
                to: args.to,
                timezone: args.timezone,
                fixturesFound: 0,
                outputFile: outputPath,
            },
            config: CONFIG,
            summary: {
                matchesWithOdds: 0,
                matchesWithPredictions: 0,
                matchesWithStats: 0,
                matchesRejectedForMissingStats: 0,
                matchesRejectedForMissingOdds: 0,
                matchesRejectedAsFriendlies: 0,
                matchesRejectedAsBalanced: 0,
                evaluatedMarketsCount: 0,
                qualifiedMarketsCount: 0,
            },
            allMatches: [],
            filteredOutMatches: [],
            suggestedBets: [],
        };

        writeOutputFile(outputPath, emptyOutput);
        console.log(JSON.stringify(emptyOutput, null, 2));
        console.log("No fixtures found in the selected time window.");
        return;
    }

    const matches = [];

    for (const fixture of filteredFixtures) {
        console.log(`Fetching data for: ${fixture.teams.home.name} - ${fixture.teams.away.name}`);
        matches.push(await enrichFixture(fixture, args.timezone));
    }

    const analyses = matches.map(analyzeMatch);
    const suggestedBets = analyses
        .map((analysis) => analysis.suggestedCandidate)
        .filter(Boolean)
        .sort((a, b) => {
            if (b.valueScore !== a.valueScore) {
                return b.valueScore - a.valueScore;
            }

            return b.confidence - a.confidence;
        })
        .slice(0, CONFIG.MAX_SUGGESTIONS)
        .map((bet, index) => ({
            rank: index + 1,
            match: bet.match,
            kickoff: bet.kickoff,
            competition: bet.competition,
            market: bet.market,
            pick: bet.pick,
            odds: bet.odds,
            estimatedProbability: bet.estimatedProbability,
            impliedProbability: bet.impliedProbability,
            valueScore: bet.valueScore,
            confidence: bet.confidence,
            reasons: bet.reasons,
            warnings: bet.warnings,
            selectionMode: bet.selectionMode || "qualified",
        }));

    const suggestedMatchSet = new Set(suggestedBets.map((bet) => bet.match));

    const filteredOutMatches = analyses
        .filter((analysis) => analysis.filteredOutMatch || !suggestedMatchSet.has(analysis.allMatch.match))
        .map((analysis) => {
            if (analysis.filteredOutMatch) {
                return analysis.filteredOutMatch;
            }

            return {
                match: analysis.allMatch.match,
                kickoff: analysis.allMatch.kickoff,
                competition: analysis.allMatch.competition,
                reasons: ["another market ranked higher and max suggestions reached"],
                warnings: analysis.allMatch.warnings,
            };
        });

        const summary = {
        matchesWithOdds: analyses.filter((analysis) => hasOddsData({ marketOdds: analysis.allMatch.marketOdds })).length,
        matchesWithPredictions: analyses.filter((analysis) => Boolean(analysis.allMatch.prediction)).length,
        matchesWithStats: analyses.filter((analysis) => Boolean(
            analysis.allMatch.teams.home.statistics &&
            analysis.allMatch.teams.away.statistics &&
            analysis.allMatch.teams.home.statistics.goalsForAvg !== null &&
            analysis.allMatch.teams.away.statistics.goalsForAvg !== null
        )).length,
        matchesRejectedForMissingStats: analyses.filter((analysis) => analysis.filteredOutMatch?.reasons.includes("missing basic team stats")).length,
        matchesRejectedForMissingOdds: analyses.filter((analysis) => analysis.filteredOutMatch?.reasons.includes("missing odds")).length,
        matchesRejectedAsFriendlies: analyses.filter((analysis) => analysis.filteredOutMatch?.reasons.includes("friendly competition excluded")).length,
        matchesRejectedAsBalanced: analyses.filter((analysis) => analysis.filteredOutMatch?.reasons.includes("balanced prediction profile")).length,
        evaluatedMarketsCount: analyses.reduce((sum, analysis) => sum + analysis.allMatch.evaluatedMarkets.length, 0),
        qualifiedMarketsCount: analyses.reduce((sum, analysis) => sum + analysis.allMatch.evaluatedMarkets.filter((market) => market.qualified).length, 0),
    };

    const output = {
        query: {
            date: args.date,
            from: args.from,
            to: args.to,
            timezone: args.timezone,
            fixturesFound: matches.length,
            outputFile: outputPath,
        },
        config: CONFIG,
        summary,
        allMatches: analyses.map((analysis) => analysis.allMatch),
        filteredOutMatches,
        suggestedBets,
    };

    writeOutputFile(outputPath, output);

    console.log("\n================ JSON OUTPUT ================\n");
    console.log(JSON.stringify(output, null, 2));
    console.log(`\nSaved output to: ${outputPath}`);
}

main().catch((error) => {
    console.error("Fatal error:", error.message);
    process.exit(1);
});

