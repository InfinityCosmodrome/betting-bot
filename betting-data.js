const fs = require("fs");
const path = require("path");
const axios = require("axios");

loadEnvFile();

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
        limit: 12,
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
            continue;
        }
    }

    if (!out.date || !out.from || !out.to) {
        console.error("Usage: node betting-data.js --date 2026-03-29 --from 19:00 --to 20:00 [--timezone Europe/Athens] [--limit 12]");
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
    const from = timeToMinutes(fromTime);
    const to = timeToMinutes(toTime);

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

async function apiGet(url, params = {}) {
    try {
        const res = await http.get(url, { params });
        return res.data;
    } catch (error) {
        return {
            errors: error.response?.data || error.message,
            response: [],
        };
    }
}

async function getFixturesByDate(date, timezone) {
    const data = await apiGet("/fixtures", { date, timezone });
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

function extractBest1X2(oddsResponse) {
    const prices = [];

    for (const item of oddsResponse) {
        for (const bookmaker of item.bookmakers || []) {
            for (const bet of bookmaker.bets || []) {
                const name = (bet.name || "").toLowerCase();

                if (name.includes("match winner") || name === "winner") {
                    for (const value of bet.values || []) {
                        prices.push({
                            bookmaker: bookmaker.name,
                            label: value.value,
                            odd: Number(value.odd),
                        });
                    }
                }
            }
        }
    }

    const best = (label) => prices
        .filter((x) => x.label === label)
        .sort((a, b) => b.odd - a.odd)[0] || null;

    return {
        home: best("Home"),
        draw: best("Draw"),
        away: best("Away"),
    };
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
        loses: safeGet(stats, "fixtures.loses.total"),
        goalsForAvg: safeGet(stats, "goals.for.average.total"),
        goalsAgainstAvg: safeGet(stats, "goals.against.average.total"),
        cleanSheets: safeGet(stats, "clean_sheet.total"),
        failedToScore: safeGet(stats, "failed_to_score.total"),
    };
}

function summarizeH2H(h2h) {
    return h2h.map((match) => ({
        date: safeGet(match, "fixture.date"),
        home: safeGet(match, "teams.home.name"),
        away: safeGet(match, "teams.away.name"),
        score: `${safeGet(match, "goals.home", "?")}-${safeGet(match, "goals.away", "?")}`,
    }));
}

function parsePercent(value) {
    if (!value) {
        return 0;
    }

    return Number(String(value).replace("%", "").trim()) || 0;
}

function getBestWinnerOdd(match, side) {
    if (side === "home") {
        return match.odds1X2?.home?.odd || null;
    }

    if (side === "away") {
        return match.odds1X2?.away?.odd || null;
    }

    if (side === "draw") {
        return match.odds1X2?.draw?.odd || null;
    }

    return null;
}

function getImpliedProbability(odd) {
    if (!odd || odd <= 0) {
        return null;
    }

    return 100 / odd;
}

function isPostponed(match) {
    const status = match.fixture.status?.short || "";
    return ["PST", "CANC", "ABD", "AWD", "WO"].includes(status);
}

function hasStandingsData(match) {
    return Boolean(match.homeTeam.standing || match.awayTeam.standing);
}

function hasStatsData(match) {
    return Boolean(
        match.homeTeam.statistics?.form ||
        match.awayTeam.statistics?.form ||
        match.homeTeam.statistics?.goalsForAvg ||
        match.homeTeam.statistics?.goalsAgainstAvg ||
        match.awayTeam.statistics?.goalsForAvg ||
        match.awayTeam.statistics?.goalsAgainstAvg
    );
}

function hasOddsData(match) {
    return Boolean(match.odds1X2?.home || match.odds1X2?.draw || match.odds1X2?.away);
}

function getDataQuality(match) {
    let score = 0;

    if (match.prediction) {
        score += 2;
    }

    if (hasStandingsData(match)) {
        score += 1;
    }

    if (hasStatsData(match)) {
        score += 1;
    }

    if (match.h2hLast5.length > 0) {
        score += 1;
    }

    if (hasOddsData(match)) {
        score += 1;
    }

    return score;
}

function getMatchWarnings(match) {
    const warnings = [];

    if (isPostponed(match)) {
        warnings.push("postponed fixture");
    }

    if (!match.prediction) {
        warnings.push("missing prediction");
    }

    if (!hasStandingsData(match)) {
        warnings.push("missing standings");
    }

    if (!hasStatsData(match)) {
        warnings.push("missing team statistics");
    }

    if (!hasOddsData(match)) {
        warnings.push("missing odds");
    }

    if (match.h2hLast5.length === 0) {
        warnings.push("missing h2h");
    }

    return warnings;
}

function buildReasons(pickLabel, metrics) {
    const reasons = [];

    if (metrics.winnerPercent >= 60) {
        reasons.push(`prediction ${metrics.winnerPercent}% for ${pickLabel}`);
    }

    if (metrics.rankGap >= 4) {
        reasons.push(`rank gap ${metrics.rankGap}`);
    }

    if (metrics.formGap >= 2) {
        reasons.push("better recent form");
    }

    if (metrics.goalsSignal) {
        reasons.push(metrics.goalsSignal);
    }

    if (metrics.valueEdge >= 6) {
        reasons.push(`value edge ${metrics.valueEdge.toFixed(1)}%`);
    }

    if (metrics.advice) {
        reasons.push(`advice: ${metrics.advice}`);
    }

    return reasons.slice(0, 4);
}

function getMarketPriority(candidate) {
    if (candidate.market === "Goals") {
        return 3;
    }

    if (candidate.market === "Double Chance") {
        return 1;
    }

    return 2;
}

function formatCompetitionLabel(league) {
    const parts = [league.country, league.name].filter(Boolean);
    const base = parts.join(" - ");

    if (league.round) {
        return `${base} (${league.round})`;
    }

    return base || "Unknown competition";
}

function buildPickCandidates(match) {
    if (isPostponed(match) || !match.prediction) {
        return [];
    }

    const candidates = [];
    const percent = match.prediction.percent || {};
    const homePct = parsePercent(percent.home);
    const drawPct = parsePercent(percent.draw);
    const awayPct = parsePercent(percent.away);

    const homeRank = match.homeTeam.standing?.rank || 99;
    const awayRank = match.awayTeam.standing?.rank || 99;
    const rankGap = Math.abs(homeRank - awayRank);

    const homeForm = match.homeTeam.statistics?.form || "";
    const awayForm = match.awayTeam.statistics?.form || "";
    const homeWinsInForm = (homeForm.match(/W/g) || []).length;
    const awayWinsInForm = (awayForm.match(/W/g) || []).length;
    const formGap = Math.abs(homeWinsInForm - awayWinsInForm);

    const homeGoalsFor = Number(match.homeTeam.statistics?.goalsForAvg || 0);
    const awayGoalsFor = Number(match.awayTeam.statistics?.goalsForAvg || 0);
    const homeGoalsAgainst = Number(match.homeTeam.statistics?.goalsAgainstAvg || 0);
    const awayGoalsAgainst = Number(match.awayTeam.statistics?.goalsAgainstAvg || 0);
    const totalGoalsSignal = homeGoalsFor + awayGoalsFor;

    const predictedWinnerName = match.prediction.winner?.name || null;
    const advice = match.prediction.advice || null;
    const dataQuality = getDataQuality(match);
    const conservativeMode = dataQuality < 4;

    if (!conservativeMode && predictedWinnerName === match.homeTeam.name && homePct >= 55) {
        const odd = getBestWinnerOdd(match, "home");
        const implied = getImpliedProbability(odd);
        const valueEdge = implied ? homePct - implied : 0;
        const goalsSignal = (homeGoalsFor >= 1.5 && awayGoalsAgainst >= 1.2) ? `${match.homeTeam.name} attacking edge` : null;
        const score = (homePct * 0.55) + (valueEdge * 1.8) + (formGap * 2) + (dataQuality * 4) + (match.score * 0.8);

        candidates.push({
            pick: "Home Win",
            market: "1X2",
            selection: match.homeTeam.name,
            odd,
            confidence: Math.min(100, Math.round(score)),
            dataQuality,
            match: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
            kickoff: `${match.fixture.localDate} ${match.fixture.localTime}`,
            league: formatCompetitionLabel(match.league),
            reasons: buildReasons(match.homeTeam.name, {
                winnerPercent: homePct,
                rankGap,
                formGap,
                goalsSignal,
                valueEdge,
                advice,
            }),
        });
    }

    if (!conservativeMode && predictedWinnerName === match.awayTeam.name && awayPct >= 55) {
        const odd = getBestWinnerOdd(match, "away");
        const implied = getImpliedProbability(odd);
        const valueEdge = implied ? awayPct - implied : 0;
        const goalsSignal = (awayGoalsFor >= 1.5 && homeGoalsAgainst >= 1.2) ? `${match.awayTeam.name} attacking edge` : null;
        const score = (awayPct * 0.55) + (valueEdge * 1.8) + (formGap * 2) + (dataQuality * 4) + (match.score * 0.8);

        candidates.push({
            pick: "Away Win",
            market: "1X2",
            selection: match.awayTeam.name,
            odd,
            confidence: Math.min(100, Math.round(score)),
            dataQuality,
            match: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
            kickoff: `${match.fixture.localDate} ${match.fixture.localTime}`,
            league: formatCompetitionLabel(match.league),
            reasons: buildReasons(match.awayTeam.name, {
                winnerPercent: awayPct,
                rankGap,
                formGap,
                goalsSignal,
                valueEdge,
                advice,
            }),
        });
    }

    const predictedHomeGoals = Number(match.prediction.goalsHome || 0);
    const predictedAwayGoals = Number(match.prediction.goalsAway || 0);

    if (!conservativeMode && match.prediction.underOver === "Over 2.5" && totalGoalsSignal >= 2.4) {
        const score = 46 + (match.score * 0.7) + ((predictedHomeGoals + predictedAwayGoals) * 6) + (dataQuality * 4);

        candidates.push({
            pick: "Over 2.5 Goals",
            market: "Goals",
            selection: "Over 2.5",
            odd: null,
            confidence: Math.min(100, Math.round(score)),
            dataQuality,
            match: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
            kickoff: `${match.fixture.localDate} ${match.fixture.localTime}`,
            league: formatCompetitionLabel(match.league),
            reasons: [
                `API prediction: ${match.prediction.underOver}`,
                `attacking average ${totalGoalsSignal.toFixed(2)}`,
                `predicted goals ${match.prediction.goalsHome || "?"}-${match.prediction.goalsAway || "?"}`,
            ],
        });
    }

    if (match.prediction.underOver === "-3.5" || match.prediction.underOver === "Under 3.5") {
        const score = 50 + (dataQuality * 4) + (match.score * 0.45) + ((predictedHomeGoals + predictedAwayGoals) * 2);

        candidates.push({
            pick: "Under 3.5 Goals",
            market: "Goals",
            selection: "Under 3.5",
            odd: null,
            confidence: Math.min(100, Math.round(score)),
            dataQuality,
            match: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
            kickoff: `${match.fixture.localDate} ${match.fixture.localTime}`,
            league: formatCompetitionLabel(match.league),
            reasons: [
                `API prediction: ${match.prediction.underOver}`,
                advice || "totals lean to a lower-scoring game",
                ...(conservativeMode ? ["limited supporting data, totals kept conservative"] : []),
            ].slice(0, 3),
        });
    }

    if (match.prediction.underOver === "-2.5" || match.prediction.underOver === "Under 2.5") {
        const score = 52 + (dataQuality * 4) + (match.score * 0.4);

        candidates.push({
            pick: "Under 2.5 Goals",
            market: "Goals",
            selection: "Under 2.5",
            odd: null,
            confidence: Math.min(100, Math.round(score)),
            dataQuality,
            match: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
            kickoff: `${match.fixture.localDate} ${match.fixture.localTime}`,
            league: formatCompetitionLabel(match.league),
            reasons: [
                `API prediction: ${match.prediction.underOver}`,
                advice || "totals lean to a tighter game",
                ...(conservativeMode ? ["limited supporting data, totals kept conservative"] : []),
            ].slice(0, 3),
        });
    }

    if (!conservativeMode && predictedHomeGoals >= 1 && predictedAwayGoals >= 1 && totalGoalsSignal >= 2.6) {
        const score = 44 + (match.score * 0.65) + ((predictedHomeGoals + predictedAwayGoals) * 5) + (dataQuality * 4);

        candidates.push({
            pick: "Both Teams To Score",
            market: "Goals",
            selection: "GG",
            odd: null,
            confidence: Math.min(100, Math.round(score)),
            dataQuality,
            match: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
            kickoff: `${match.fixture.localDate} ${match.fixture.localTime}`,
            league: formatCompetitionLabel(match.league),
            reasons: [
                `predicted goals ${match.prediction.goalsHome || "?"}-${match.prediction.goalsAway || "?"}`,
                `attacking average ${totalGoalsSignal.toFixed(2)}`,
                "both teams project to score",
            ],
        });
    }

    const doubleChanceHome = homePct + drawPct;
    if (predictedWinnerName === match.homeTeam.name && doubleChanceHome >= 78) {
        candidates.push({
            pick: "Double Chance 1X",
            market: "Double Chance",
            selection: "1X",
            odd: null,
            confidence: Math.min(100, Math.round(24 + (doubleChanceHome * 0.58) + (match.score * 0.35) + (dataQuality * 5))),
            dataQuality,
            match: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
            kickoff: `${match.fixture.localDate} ${match.fixture.localTime}`,
            league: formatCompetitionLabel(match.league),
            reasons: [
                `home or draw probability ${doubleChanceHome.toFixed(0)}%`,
                advice || `support toward ${match.homeTeam.name}`,
                ...(conservativeMode ? ["limited supporting data, kept to safer market"] : []),
            ].slice(0, 3),
        });
    }

    const doubleChanceAway = awayPct + drawPct;
    if (predictedWinnerName === match.awayTeam.name && doubleChanceAway >= 78) {
        candidates.push({
            pick: "Double Chance X2",
            market: "Double Chance",
            selection: "X2",
            odd: null,
            confidence: Math.min(100, Math.round(24 + (doubleChanceAway * 0.58) + (match.score * 0.35) + (dataQuality * 5))),
            dataQuality,
            match: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
            kickoff: `${match.fixture.localDate} ${match.fixture.localTime}`,
            league: formatCompetitionLabel(match.league),
            reasons: [
                `away or draw probability ${doubleChanceAway.toFixed(0)}%`,
                advice || `support toward ${match.awayTeam.name}`,
                ...(conservativeMode ? ["limited supporting data, kept to safer market"] : []),
            ].slice(0, 3),
        });
    }

    return candidates
        .filter((candidate) => {
            if (candidate.market === "Double Chance") {
                return candidate.confidence >= 72;
            }

            return candidate.confidence >= 68;
        })
        .sort((a, b) => {
            const priorityDiff = getMarketPriority(b) - getMarketPriority(a);

            if (priorityDiff !== 0) {
                return priorityDiff;
            }

            return b.confidence - a.confidence;
        });
}

function dedupeTopPicks(candidates, limit) {
    const seenMatches = new Set();
    const picks = [];

    for (const candidate of candidates.sort((a, b) => {
        const priorityDiff = getMarketPriority(b) - getMarketPriority(a);

        if (priorityDiff !== 0) {
            return priorityDiff;
        }

        return b.confidence - a.confidence;
    })) {
        if (seenMatches.has(candidate.match)) {
            continue;
        }

        seenMatches.add(candidate.match);
        picks.push(candidate);

        if (picks.length >= limit) {
            break;
        }
    }

    return picks;
}

function explainSkippedMatches(matches, recommendedPicks) {
    const pickedMatches = new Set(recommendedPicks.map((pick) => pick.match));

    return matches
        .filter((match) => !pickedMatches.has(`${match.homeTeam.name} vs ${match.awayTeam.name}`))
        .map((match) => ({
            match: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
            kickoff: `${match.fixture.localDate} ${match.fixture.localTime}`,
            status: match.fixture.status?.short || null,
            dataQuality: getDataQuality(match),
            reasons: getMatchWarnings(match),
        }))
        .sort((a, b) => a.dataQuality - b.dataQuality);
}

function computeScore(match) {
    let score = 0;

    const pred = match.prediction;
    const homeStanding = match.homeTeam.standing;
    const awayStanding = match.awayTeam.standing;
    const homeStats = match.homeTeam.statistics;
    const awayStats = match.awayTeam.statistics;

    const homeRank = homeStanding?.rank || 99;
    const awayRank = awayStanding?.rank || 99;
    const rankGap = Math.abs(homeRank - awayRank);

    if (rankGap >= 5) {
        score += 8;
    } else if (rankGap >= 3) {
        score += 4;
    }

    const homeForm = homeStats?.form || "";
    const awayForm = awayStats?.form || "";
    const homeWinsInForm = (homeForm.match(/W/g) || []).length;
    const awayWinsInForm = (awayForm.match(/W/g) || []).length;

    score += Math.abs(homeWinsInForm - awayWinsInForm) * 2;

    const homeGoalsFor = Number(homeStats?.goalsForAvg || 0);
    const awayGoalsFor = Number(awayStats?.goalsForAvg || 0);
    const homeGoalsAgainst = Number(homeStats?.goalsAgainstAvg || 0);
    const awayGoalsAgainst = Number(awayStats?.goalsAgainstAvg || 0);

    if ((homeGoalsFor + awayGoalsFor) >= 2.6) {
        score += 3;
    }

    if ((homeGoalsAgainst + awayGoalsAgainst) >= 2.2) {
        score += 2;
    }

    if (pred?.winner?.id) {
        score += 5;
    }

    if (pred?.advice) {
        score += 2;
    }

    const winPct = Math.max(
        parsePercent(pred?.percent?.home),
        parsePercent(pred?.percent?.draw),
        parsePercent(pred?.percent?.away)
    );

    score += Math.floor(winPct / 10);

    return score;
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

    const match = {
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
        odds1X2: extractBest1X2(odds),
    };

    match.score = computeScore(match);

    return match;
}

function compactStanding(standing) {
    if (!standing) {
        return null;
    }

    return {
        rank: standing.rank,
        points: standing.points,
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

function compactMatch(match) {
    return {
        score: match.score,
        dataQuality: getDataQuality(match),
        warnings: getMatchWarnings(match),
        fixture: {
            id: match.fixture.id,
            localDate: match.fixture.localDate,
            localTime: match.fixture.localTime,
            status: match.fixture.status?.short || null,
        },
        league: {
            name: match.league.name,
            country: match.league.country,
            round: match.league.round,
        },
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
        odds1X2: match.odds1X2,
        h2hLast3: match.h2hLast5.slice(0, 3),
    };
}

async function main() {
    const args = parseArgs();
    const outputPath = getDefaultOutputPath(args);

    console.log(`\nSearching fixtures for ${args.date}, ${args.from}-${args.to}, timezone=${args.timezone}\n`);

    const fixtures = await getFixturesByDate(args.date, args.timezone);

    const filtered = fixtures
        .filter((fixture) => {
            const status = fixture.fixture?.status?.short;
            const allowed = ["NS", "TBD", "PST"];
            return allowed.includes(status);
        })
        .filter((fixture) => inTimeWindow(fixture.fixture.date, args.date, args.from, args.to, args.timezone))
        .slice(0, args.limit);

    if (filtered.length === 0) {
        console.log("No fixtures found in the selected time window.");
        return;
    }

    const matches = [];

    for (const fixture of filtered) {
        console.log(`Fetching data for: ${fixture.teams.home.name} - ${fixture.teams.away.name}`);
        matches.push(await enrichFixture(fixture, args.timezone));
    }

    matches.sort((a, b) => b.score - a.score);

    const pickCandidates = matches.flatMap(buildPickCandidates);
    const recommendedTop2Picks = dedupeTopPicks(pickCandidates, 2);

    const output = {
        query: {
            date: args.date,
            from: args.from,
            to: args.to,
            timezone: args.timezone,
            fixturesFound: matches.length,
            pickCandidatesFound: pickCandidates.length,
            outputFile: outputPath,
        },
        suggestions: recommendedTop2Picks.map((pick, index) => ({
            rank: index + 1,
            match: pick.match,
            competition: pick.league,
            kickoff: pick.kickoff,
            market: pick.market,
            pick: pick.selection,
            label: pick.pick,
            confidence: pick.confidence,
            reasons: pick.reasons,
        })),
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
