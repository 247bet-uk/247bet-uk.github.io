/* 247Bet app code (sample odds + home, match list, slip, account). Settings stay in index.html (window.CFG). */
/* ===== Sample odds for the preview (used only until API_URL is set) ===== */
// Sample odds for previewing the design. Used only while CFG.API_URL is not set.
// Prices are generated from simple team ratings and drift slightly every minute so odds movement can be tested.
(function () {
  "use strict";

  var LEAGUES = [
    { n: "English Premier League", t: [["Arsenal", 88], ["Chelsea", 80], ["Liverpool", 87], ["Newcastle", 78], ["Manchester City", 90], ["Tottenham", 79], ["Aston Villa", 78], ["Brighton", 74]] },
    { n: "La Liga", t: [["Real Madrid", 90], ["Barcelona", 89], ["Atletico Madrid", 83], ["Sevilla", 74], ["Valencia", 72], ["Villarreal", 73]] },
    { n: "Serie A", t: [["Inter", 85], ["Napoli", 82], ["AC Milan", 81], ["Juventus", 82], ["Roma", 77], ["Lazio", 76]] },
    { n: "Bundesliga", t: [["Bayern Munich", 90], ["Borussia Dortmund", 82], ["Bayer Leverkusen", 84], ["RB Leipzig", 80]] }
  ];

  // [league, home, away, hours from now]
  var PLAN = [
    [0, 0, 1, 3.2],
    [0, 2, 3, 5.4],
    [0, 4, 5, 23.6],
    [0, 6, 7, 28.5],
    [0, 2, 0, 52],
    [1, 0, 3, 4.6],
    [1, 1, 2, 25.4],
    [1, 4, 5, 29.4],
    [2, 0, 1, 6.2],
    [2, 2, 3, 26.2],
    [2, 4, 5, 51.5],
    [3, 0, 1, 7.4],
    [3, 2, 3, 30.5],
    [3, 1, 3, 76]
  ];

  var BASE = Math.ceil(Date.now() / 1800000) * 1800000;

  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0);
  }
  function r2(x) { return Math.round(x * 100) / 100; }

  function make() {
    var bucket = Math.floor(Date.now() / 60000);
    var out = [];
    PLAN.forEach(function (p, idx) {
      var lg = LEAGUES[p[0]], H = lg.t[p[1]], A = lg.t[p[2]];
      var id = "demo-" + idx;
      var jit = function (k) { return 1 + ((hash(id + k + bucket) % 61) - 30) / 1000; };
      var price = function (prob, k) { return Math.max(1.05, r2((1 / (prob * 1.06)) * jit(k))); };

      var diff = H[1] - A[1] + 4;
      var pHraw = 1 / (1 + Math.exp(-diff / 9));
      var pD = Math.min(0.29, Math.max(0.16, 0.28 - Math.abs(diff) * 0.0035));
      var pH = pHraw * (1 - pD), pA = (1 - pHraw) * (1 - pD);
      var pO = Math.min(0.62, Math.max(0.42, 0.5 + ((H[1] + A[1]) / 2 - 72) * 0.004));
      var pY = Math.min(0.6, Math.max(0.42, 0.5 + ((H[1] + A[1]) / 2 - 72) * 0.003));
      var dnbH = pH / (pH + pA), dnbA = pA / (pH + pA);

      out.push({
        id: id,
        no: 10000 + (hash(id) % 89999),
        league: lg.n,
        home: H[0],
        away: A[0],
        commence_time: new Date(BASE + p[3] * 3600000).toISOString(),
        h2h: { home: price(pH, "h"), draw: price(pD, "d"), away: price(pA, "a") },
        totals: { over25: price(pO, "o"), under25: price(1 - pO, "u") },
        dc: { x1: price(pH + pD, "x1"), x12: price(pH + pA, "x12"), x2: price(pD + pA, "x2") },
        dnb: { home: price(dnbH, "dh"), away: price(dnbA, "da") }
      });
    });
    return out;
  }

  window.DEMO_DATA = { make: make };
})();
;
/* ===== App ===== */
/* 247Bet front end: home and match list.
   Reads matches from the Apps Script API (or sample data), builds the bet slip.
   Bets, accounts, wallet, jackpots and deposits are all wired to the API (test money until launch). */
(function () {
  "use strict";

  var C = window.CFG;
  var DEMO = !C.API_URL || C.API_URL.indexOf("YOUR_API_ID") > -1;
  var CACHE_KEY = "q247.matches.v1";

  /* ---------- helpers ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function odds2(n) { return Number(n).toFixed(2); }
  function money(n) { return "KES " + Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function low(s) { return String(s || "").toLowerCase(); }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }

  var tf = new Intl.DateTimeFormat("en-GB", { timeZone: C.TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  var df = new Intl.DateTimeFormat("en-CA", { timeZone: C.TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  var lf = new Intl.DateTimeFormat("en-GB", { timeZone: C.TZ, weekday: "short", day: "numeric", month: "short" });
  function dayKey(ms) { return df.format(ms); }
  function dayName(ms) {
    var k = dayKey(ms);
    if (k === dayKey(Date.now())) return "Today";
    if (k === dayKey(Date.now() + 864e5)) return "Tomorrow";
    return lf.format(ms);
  }

  /* ---------- state ---------- */
  var S = {
    matches: [], day: "all", league: "all", q: "", shown: C.PAGE,
    collapsed: {}, slip: new Map(), stake: "", sheetId: null, sheetTab: "all",
    loading: true, failed: false, savedAt: null
  };
  S.keep = store("q247.keep") === true;      // Keep Betslip toggle (remembered on this phone)

  /* ---------- turning API data into one shape ----------
     Every market becomes {key, group, title, outs:[{l, p, dir}]}. A market with any missing price is dropped. */
  function num(v) { v = Number(v); return isFinite(v) && v > 1 ? v : null; }
  function market(key, group, title, outs) {
    for (var i = 0; i < outs.length; i++) { outs[i].p = num(outs[i].p); if (!outs[i].p) return null; }
    return { key: key, group: group, title: title, outs: outs };
  }
  function push(list, m) { if (m) list.push(m); }

  function fromFlat(r) { // {h2h:{home,draw,away}, totals:{over25,under25}, dc:{x1,x12,x2}, dnb:{home,away}}
    var m = [], h = r.h2h || {}, t = r.totals || {}, d = r.dc || {}, n = r.dnb || {}, g = r.gm || {}, g15 = g.ou15 || {}, g35 = g.ou35 || {}, gb = g.btts || {}, ge = g.oe || {}, g45 = g.ou45 || {}, ghs = g.hts || {}, gas = g.ats || {}, gho = g.ho15 || {}, gao = g.ao15 || {}, ggr = g.gr || {}, ght = g.htft || {}, grb = g.rbt || {}, gru = g.rou || {}, ghh = g.hch || {}, gha = g.hca || {}, gwh = g.hwn || {}, gwa = g.awn || {};
    push(m, market("1x2", "result", "Match result", [{ l: "1", p: h.home }, { l: "X", p: h.draw }, { l: "2", p: h.away }]));
    push(m, market("dc", "result", "Double chance", [{ l: "1X", p: d.x1 }, { l: "12", p: d.x12 }, { l: "X2", p: d.x2 }]));
    push(m, market("dnb", "result", "Draw no bet", [{ l: "1", p: n.home }, { l: "2", p: n.away }]));
    push(m, market("ou15", "goals", "Total goals 1.5", [{ l: "Over", p: g15.o }, { l: "Under", p: g15.u }]));
    push(m, market("ou25", "goals", "Total goals 2.5", [{ l: "Over", p: t.over25 || (g.ou25 || {}).o }, { l: "Under", p: t.under25 || (g.ou25 || {}).u }]));
    push(m, market("ou35", "goals", "Total goals 3.5", [{ l: "Over", p: g35.o }, { l: "Under", p: g35.u }]));
    push(m, market("btts", "goals", "Both teams to score", [{ l: "Yes", p: gb.y }, { l: "No", p: gb.n }]));
    push(m, market("oe", "goals", "Total goals odd/even", [{ l: "Odd", p: ge.odd }, { l: "Even", p: ge.even }]));
    push(m, market("ou45", "goals", "Total goals 4.5", [{ l: "Over", p: g45.o }, { l: "Under", p: g45.u }]));
    push(m, market("gr", "goals", "Total goals range", [{ l: "0-1", p: ggr.a }, { l: "2-3", p: ggr.b }, { l: "4+", p: ggr.c }]));
    push(m, market("hts", "goals", "Home team to score", [{ l: "Yes", p: ghs.y }, { l: "No", p: ghs.n }]));
    push(m, market("ats", "goals", "Away team to score", [{ l: "Yes", p: gas.y }, { l: "No", p: gas.n }]));
    push(m, market("ho15", "goals", "Home team goals 1.5", [{ l: "Over", p: gho.o }, { l: "Under", p: gho.u }]));
    push(m, market("ao15", "goals", "Away team goals 1.5", [{ l: "Over", p: gao.o }, { l: "Under", p: gao.u }]));
    push(m, market("hch", "result", "Handicap: home -1", [{ l: "1 (-1)", p: ghh["1"] }, { l: "X (-1)", p: ghh.X }, { l: "2 (+1)", p: ghh["2"] }]));
    push(m, market("hca", "result", "Handicap: away -1", [{ l: "1 (+1)", p: gha["1"] }, { l: "X (+1)", p: gha.X }, { l: "2 (-1)", p: gha["2"] }]));
    push(m, market("rbt", "combo", "Result & both teams to score", [{ l: "1 & Yes", p: grb["1Y"] }, { l: "X & Yes", p: grb.XY }, { l: "2 & Yes", p: grb["2Y"] }, { l: "1 & No", p: grb["1N"] }, { l: "X & No", p: grb.XN }, { l: "2 & No", p: grb["2N"] }]));
    push(m, market("rou", "combo", "Result & total goals 2.5", [{ l: "1 & Over", p: gru["1O"] }, { l: "X & Over", p: gru.XO }, { l: "2 & Over", p: gru["2O"] }, { l: "1 & Under", p: gru["1U"] }, { l: "X & Under", p: gru.XU }, { l: "2 & Under", p: gru["2U"] }]));
    push(m, market("hwn", "combo", "Home team to win to nil", [{ l: "Yes", p: gwh.y }, { l: "No", p: gwh.n }]));
    push(m, market("awn", "combo", "Away team to win to nil", [{ l: "Yes", p: gwa.y }, { l: "No", p: gwa.n }]));
    push(m, market("htft", "combo", "Half-time / Full-time", ["1/1", "1/X", "1/2", "X/1", "X/X", "X/2", "2/1", "2/X", "2/2"].map(function (k) { return { l: k, p: ght[k] }; })));
    var gcs = g.cs || {}; if (Object.keys(gcs).length) push(m, market("cs", "goals", "Correct score", Object.keys(gcs).sort().map(function (k) { return { l: k, p: gcs[k] }; })));
    return m;
  }

  function fromArrays(r, home, away) { // {market_1x2:[{name,price}], market_totals:[{name,point,price}], ...}
    var h = low(home), a = low(away), m = [];
    function find(arr, fn) { if (!Array.isArray(arr)) return null; for (var i = 0; i < arr.length; i++) if (fn(arr[i])) return arr[i].price; return null; }
    var w = r.market_1x2;
    push(m, market("1x2", "result", "Match result", [
      { l: "1", p: find(w, function (o) { return low(o.name) === h; }) },
      { l: "X", p: find(w, function (o) { return low(o.name) === "draw"; }) },
      { l: "2", p: find(w, function (o) { return low(o.name) === a; }) }]));
    var dcA = r.market_dc, hasD = function (o) { return low(o.name).indexOf("draw") > -1; };
    push(m, market("dc", "result", "Double chance", [
      { l: "1X", p: find(dcA, function (o) { return hasD(o) && low(o.name).indexOf(h) > -1; }) },
      { l: "12", p: find(dcA, function (o) { return !hasD(o) && low(o.name).indexOf(h) > -1 && low(o.name).indexOf(a) > -1; }) },
      { l: "X2", p: find(dcA, function (o) { return hasD(o) && low(o.name).indexOf(a) > -1; }) }]));
    var nb = r.market_dnb;
    push(m, market("dnb", "result", "Draw no bet", [
      { l: "1", p: find(nb, function (o) { return low(o.name) === h; }) },
      { l: "2", p: find(nb, function (o) { return low(o.name) === a; }) }]));
    var t = Array.isArray(r.market_totals) ? r.market_totals : [], pts = [];
    t.forEach(function (o) { if (o.point != null && pts.indexOf(o.point) < 0) pts.push(o.point); });
    pts.sort(function (x, y) { return Math.abs(x - 2.5) - Math.abs(y - 2.5); }).slice(0, 3).forEach(function (pt) {
      push(m, market("ou" + String(pt).replace(".", ""), "goals", "Total goals " + pt, [
        { l: "Over", p: find(t, function (o) { return low(o.name) === "over" && o.point === pt; }) },
        { l: "Under", p: find(t, function (o) { return low(o.name) === "under" && o.point === pt; }) }]));
    });
    return m;
  }

  function normalise(r) {
    var home = r.home, away = r.away, markets;
    if (r.h2h || r.totals) { markets = fromFlat(r); }
    else {
      var p = String(r.teams || "").split(" vs ");
      home = home || p[0] || "Home"; away = away || p[1] || "Away";
      markets = fromArrays(r, home, away);
    }
    var t = Date.parse(r.commence_time);
    if (!markets.length || isNaN(t)) return null;
    return { id: String(r.id), league: String(r.league || "Football"), home: String(home), away: String(away), t: t, no: Number(r.no) > 0 ? Number(r.no) : 0, markets: markets };
  }
  function normaliseAll(arr) {
    var out = [];
    (arr || []).forEach(function (r) { var m = normalise(r); if (m) out.push(m); });
    return out;
  }

  function byId(id) { for (var i = 0; i < S.matches.length; i++) if (S.matches[i].id === id) return S.matches[i]; return null; }
  function mkt(m, key) { for (var i = 0; i < m.markets.length; i++) if (m.markets[i].key === key) return m.markets[i]; return null; }
  function outc(mk, l) { for (var i = 0; i < mk.outs.length; i++) if (mk.outs[i].l === l) return mk.outs[i]; return null; }

  /* keep a record of which prices moved since the previous fetch */
  function mergeMoves(next) {
    var old = {};
    S.matches.forEach(function (m) { m.markets.forEach(function (k) { k.outs.forEach(function (o) { old[m.id + "|" + k.key + "|" + o.l] = o.p; }); }); });
    next.forEach(function (m) {
      m.markets.forEach(function (k) {
        k.outs.forEach(function (o) {
          var prev = old[m.id + "|" + k.key + "|" + o.l];
          if (prev && o.p > prev) o.dir = "up"; else if (prev && o.p < prev) o.dir = "down";
        });
      });
    });
  }

  /* ---------- loading ---------- */
  function timeoutFetch(url, ms) {
    var ctl = ("AbortController" in window) ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    return fetch(url, ctl ? { signal: ctl.signal } : undefined).then(function (r) { clearTimeout(timer); if (!r.ok) throw new Error("http " + r.status); return r.json(); });
  }

  function load(manual) {
    if (DEMO) {
      var next = normaliseAll(window.DEMO_DATA.make());
      mergeMoves(next);
      S.matches = next; S.loading = false; S.failed = false;
      setNotice("Preview with sample odds. Add your API link in config.js to show live matches.");
      refreshAll();
      return Promise.resolve();
    }
    var pre = window.__mPre; window.__mPre = null;
    var canSkip = !manual && S.h && S.matches.length && !S.failed && !S.loading;   // only a page that already shows odds may be told "unchanged"
    return (pre || timeoutFetch(C.API_URL + "?action=getMatches&h=" + (canSkip ? encodeURIComponent(S.h) : "0"), 15000)).then(function (data) {
      if (data && !Array.isArray(data) && data.same && canSkip) { S.savedAt = Date.now(); return; }   // nothing changed on the server: no download, no rebuild
      if (data && !Array.isArray(data) && data.h) S.h = data.h;
      var arr = Array.isArray(data) ? data : (data && data.matches) || [];
      var sig = JSON.stringify(arr), same = sig === S.sig && !S.failed && !S.loading && !$("#notice").innerHTML;
      S.sig = sig; S.savedAt = Date.now();
      if (same) { return; }                                  // nothing changed: do not rebuild the page
      var next = normaliseAll(arr);
      mergeMoves(next);
      S.matches = next; S.loading = false; S.failed = false;
      store(CACHE_KEY, { at: S.savedAt, data: arr });
      setNotice("");
      refreshAll();
    }).catch(function () {
      S.loading = false;
      if (S.matches.length) {
        var t = S.savedAt ? tf.format(S.savedAt) : "earlier";
        setNotice("You are offline or the server is slow. Showing odds saved at " + t + ".", "Try again");
      } else { S.failed = true; }
      refreshAll();
      if (manual) toast("Could not refresh. Check your connection.");
    });
  }

  function setNotice(text, action) {
    var n = $("#notice");
    if (!text) { n.hidden = true; n.innerHTML = ""; return; }
    n.hidden = false;
    n.innerHTML = esc(text) + (action ? ' <button type="button" id="retryBtn">' + esc(action) + "</button>" : "");
    var b = $("#retryBtn"); if (b) b.onclick = function () { load(true); };
  }

  /* ---------- filtering ---------- */
  var RANK = ["English Premier League", "EPL", "Premier League", "La Liga", "Serie A", "Bundesliga", "Ligue 1", "Champions"];
  function rank(name) { for (var i = 0; i < RANK.length; i++) if (name.indexOf(RANK[i]) > -1) return i; return RANK.length; }

  /* Today / Tomorrow no longer cut the list: every upcoming match stays in it, and the chosen day simply comes first */
  function inDay(m) { return true; }
  function dayGroup(m) {
    if (S.day === "all" || S.q) return 0;
    var k = dayKey(m.t), today = dayKey(Date.now()), tom = dayKey(Date.now() + 864e5);
    if (S.day === "today") return k === today ? 0 : 1;               /* today, then tomorrow and everything after */
    if (S.day === "tomorrow") return k === tom ? 0 : k > tom ? 1 : 2; /* tomorrow, then later days, today's remaining matches last */
    return 0;
  }
  function inQuery(m) { return !S.q || low(m.home + " " + m.away + " " + m.league).indexOf(S.q) > -1; }
  function upcoming() { var now = Date.now(); return S.matches.filter(function (m) { return m.t > now; }); }

  /* ---------- odds buttons ---------- */
  function isOn(mid, mk, l) { var s = S.slip.get(mid); return !!s && s.mk === mk && s.l === l; }
  function oddBtn(m, k, o) {
    var on = isOn(m.id, k.key, o.l);
    return '<button type="button" class="odd' + (on ? " on" : "") + '" data-m="' + esc(m.id) + '" data-mk="' + esc(k.key) + '" data-l="' + esc(o.l) +
      '" aria-pressed="' + on + '"' + (o.dir ? ' data-dir="' + o.dir + '"' : "") +
      ' aria-label="' + esc(k.title + ": " + o.l + " at " + odds2(o.p)) + '"><i>' + esc(o.l) + "</i><b>" + odds2(o.p) + "</b></button>";
  }

  /* ---------- list ---------- */
  /* country shown before the league: the feed only gives a league name, so well-known leagues are mapped here (unknown ones show the league alone) */
  var CTRY = [[/premier league|^epl$|championship|league one|league two|fa cup|carabao|efl/i, "England"], [/scottish|scotland/i, "Scotland"], [/la liga|segunda|copa del rey|laliga/i, "Spain"], [/serie a$|serie b|coppa italia|^serie a/i, "Italy"],
    [/bundesliga|dfb/i, "Germany"], [/ligue 1|ligue 2|coupe de france/i, "France"], [/eredivisie|eerste divisie|keuken|knvb/i, "Netherlands"], [/primeira|liga portugal|taca/i, "Portugal"], [/super lig|s\u00fcper lig/i, "Turkey"], [/pro league|jupiler|belgian/i, "Belgium"],
    [/mls|major league soccer/i, "USA"], [/liga mx/i, "Mexico"], [/a-league/i, "Australia"], [/kenya|kpl/i, "Kenya"], [/saudi/i, "Saudi Arabia"], [/j\.? ?league|j1/i, "Japan"], [/k league/i, "South Korea"], [/russia/i, "Russia"], [/greek|super league 1/i, "Greece"],
    [/swiss/i, "Switzerland"], [/austria/i, "Austria"], [/danish|superliga/i, "Denmark"], [/allsvenskan|swedish/i, "Sweden"], [/eliteserien|norweg/i, "Norway"], [/argentin|liga profesional/i, "Argentina"], [/brasil|brazil/i, "Brazil"],
    [/champions league|europa|conference league|uefa/i, "Europe"], [/libertadores|sudamericana/i, "South America"], [/afcon|africa cup|caf /i, "Africa"], [/world cup|nations league|qualif|friendl|international/i, "International"]];
  function ctryOf(lg) { if (/[\u2022\-:]/.test(lg)) return ""; for (var i = 0; i < CTRY.length; i++) if (CTRY[i][0].test(lg)) return CTRY[i][1]; return ""; }
  /* a pick on a match: "" none, "v" it is one of the visible 1X2 buttons, "h:..." it sits in a market that is hidden behind +N */
  function pickState(m) { var s = S.slip.get(m.id); if (!s) return ""; var main = mkt(m, "1x2"); return main && s.mk === main.key ? "v" : "h:" + s.mk + "|" + s.l; }
  function pickChip(m) {
    var s = S.slip.get(m.id); if (!s || pickState(m) === "v") return "";
    var k = mkt(m, s.mk), o = k && outc(k, s.l), p = o ? o.p : s.base;
    return '<span class="pk" title="Selected market"><i>&#10003;</i>' + esc((s.title ? s.title + " \u00b7 " : "") + s.l) + " <b>" + odds2(p) + "</b></span>";
  }
  /* ---------- match analysis: small panel inside the card, opened by the bar-chart button ---------- */
  var ANA = {};   /* match id -> 1 while loading, 2 once shown */
  var ANA_IC = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 11h4v9H4zm6-7h4v16h-4zm6 10h4v6h-4z"/></svg>';
  function anaBtn(m) {
    var on = !!ANA[m.id];
    return '<button type="button" class="ana' + (on ? " on" : "") + '" data-ana="' + esc(m.id) + '" aria-expanded="' + on + '" aria-label="Analysis for ' + esc(m.home + " v " + m.away) + '">' + ANA_IC + "</button>";
  }
  function anaBody(m) {
    var main = mkt(m, "1x2"), h = main && outc(main, "1"), d = main && outc(main, "X"), a = main && outc(main, "2");
    if (!(h && d && a && h.p > 1 && d.p > 1 && a.p > 1)) return '<p class="ana-n"><b>Analysis is not ready for this match.</b> Keep checking, it opens as soon as the prices are in.</p>';
    var iv = [1 / h.p, 1 / d.p, 1 / a.p], sum = iv[0] + iv[1] + iv[2];
    var pr = iv.map(function (x) { return x / sum * 100; }), r = pr.map(function (x) { return Math.round(x); });
    var top = pr.indexOf(Math.max.apply(null, pr)); r[top] += 100 - (r[0] + r[1] + r[2]);
    var srt = pr.slice().sort(function (x, y) { return y - x; });
    var verdict = srt[0] - srt[1] < 4 ? "Evenly matched" : top === 1 ? "Tight game, a draw is the likeliest result" : (top === 0 ? m.home : m.away) + " favoured";
    var names = [m.home, "Draw", m.away];
    var rows = names.map(function (n, i) {
      return '<div class="ana-r' + (i === top ? " top" : "") + '"><em>' + esc(n) + '</em><u><i style="width:' + r[i] + '%"></i></u><b>' + r[i] + "%</b></div>";
    }).join("");
    var ou = mkt(m, "ou25"), ov = ou && outc(ou, "Over"), un = ou && outc(ou, "Under"), lean = "";
    if (ov && un && ov.p > 1 && un.p > 1) {
      var po = (1 / ov.p) / (1 / ov.p + 1 / un.p), pO = Math.round(po * 100);
      lean = '<p class="ana-ou"><b>Goals:</b> ' + (po >= .55 ? "Over 2.5 looks more likely (" + pO + "%)" : po <= .45 ? "Under 2.5 looks more likely (" + (100 - pO) + "%)" : "Over and Under 2.5 are balanced (" + pO + "% / " + (100 - pO) + "%)") + "</p>";
    }
    return '<div class="ana-h"><b>Match analysis</b><span>' + esc(verdict) + "</span></div>" + rows + lean +
      '<p class="ana-f"><b>Form and head-to-head:</b> keep checking. It opens here as soon as match stats are available.</p>' +
      '<p class="ana-n">Chances come from the current 1X2 prices with the bookmaker margin removed. They are a guide, not a promise.</p>';
  }
  function anaPanel(m) {
    var st = ANA[m.id]; if (!st) return "";
    return '<section class="ana-p" aria-live="polite">' + (st === 1 ? '<div class="ana-sk"><i></i><i></i><i></i></div><p class="ana-lt">Loading analysis...</p>' : anaBody(m)) + "</section>";
  }
  function anaPaint(mid) {
    var m = byId(mid), card = null, all = document.querySelectorAll(".match[data-mid]");
    for (var i = 0; i < all.length; i++) if (all[i].getAttribute("data-mid") === mid) { card = all[i]; break; }
    if (!m || !card) return;
    var old = card.querySelector(".ana-p"); if (old) old.remove();
    var b = card.querySelector(".ana"); if (b) { b.classList.toggle("on", !!ANA[mid]); b.setAttribute("aria-expanded", String(!!ANA[mid])); }
    var h = anaPanel(m); if (h) card.insertAdjacentHTML("beforeend", h);
  }
  function toggleAna(mid) {
    if (ANA[mid]) { delete ANA[mid]; anaPaint(mid); return; }
    ANA[mid] = 1; anaPaint(mid);
    setTimeout(function () { if (ANA[mid] === 1) { ANA[mid] = 2; anaPaint(mid); } }, 900);
  }
  function rowHtml(m) {
    var main = mkt(m, "1x2"), st = pickState(m), hid = st.charAt(0) === "h";
    var extra = 0; m.markets.forEach(function (k) { if (k !== main) extra++; });
    var n = main ? extra : m.markets.length;
    var more = n ? '<button type="button" class="more' + (hid ? " has" : "") + '" data-more="' + esc(m.id) + '" aria-label="All markets for ' + esc(m.home + " v " + m.away) + (hid ? ", a pick is selected" : "") + '">' + (hid ? "&#10003; " : "") + "+" + n + "</button>" : "";
    var c = ctryOf(m.league), dn = dayName(m.t), dt = (dn === "Today" || dn === "Tomorrow" ? dn + " \u00b7 " : "") + lf.format(m.t);
    return '<article class="match' + (st ? " has-pick" : "") + '" data-mid="' + esc(m.id) + '" data-st="' + esc(st) + '"><header class="mh"><span class="mh-lg">' + (c ? "<em>" + esc(c) + "</em><s>\u2022</s>" : "") + "<span>" + esc(m.league) + "</span></span></header>" +
      '<div class="mm"><span class="mm-t">' + (m.t - Date.now() < 36e5 ? '<em class="soon-b">Starting soon</em>' : "") + "<b>" + tf.format(m.t) + "</b><span>" + esc(dt) + "</span></span>" + (m.no ? '<span class="mm-id" title="Match ID">ID ' + m.no + "</span>" : "") + "</div>" +
      '<div class="mb"><div class="teams"><span>' + miniLogo(m.home) + esc(m.home) + "</span><span>" + miniLogo(m.away) + esc(m.away) + "</span>" + pickChip(m) + "</div>" +
      '<div class="mk">' + (main ? '<span class="mk-n">' + esc(main.title || "1X2") + '</span><div class="odds">' + main.outs.map(function (o) { return oddBtn(m, main, o); }).join("") + "</div>" : '<p class="nomain">Open the markets for this match</p>') + "</div>" +
      '<div class="act">' + anaBtn(m) + more + "</div></div>" + anaPanel(m) + "</article>";
  }
  /* a pick made inside the markets sheet changes the match card behind it: refresh just that card when its state changes */
  function syncCard(mid) {
    var m = byId(mid); if (!m) return; var a = null, all = document.querySelectorAll(".match[data-mid]");
    for (var i = 0; i < all.length; i++) if (all[i].getAttribute("data-mid") === mid) { a = all[i]; break; }
    if (!a) return; var st = pickState(m);
    if ((a.getAttribute("data-st") || "") === st) { var ck = a.querySelector(".pk"); if (!st || st === "v" || ck) { if (st.charAt(0) === "h" && ck) { var rf = document.createElement("div"); rf.innerHTML = pickChip(m); ck.replaceWith(rf.firstChild); } return; } }
    var t = document.createElement("div"); t.innerHTML = rowHtml(m); a.replaceWith(t.firstChild);
  }

  function renderList() {
    var list = $("#list"), vis = upcoming().filter(function (m) { return inDay(m) && inQuery(m) && (S.league === "all" || m.league === S.league); });
    $("#showMore").hidden = true;

    if (S.loading && !S.matches.length) {
      list.innerHTML = '<div class="sk"><i></i><i></i><i></i></div><div class="sk"><i></i><i></i><i></i></div><div class="sk"><i></i><i></i><i></i></div>';
      return;
    }
    if (S.failed && !S.matches.length) {
      list.innerHTML = '<div class="empty"><h3>Matches did not load</h3><p>Check your connection and try again.</p><button type="button" class="btn lime" id="retryList">Try again</button></div>';
      $("#retryList").onclick = function () { S.loading = true; S.failed = false; renderList(); load(true); };
      return;
    }
    if (!vis.length) {
      var filtered = S.q || S.league !== "all";
      list.innerHTML = '<div class="empty"><h3>' + (filtered ? "No matches found" : "No upcoming matches") + "</h3><p>" +
        (filtered ? "Try another league, or clear your search." : "New fixtures appear here as soon as they are loaded.") + "</p>" +
        (filtered ? '<button type="button" class="btn ghost" id="resetF">Show all matches</button>' : "") + "</div>";
      var r = $("#resetF"); if (r) r.onclick = function () { S.day = "all"; S.league = "all"; S.q = ""; $("#q").value = ""; S.shown = C.PAGE; refreshAll(); };
      return;
    }

    vis.sort(function (x, y) { return dayGroup(x) - dayGroup(y) || x.t - y.t || rank(x.league) - rank(y.league); });
    var take = vis.slice(0, S.shown), html = S.q ? '<p class="qn">' + vis.length + " match" + (vis.length === 1 ? "" : "es") + " found for &ldquo;" + esc($("#q").value.trim()) + "&rdquo;</p>" : "", lastDay = "";
    take.forEach(function (m) {
      var dk = dayKey(m.t);
      if (dk !== lastDay) { lastDay = dk; html += '<h3 class="dh">' + esc(dayName(m.t)) + "</h3>"; }
      html += rowHtml(m);
    });
    list.innerHTML = html;
    $("#showMore").hidden = !(vis.length > S.shown);
  }

  /* ---------- day, league, rail ---------- */
  var lgData = { names: [], counts: {}, total: 0 };
  function lgRender() {
    var q = ($("#lgQ").value || "").trim().toLowerCase(), box = $("#lgList");
    var list = lgData.names.filter(function (n) { return !q || n.toLowerCase().indexOf(q) > -1; });
    box.innerHTML = (!q ? '<button type="button" data-league="all" aria-pressed="' + (S.league === "all") + '">All leagues<span class="count">' + lgData.total + "</span></button>" : "") +
      (list.length ? list.map(function (n) { return '<button type="button" data-league="' + esc(n) + '" aria-pressed="' + (S.league === n) + '">' + esc(n) + '<span class="count">' + lgData.counts[n] + "</span></button>"; }).join("") : '<p class="m">No league found.</p>');
  }
  function renderFilters() {
    var days = [["all", "All"], ["today", "Today"], ["tomorrow", "Tomorrow"]];
    var qx = $("#qx"); if (qx) qx.hidden = !S.q;
    $("#days").innerHTML = days.map(function (d) { return '<button type="button" data-day="' + d[0] + '" aria-pressed="' + (S.day === d[0]) + '">' + d[1] + "</button>"; }).join("");

    var base = upcoming().filter(function (m) { return inDay(m) && inQuery(m); }), counts = {}, names = [];
    base.forEach(function (m) { if (!counts[m.league]) { counts[m.league] = 0; names.push(m.league); } counts[m.league]++; });
    names.sort(function (a, b) { return rank(a) - rank(b) || (a < b ? -1 : 1); });
    if (S.league !== "all" && !counts[S.league]) S.league = "all";

    lgData = { names: names, counts: counts, total: base.length }; var chipNames = names.slice(0, 6); if (S.league !== "all" && chipNames.indexOf(S.league) < 0) chipNames.push(S.league);
    $("#chips").innerHTML = ['<button type="button" data-league="all" aria-pressed="' + (S.league === "all") + '">All leagues</button>']
      .concat(chipNames.map(function (n) { return '<button type="button" data-league="' + esc(n) + '" aria-pressed="' + (S.league === n) + '">' + esc(n) + ' <span class="count">' + counts[n] + "</span></button>"; }))
      .concat(names.length > chipNames.length ? ['<button type="button" data-lgmore="1" class="lg-more">All ' + names.length + " leagues &#9662;</button>"] : []).join("");
    $("#rail").innerHTML = ['<button type="button" data-league="all" aria-pressed="' + (S.league === "all") + '">All leagues<span class="count">' + base.length + "</span></button>"]
      .concat(names.map(function (n) { return '<button type="button" data-league="' + esc(n) + '" aria-pressed="' + (S.league === n) + '">' + esc(n) + '<span class="count">' + counts[n] + "</span></button>"; })).join("");
  }

  /* ---------- next kick-off ---------- */
  var kickId = null;
  function fmtCountdown(ms) {
    if (ms < 0) ms = 0;
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    function p(n) { return n < 10 ? "0" + n : "" + n; }
    return d > 0 ? d + "d " + p(h) + "h " + p(m) + "m" : p(h) + ":" + p(m) + ":" + p(x);
  }
  function renderKick() {
    try { renderHeroHot(); } catch (e) {}
    var box = $("#kick"), next = null; if (!box) { kickId = null; return; }
    upcoming().forEach(function (m) { if (mkt(m, "1x2") && (!next || m.t < next.t)) next = m; });
    if (!next) { box.hidden = true; kickId = null; return; }
    kickId = next.id;
    var main = mkt(next, "1x2"), extra = next.markets.length - 1;
    box.hidden = false;
    box.innerHTML = '<div class="kick-top"><span class="kick-tag">Next kick-off</span><span>' + esc(next.league) + "</span></div>" +
      '<h2 class="kick-teams"><span>' + esc(next.home) + "</span><i>v</i><span>" + esc(next.away) + "</span></h2>" +
      '<div class="kick-meta"><span class="cd" id="cd">' + fmtCountdown(next.t - Date.now()) + '</span><span class="kick-when">' + esc(dayName(next.t)) + " at " + tf.format(next.t) + "</span></div>" +
      '<div class="odds">' + main.outs.map(function (o) { return oddBtn(next, main, o); }).join("") + "</div>" +
      (extra > 0 ? '<button type="button" class="kick-more" data-more="' + esc(next.id) + '">All markets (+' + extra + ")</button>" : "");
  }
  setInterval(function () {
    if (document.hidden) return;
    var cd = $("#cd"), m = kickId && byId(kickId);
    if (!cd || !m) return;
    var left = m.t - Date.now();
    if (left <= 0) { refreshAll(); return; }
    cd.textContent = fmtCountdown(left);
  }, 1000);

  setInterval(function () { var now = Date.now(); if (S.matches.some(function (m) { var d = m.t - now; return d > 0 && d < 36e5 + 6e4 && d > 36e5 - 6e4; })) renderList(); }, 30000);
  var upN = -1;
  setInterval(function () { var n = upcoming().length; if (upN >= 0 && n < upN) refreshAll(); upN = n; }, 5000);

  /* ---------- bet slip ---------- */
  function slipItems() {
    var out = [];
    S.slip.forEach(function (s, mid) {
      var m = byId(mid), k = m && mkt(m, s.mk), o = k && outc(k, s.l), live = !!(m && o && m.t > Date.now());
      out.push({ mid: mid, t: (m && m.t) || s.t || 0, home: s.home, away: s.away, title: s.title, mk: s.mk, l: s.l, base: s.base, now: live ? o.p : null, live: live });
    });
    return out;
  }
  /* ---------- betslip wording ---------- */
  function noFunds() { toast("Not enough balance. Deposit to continue."); openAuth("wallet"); }
  function pickName(mk, l, home, away) {
    if (mk === "1x2" || mk === "dnb") return l === "1" ? home : l === "2" ? away : "Draw";
    if (mk === "dc") return l === "1X" ? home + " or Draw" : l === "X2" ? "Draw or " + away : home + " or " + away;
    if (mk === "rbt" || mk === "rou" || mk === "hch" || mk === "hca") return String(l).replace(/^([1X2])(?= )/, function (x) { return x === "1" ? home : x === "2" ? away : "Draw"; });
    return l;
  }
  function pickLine(i) {
    var type = i.mk === "1x2" ? "1X2" : i.title;
    return type + " \u2022 " + pickName(i.mk, i.l, i.home, i.away);
  }
  var sfp = new Intl.DateTimeFormat("en-GB", { timeZone: C.TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  function startFmt(ms) {
    var o = {}; sfp.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return o.day + "/" + o.month + ", " + o.hour + ":" + o.minute;
  }
  function toggle(mid, mk, l) {
    var m = byId(mid); if (!m) return;
    var k = mkt(m, mk), o = k && outc(k, l); if (!o) return;
    var cur = S.slip.get(mid);
    if (cur && cur.mk === mk && cur.l === l) S.slip.delete(mid);
    else S.slip.set(mid, { mk: mk, l: l, base: o.p, home: m.home, away: m.away, title: k.title, t: m.t });
    syncOdds(mid); renderSlip(); if (S.sheetId) renderSheet();   // only the tapped match's buttons change: no full list re-render
  }
  function syncOdds(mid) {
    var cur = S.slip.get(mid);
    Array.prototype.forEach.call(document.querySelectorAll('.odd[data-m]'), function (b) {
      if (b.getAttribute("data-m") !== mid) return;
      var on = !!cur && cur.mk === b.getAttribute("data-mk") && cur.l === b.getAttribute("data-l");
      if (b.classList.contains("on") !== on) { b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); }
    });
    syncCard(mid);
  }

  function parseStake() {
    var v = parseFloat(String(S.stake).replace(/,/g, ""));
    return isFinite(v) ? v : 0;
  }
  /* ---------- multibet boost (percentage of the winnings; the server recalculates it when the bet is placed) ---------- */
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }
  function boostTier(q) { var L = BOOSTCFG.ladder, t = null; for (var i = 0; i < L.length; i++) if (q >= L[i][0]) t = L[i]; return t; }
  function boostNext(q) { var L = BOOSTCFG.ladder; for (var i = 0; i < L.length; i++) if (L[i][0] > q) return L[i]; return null; }
  function boostCalc(live, stake, total) {
    if (!BOOSTCFG) return null;
    var q = live.filter(function (i) { return i.now >= BOOSTCFG.minOdds; }).length;
    var t = boostTier(q), pct = t ? t[1] : 0;
    var win = stake > 0 ? Math.max(0, Math.round(stake * total * 100) / 100 - stake) : 0;
    var amt = pct && win > 0 ? Math.min(Math.round(win * pct) / 100, BOOSTCFG.maxBoost) : 0;
    return { q: q, pct: pct, amt: amt, next: boostNext(q), low: live.length - q };
  }
  function boostBar(b, n) {
    var box = $("#slipBoost");
    if (!b || !n) { box.hidden = true; box.innerHTML = ""; return; }
    var L = BOOSTCFG.ladder, first = L[0], min = BOOSTCFG.minOdds.toFixed(2).replace(/0$/, ""), l1, l2, goal;
    if (!b.pct) {
      l1 = "<b>Multibet boost:</b> up to " + L[L.length - 1][1] + "% extra on your winnings";
      l2 = "Add " + plural(first[0] - b.q, "more pick") + " at " + min + "+ odds to unlock a " + first[1] + "% boost!";
      goal = first[0];
    } else {
      l1 = "Your multibet of " + plural(b.q, "pick") + " gives you a <b>" + b.pct + "% boost</b>" + (b.amt ? " (KES " + k0(b.amt) + ")" : "");
      l2 = b.next ? "Add " + plural(b.next[0] - b.q, "more pick") + " at " + min + "+ odds to get " + b.next[1] + "%!" : "You are on the maximum boost. Good luck!";
      goal = b.next ? b.next[0] : b.q;
    }
    box.hidden = false;
    box.innerHTML = '<div class="bst-1">' + l1 + '</div><div class="bst-2">' + l2 + "</div>" +
      (b.low > 0 ? '<div class="bst-3">' + plural(b.low, "pick") + " below " + min + " odds " + (b.low === 1 ? "does" : "do") + " not count.</div>" : "") +
      '<span class="bst-bar" aria-hidden="true"><u style="width:' + Math.min(100, Math.round(b.q / Math.max(1, goal) * 100)) + '%"></u></span>';
  }

  /* ---------- keep betslip: picks survive a reload while the toggle is on ---------- */
  var slipRestored = false;
  function restoreSlip() {
    if (slipRestored || !S.matches.length) return;
    slipRestored = true;
    if (!S.keep) return;
    var a = store("q247.slip"); if (!Array.isArray(a)) return;
    a.forEach(function (p) {
      var mid = p && p[0], e = p && p[1]; if (!mid || !e || S.slip.has(mid)) return;
      var m = byId(mid), k = m && mkt(m, e.mk), o = k && outc(k, e.l);
      if (m && o && m.t > Date.now()) S.slip.set(mid, { mk: e.mk, l: e.l, base: Number(e.base) || o.p, home: m.home, away: m.away, title: k.title, t: m.t });
    });
  }
  function persistSlip() {
    if (!slipRestored) return;
    if (!S.keep) { store("q247.slip", null); return; }
    var a = []; S.slip.forEach(function (v, k) { a.push([k, v]); }); store("q247.slip", a);
  }

  /* ---- bonus balance: which bonus part can carry the slip (the server re-checks all of this when the bet is placed) ---- */
  function ruleOf(task) { var wl = PROMO.welcome; if (task === "slip5f") return { matches: wl.slip.matches, odds: wl.slip.odds, stake: (PROMO.free && PROMO.free.slip && PROMO.free.slip.stake) || 50 }; return wl.slip; }
  function bonusName(x) { return x.type === "free" ? "Free registration bonus" : x.type === "weekend" ? "Saturday bonus" : x.type === "referral" ? "Referral bonus" : "Welcome" + (x.half ? " Part " + x.half : " bonus"); }
  function bonusPlan(live, n, stake) {
    var parts = (S.bonusParts || []).filter(function (x) { return x.left > 0 && x.expires > Date.now(); }), out = { pick: null, why: "", lines: [] }, fitRule = null, crumb = null;
    if (!parts.length || !n) return out;
    parts.forEach(function (x) {
      var q = ruleOf(x.task), okN = live.filter(function (i) { return i.now >= q.odds; }).length, rule = live.length === n && n >= q.matches && okN === n && stake >= q.stake;
      out.lines.push("<b>" + esc(bonusName(x)) + " (" + esc(money(x.left).replace(".00", "")) + " left):</b> " + okN + " of " + q.matches + " selections at odds " + q.odds + "+. Needs " + q.matches + "+ matches, every one at " + q.odds + "+, stake KES " + q.stake + "+.");
      if (!rule || out.pick) return;
      fitRule = fitRule || x;
      if (stake > x.left + 0.001) return;
      var rest = Math.round((x.left - stake) * 100) / 100;
      if (rest > 0.001 && rest < q.stake) { crumb = crumb || { x: x, rest: rest }; return; }
      out.pick = x;
    });
    if (!out.pick) {
      if (crumb) out.why = "That stake would leave only " + money(crumb.rest).replace(".00", "") + " in " + bonusName(crumb.x) + ". Stake all " + money(crumb.x.left).replace(".00", "") + " or leave at least KES " + ruleOf(crumb.x.task).stake + ".";
      else if (fitRule) out.why = bonusName(fitRule) + " has " + money(fitRule.left).replace(".00", "") + " left. Lower your stake to use it.";
    }
    return out;
  }
  function renderSlip() {
    var items = slipItems(), n = items.length, live = items.filter(function (i) { return i.live; });
    var total = live.reduce(function (a, i) { return a * i.now; }, 1);
    if (!live.length) total = 0;
    var tr = Math.round(total * 100) / 100;          // the server rounds total odds to 2 decimals, so we do the same

    $("#slipCount").textContent = n;
    $("#slipClear").hidden = n === 0;
    var shb = $("#slipShare"); if (shb) shb.hidden = n === 0 || live.length === 0;
    $("#slipEmpty").hidden = n > 0;
    $("#slipBody").hidden = n === 0;
    document.body.classList.toggle("slip-none", n === 0); $("#slipBar").classList.toggle("empty", n === 0); $("#barTxt").textContent = n === 0 ? "Bet slip is empty" : "in slip"; $("#barGo").textContent = n === 0 ? "Pick odds" : (document.body.classList.contains("slip-open") ? "Hide slip" : "View slip");
    $("#barCount").textContent = n; $("#barOdds").textContent = odds2(tr || 0);
    var bd = $("#bnavBadge"); bd.hidden = false; bd.textContent = n; bd.classList.toggle("zero", n === 0);
    var kp = $("#keepSlip"); if (kp && kp.checked !== S.keep) kp.checked = S.keep;

    $("#slipList").innerHTML = items.map(function (i) {
      var changed = i.live && Math.abs(i.now - i.base) > 0.004, dir = changed ? (i.now > i.base ? "up" : "down") : "";
      var name = i.home + " Vs. " + i.away;
      return '<div class="sel' + (i.live ? "" : " dead") + '" data-mkt="' + esc(i.mid) + '" role="button" tabindex="0" aria-label="Open markets for ' + esc(name) + '">' +
        '<button type="button" class="x" data-rm="' + esc(i.mid) + '" aria-label="Remove ' + esc(name) + '">&times;</button>' +
        '<span class="sel-m"><b class="sel-n">' + esc(name) + '</b><span class="sel-k">' + esc(pickLine(i)) + '</span>' + (i.t ? '<span class="sel-s">Starts ' + esc(startFmt(i.t)) + "</span>" : "") + "</span>" +
        '<span class="sel-p">' + (i.live ? (changed ? "<s>" + odds2(i.base) + "</s>" : "") + '<b class="' + dir + '">' + odds2(i.now) + "</b>" : '<span class="gone">Unavailable</span>') + "</span></div>";
    }).join("");

    $("#slipOdds").textContent = odds2(tr || 0);
    var stake = parseStake();
    var base = live.length && stake > 0 ? Math.round(stake * tr * 100) / 100 : 0;
    var b = boostCalc(live, stake, tr), bAmt = b ? b.amt : 0;
    var baseCap = Math.min(base, C.MAX_PAYOUT), ret = Math.min(baseCap + bAmt, C.MAX_PAYOUT), capped = base + bAmt > C.MAX_PAYOUT;
    bAmt = Math.max(0, Math.round((ret - baseCap) * 100) / 100);
    if (b) b.amt = bAmt;
    $("#slipReturn").textContent = money(ret);
    boostBar(live.length ? b : null, n);
    var br = $("#slipBoostRow");
    br.hidden = !(b && bAmt > 0);
    if (!br.hidden) { $("#slipBoostLbl").textContent = "Multibet boost (" + b.pct + "%) included"; $("#slipBoostAmt").textContent = "+ " + money(bAmt); }
    $("#slipNote").textContent = C.SLIP_TEXT || "";

    var msg = "";
    if (n && !live.length) msg = "Remove unavailable selections to continue.";
    else if (n && S.stake && stake < C.MIN_STAKE) msg = "Minimum stake is KES " + C.MIN_STAKE + ".";
    else if (n && stake > C.MAX_STAKE) msg = "Maximum stake is KES " + C.MAX_STAKE.toLocaleString("en-KE") + ".";
    else if (n && capped) msg = "Maximum payout per bet is KES " + C.MAX_PAYOUT.toLocaleString("en-KE") + ". Your return is capped.";
    $("#slipMsg").textContent = msg;
    var tk = $("#slipTask"); if (tk) tk.hidden = true;
    var bx = $("#slipBonus"), plan = bonusPlan(live, n, stake);
    if (bx) {
      var showB = !!(S.user && (S.bonusParts || []).length && n);
      bx.hidden = !showB;
      if (showB) {
        var cb = $("#useBonus"), can = !!plan.pick, info = "", ba = $("#bonusAll");
        if (!can) S.useBonus = false;
        cb.disabled = !can; cb.checked = can && !!S.useBonus;
        bx.classList.toggle("on", cb.checked); bx.classList.toggle("off", !can);
        var nm = can ? bonusName(plan.pick) + " (" + money(plan.pick.left).replace(".00", "") + " left)" : "";
        $("#useBonusTxt").innerHTML = can ? (cb.checked ? "<b>Using bonus:</b> " + esc(nm) : "<b>Use bonus</b> &middot; this slip qualifies for " + esc(nm)) : "<b>Use bonus</b> &middot; not available for this slip";
        if (can && cb.checked) info = "Paid fully from bonus, never mixed with cash. The bonus stake is not returned: if the slip wins you receive <b>" + esc(money(Math.max(0, ret - stake))) + "</b> winnings in cash. If it loses, this bonus stake is used up.";
        else if (can) info = "Switch on Use bonus to stake this slip from your bonus balance.";
        else info = plan.why || plan.lines.join("<br>");
        $("#slipBonusInfo").innerHTML = info;
        var allAmt = plan.pick ? plan.pick.left : 0, q0 = plan.pick ? ruleOf(plan.pick.task) : null;
        ba.hidden = !(can && q0 && allAmt >= q0.stake && Math.abs(allAmt - stake) > 0.001);
        if (!ba.hidden) { ba.setAttribute("data-stake", String(allAmt)); ba.textContent = "Stake all " + money(allAmt).replace(".00", ""); }
      } else S.useBonus = false;
    }
    persistSlip();
    if (n === 0 && document.body.classList.contains("slip-open")) setSlipOpen(false);
  }

  function setSlipOpen(open) {
    document.body.classList.toggle("slip-open", open);
    $("#scrim").hidden = true;
    var bg = $("#barGo"); if (bg) bg.textContent = !S.slip.size ? "Pick odds" : (open ? "Hide slip" : "View slip");
    syncInert();
    if (open) $("#slip").scrollTop = 0;
  }
  var mqDesk = window.matchMedia("(min-width: 1024px)");
  function syncInert() {
    var closed = !mqDesk.matches && !document.body.classList.contains("slip-open");
    if ("inert" in HTMLElement.prototype) $("#slip").inert = closed; else $("#slip").setAttribute("aria-hidden", closed ? "true" : "false");
  }
  if (mqDesk.addEventListener) mqDesk.addEventListener("change", syncInert);

  /* ---------- markets sheet ---------- */
  function openSheet(id) {
    var m = byId(id); if (!m) return;
    S.sheetId = id; S.sheetTab = "all";
    $("#sheetLeague").textContent = m.league;
    $("#sheetTitle").textContent = m.home + " v " + m.away;
    $("#sheetWhen").textContent = dayName(m.t) + " at " + tf.format(m.t) + (m.no ? " \u00b7 #" + m.no : "");
    renderSheet();
    var d = $("#sheet");
    if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else d.setAttribute("open", "");
  }
  /* market order in the All markets window: results first, then goals lines in rising order (1.5, 2.5, 3.5 ...), then both teams to score and odd/even */
  function mkRank(k) {
    var b = { "1x2": 0, dc: 1, dnb: 2, hch: 3, hca: 4, gr: 90, btts: 100, oe: 101, hts: 110, ats: 111, ho15: 120, ao15: 121, rbt: 130, rou: 131, hwn: 132, awn: 133, htft: 134, cs: 140 };
    if (b.hasOwnProperty(k.key)) return b[k.key];
    var pt = /([\d.]+)\s*$/.exec(String(k.title || ""));
    return /^ou/.test(k.key) && pt ? 10 + Number(pt[1]) : 200;
  }
  function renderSheet() {
    var m = S.sheetId && byId(S.sheetId); if (!m) return;
    var hasG = m.markets.some(function (k) { return k.group === "goals"; }), hasC = m.markets.some(function (k) { return k.group === "combo"; });
    var groups = [["all", "All markets"]]; if (hasG) groups.push(["goals", "Goals"]); if (hasC) groups.push(["combo", "Combos"]);
    if (!groups.some(function (g) { return g[0] === S.sheetTab; })) S.sheetTab = "all";
    $("#sheetTabs").hidden = groups.length < 2;
    $("#sheetTabs").innerHTML = groups.map(function (g) { return '<button type="button" data-tab="' + g[0] + '" aria-pressed="' + (S.sheetTab === g[0]) + '">' + g[1] + "</button>"; }).join("");
    var list = m.markets.map(function (k, i) { return { k: k, i: i }; }).filter(function (x) { return S.sheetTab === "all" || x.k.group === S.sheetTab; })
      .sort(function (a, b) { return (mkRank(a.k) - mkRank(b.k)) || (a.i - b.i); }).map(function (x) { return x.k; });
    $("#sheetBody").innerHTML = list.map(function (k) {
      return '<div class="mkt"><h3>' + esc(k.title) + '</h3><div class="odds' + (k.outs.length === 2 ? " two" : "") + '">' + k.outs.map(function (o) { return oddBtn(m, k, o); }).join("") + "</div></div>";
    }).join("");
  }

  /* ---------- misc UI ---------- */
  var toastT;
  function toast(msg) {
    var t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }
  /* ---------- accounts ---------- */
  var authTab = "login", authNote = "", rid = "", fgStep = 0, fgPhone = "";
  var REFLOCK = { code: "", st: "" }, REFGO = false;   // referral link: code held in the Sign up window (st: chk | ok | bad | unv)
  /* limits shown to players: these defaults are replaced by the server's own settings as soon as the promo call answers, so the page cannot drift from the real rules */
  var LIM = { dep: { min: 50, max: 100000, day: 500000 }, wd: { min: 100, max: 500000, high: 1500000, chunk: 250000, fee: 0.05 }, bet: { minStake: 50, maxStake: 150000, legs: 20, maxPayout: 1500000 }, game: { minStake: 10, maxStake: 150000 }, jp: { maxEntries: 10 }, ref: { reward: 100, minDeposit: 200, max: 10 } };
  function limN(n) { return Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }); }
  function limSet(s) {
    if (!s || typeof s !== "object") return;
    Object.keys(LIM).forEach(function (g) { var o = s[g]; if (!o || typeof o !== "object") return; Object.keys(LIM[g]).forEach(function (k) { var v = Number(o[k]); if (isFinite(v) && v >= 0 && o[k] !== null && o[k] !== "") LIM[g][k] = v; }); });
  }
  function limFill(s) {
    var m = { DEPMIN: limN(LIM.dep.min), DEPMAX: limN(LIM.dep.max), DEPDAY: limN(LIM.dep.day), WDMIN: limN(LIM.wd.min), WDMAX: limN(LIM.wd.max), WDHIGH: limN(LIM.wd.high), WDFEE: Math.round(LIM.wd.fee * 100) };
    return String(s).replace(/\{([A-Z]+)\}/g, function (x, k) { return m.hasOwnProperty(k) ? m[k] : x; });
  }
  /* one table of every limit, used in the deposit and withdraw windows, the Terms and the FAQ */
  function limTable() {
    var D = LIM.dep, W = LIM.wd, B = LIM.bet, pc = Math.round(W.fee * 100);
    var rows = [
      ["Deposits", "KES <b>" + limN(D.min) + "</b> to <b>" + limN(D.max) + "</b> each time, up to <b>" + limN(D.day) + "</b> in any 24 hours."],
      ["Withdrawals", "From KES <b>" + limN(W.min) + "</b>, up to <b>" + limN(W.max) + "</b> per request. Requests up to <b>" + limN(W.high) + "</b> are allowed and are paid in parts of up to " + limN(W.chunk) + "."],
      ["Withholding levy", "<b>" + pc + "%</b> is deducted from every withdrawal."],
      ["Bet stake", "KES <b>" + limN(B.minStake) + "</b> to <b>" + limN(B.maxStake) + "</b> per bet."],
      ["Selections", "Up to <b>" + B.legs + "</b> in one bet."],
      ["Maximum payout", "KES <b>" + limN(B.maxPayout) + "</b> on any one bet."],
      ["Who can withdraw", "Withdrawals go to the M-Pesa number on your account, which must be a +254 number. They are not available while you hold bonus balance."],
      ["When you are paid", "Once your withdrawal is processed, the cash arrives in your M-Pesa."]
    ];
    return '<table class="lim-tab"><tbody>' + rows.map(function (r) { return "<tr><th>" + r[0] + "</th><td>" + r[1] + "</td></tr>"; }).join("") + "</tbody></table>";
  }
  function limMore() { return '<details class="lim-more"><summary>All limits and rules</summary>' + limTable() + "</details>"; }
    var lastBtn = null;
  function markBtn(x) { lastBtn = x; setTimeout(function () { if (lastBtn === x) lastBtn = null; }, 900); }
  document.addEventListener("click", function (e) { var x = e.target.closest && e.target.closest("button"); if (x && !x.hasAttribute("data-close") && !x.disabled) markBtn(x); }, true);
  document.addEventListener("submit", function (e) { var x = e.target.querySelector && e.target.querySelector("button[type=submit]"); if (x) markBtn(x); }, true);
  function api(b) {
    var x = lastBtn; lastBtn = null; if (x) x.classList.add("busy");
    var p = api_raw(b), fin = function () { if (x) x.classList.remove("busy"); };
    p.then(fin, fin); return p;
  }
  var API_TTL = { jackpots: 25000, promo: 60000, myBets: 12000, myJackpots: 12000, bonusInfo: 20000, myLedger: 12000, myWithdrawals: 12000, refInfo: 30000, affInfo: 30000, predInfo: 30000, pshareStats: 10000, gameRecent: 15000, myGames: 12000 };
  var API_C = {}, API_F = {};
  function apiKey(b) { return b.action + "|" + (b.token || "") + "|" + (b.page || "") + "|" + (b.id || ""); }
  function apiBust() { API_C = {}; }
  /* Stale-while-revalidate: a screen the player has opened before shows its last answer at once (even from a previous visit), and the
   * fresh answer replaces it a moment later if anything changed. Nothing that moves money is ever answered from memory. */
  var SWR_OK = { jackpots: 1, promo: 1, myBets: 1, myJackpots: 1, bonusInfo: 1, myLedger: 1, myWithdrawals: 1, refInfo: 1, affInfo: 1, myGames: 1, gameRecent: 1 }, SWR_KEY = "q247.swr", SWR_MAX = 6 * 3600 * 1000, SWR_MEM = null, swrT = 0;
  function swrLoad() { if (!SWR_MEM) { try { SWR_MEM = JSON.parse(localStorage.getItem(SWR_KEY) || "{}") || {}; } catch (e) { SWR_MEM = {}; } } return SWR_MEM; }
  function swrGet(k) { return swrLoad()[k] || null; }
  function swrPut(k, r) {
    var m = swrLoad(); m[k] = { at: Date.now(), r: r }; var ks = Object.keys(m);
    if (ks.length > 30) { ks.sort(function (a, b) { return m[a].at - m[b].at; }); for (var i = 0; i < ks.length - 30; i++) delete m[ks[i]]; }
    clearTimeout(swrT); swrT = setTimeout(function () { try { localStorage.setItem(SWR_KEY, JSON.stringify(m)); } catch (e) { try { localStorage.removeItem(SWR_KEY); } catch (e2) {} } }, 800);
  }
  function swrClear() { SWR_MEM = {}; try { localStorage.removeItem(SWR_KEY); } catch (e) {} }
  function swrThen(stale, fresh) {   // answers now with the saved copy, then again with the fresh one only if it differs
    var first = Promise.resolve(stale);
    return {
      then: function (ok, bad) {
        var out = first.then(ok, bad);
        if (ok) fresh.then(function (f) { if (f && (f.ok || f.expired) && JSON.stringify(f) !== JSON.stringify(stale)) { try { ok(f); } catch (e) { console.error(e); } } }, function () {});
        return out;
      },
      catch: function (bad) { return first.catch(bad); },
      "finally": function (fn) { return first.finally(fn); }
    };
  }
  var WARM_AFTER = { placeBet: 1, slipPlace: 1, jpEnter: 1, deposit: 1, withdraw: 1, gameBet: 0 }, warmT = 0;
  function warmSoon() {   // after the player changes something, quietly refresh the two screens that show it
    clearTimeout(warmT); warmT = setTimeout(function () { if (!S.token || document.hidden) return; api_raw({ action: "myBets", token: S.token }).catch(function () {}); setTimeout(function () { api_raw({ action: "myLedger", token: S.token }).catch(function () {}); }, 700); }, 2500);
  }
  function api_raw(body) {
    var ttl = API_TTL[body.action];
    if (!ttl) {
      if (body.action !== "me" && body.action !== "sessPing" && body.action !== "chatList" && body.action !== "depositStatus" && body.action !== "gameState" && body.action !== "gameRound" && body.action !== "inbox") apiBust();   // anything that changes data clears the cache
      var pm = api_net(body); if (body.action === "login" || body.action === "me") pm.then(function (r) { if (r && r.ok) wdArm(r); }, function () {}); if (WARM_AFTER[body.action]) pm.then(function (r) { if (r && r.ok) warmSoon(); }, function () {});
      return pm;
    }
    var k = apiKey(body), c = API_C[k];
    if (c && Date.now() - c.at < ttl) return Promise.resolve(c.r);             // instant: answered from memory
    var st = c || swrGet(k), p = API_F[k];                                    // st = an older answer we can show straight away
    if (!p) {
      p = API_F[k] = api_net(body).then(function (r) { delete API_F[k]; if (r && r.ok) { API_C[k] = { at: Date.now(), r: r }; swrPut(k, r); } return r; }, function (e) { delete API_F[k]; throw e; });   // same call already on its way: shared
    }
    if (SWR_OK[body.action] && st && st.r && st.r.ok && Date.now() - st.at < SWR_MAX) return swrThen(st.r, p);
    return p;
  }
  function prefetch() {   // warm the screens a player is most likely to tap next, so they open without waiting
    if (DEMO) return;
    var go = function () {
      api_raw({ action: "jackpots" }).catch(function () {});
      if (S.token) {
        api_raw({ action: "myBets", token: S.token }).catch(function () {}); api_raw({ action: "bonusInfo", token: S.token }).catch(function () {});
        ["myLedger", "myWithdrawals", "myJackpots", "refInfo"].forEach(function (a, i) { setTimeout(function () { if (S.token && !document.hidden) api_raw({ action: a, token: S.token }).catch(function () {}); }, 1200 + i * 700); });   // staggered: never floods the server
      }
    };
    if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 2500 }); else setTimeout(go, 1200);
  }
  var API_MS = { gameRound: 9000, gameBet: 20000, gameCash: 20000, gameCancel: 20000, me: 20000, chatList: 20000, depositStatus: 20000 };   // everything else: 30 s
  var API_RETRY = { gameBet: 1, gameCash: 1, gameRound: 1 };   // game bets carry a request id, so sending the same bet twice never charges twice
  var NB_QUIET = { me: 1, chatList: 1, depositStatus: 1, gameState: 1, gameRound: 1, inbox: 1, gameRecent: 1, pshareStats: 1, ping: 1 }, nbN = 0;
  function nbar(d) { nbN = Math.max(0, nbN + d); var e = $("#nbar"); if (e) e.classList.toggle("on", nbN > 0); }
  function api_net(body, tries) {
    if (tries === undefined && !NB_QUIET[body.action]) { nbar(1); var q = api_net1(body, tries), f = function () { nbar(-1); }; q.then(f, f); return q; }
    return api_net1(body, tries);
  }
  function api_net1(body, tries) {
    var ctl = ("AbortController" in window) ? new AbortController() : null, ms = API_MS[body.action] || 30000, tm = ctl ? setTimeout(function () { ctl.abort(); }, ms) : 0;
    return fetch(C.API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })
      .then(function (r) { clearTimeout(tm); return r.json(); })
      .then(function (r) { if (r && r.viewOnly) { voSet(true); if (r.ok === false) voShow(); } return r; })
      .catch(function (e) {
        clearTimeout(tm);
        var left = tries === undefined ? (API_RETRY[body.action] || 0) : tries;
        if (left > 0) return new Promise(function (ok) { setTimeout(ok, 350); }).then(function () { return api_net1(body, left - 1); });
        throw e;
      });
  }
  /* ---------- watched (pinned) accounts: signed out on every device the moment the password is reset or a temporary password runs out ----------
   * The server marks a pinned account's login and /me answers with watch:true (and tmpLeft = ms left on an active temporary password).
   * Only those pages send a tiny check every 10 s, so ordinary players cost nothing extra. A real "session ended" answer, or the temporary
   * password's own timer, signs the page out and reloads it so nothing of the account stays on screen. A network failure never signs anyone out. */
  var WD = { on: false, x: 0, dl: 0, busy: false, t: 0 };

  /* ---------- view-only mode: this login was opened with a temporary password ----------
   * The server refuses every action except looking (Code.gs, viewOnly_). This is the friendly side: a clear message instead of a failed button. */
  var VO = { on: false, shown: 0 };
  function voSet(on) { on = !!on; if (VO.on === on) return; VO.on = on; document.body.classList.toggle("vo", on); voLeft(); }
  function voShow() { var d = $("#voDlg"); if (!d || Date.now() - VO.shown < 1500) return; VO.shown = Date.now(); openDlg(d); }
  function voLeft() {
    var el = $("#voLeft"); if (!el) return;
    if (!VO.on || !WD.dl) { el.textContent = ""; return; }
    var m = Math.ceil((WD.dl - Date.now()) / 60000);
    el.textContent = m <= 1 ? "\u00b7 under 1 min left" : "\u00b7 " + m + " min left";
  }
  setInterval(function () { if (VO.on) voLeft(); }, 15000);
  document.addEventListener("keydown", function (e) { if ((e.key === "Enter" || e.key === " ") && e.target && e.target.id === "voStrip") { e.preventDefault(); VO.shown = 0; voShow(); } });
  document.addEventListener("click", function (e) {
    if (!VO.on || !e.target.closest) return;
    if (!e.target.closest('#place, [data-w="dep"], [data-w="wd"], [data-go="dep"], [data-wa="dep"], [data-ex], [data-del], [data-delall], .mbx-b')) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); voShow();
  }, true);
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("#voStrip, #voOut"); if (!t) return;
    if (t.id === "voStrip") { VO.shown = 0; voShow(); return; }
    var tk = S.token; closeDlg($("#voDlg")); try { $$("dialog[open]").forEach(function (d) { closeDlg(d); }); } catch (x) {}
    setSession("", null); voSet(false);
    if (tk) api_raw({ action: "logout", token: tk }).catch(function () {});
    openAuth("login");
  });

  function wdArm(r) {
    clearTimeout(WD.x); WD.dl = 0; voSet(r && r.viewOnly);
    if (!r || !r.watch) { WD.on = false; return; }
    WD.on = true;
    if (r.tmpLeft > 0) { WD.dl = Date.now() + r.tmpLeft; WD.x = setTimeout(function () { wdOut(); }, r.tmpLeft + 300); }
    if (!WD.t) WD.t = setInterval(function () { if (WD.on && S.token && !document.hidden) wdPing(); }, 10000);
    voLeft();
  }
  function wdPing() {
    if (!S.token || WD.busy) return;
    if (WD.dl && Date.now() >= WD.dl) { wdOut(); return; }
    WD.busy = true;
    api_raw({ action: "sessPing", token: S.token }).then(function (r) {
      WD.busy = false; if (!S.token) return;
      if (r && r.expired) { wdOut(); return; }
      if (r && r.ok) wdArm(r);
    }, function () { WD.busy = false; });
  }
  function wdOut() {
    if (!S.token) return;
    WD.on = false; clearTimeout(WD.x);
    try { sessionStorage.setItem("q247.wdmsg", "1"); } catch (e) {}
    try { $$("dialog[open]").forEach(function (d) { try { closeDlg(d); } catch (e) {} }); } catch (e) {}
    setSession("", null);
    setTimeout(function () { try { location.reload(); } catch (e) {} }, 200);
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden && WD.on) wdPing(); });
  window.addEventListener("focus", function () { if (WD.on) wdPing(); });
  window.addEventListener("online", function () { if (WD.on) wdPing(); });
  /* ---------- balance watch: money added while the page is open (a support top-up, a payout) shows up by itself ---------- */
  var BP = { busy: false, at: 0, act: Date.now(), idle: false };
  ["pointerdown", "keydown", "touchstart", "scroll"].forEach(function (ev) { window.addEventListener(ev, function () { BP.act = Date.now(); }, { passive: true, capture: true }); });
  function balPoll() {
    if (!S.token || !S.user || DEMO || document.hidden || BP.busy || Date.now() - BP.at < 8000) return;
    if (Date.now() - BP.act > 300000) { if (BP.idle) return; BP.idle = true; } else BP.idle = false;   /* idle for 5 minutes: one last check, then quiet until the next touch or wake-up */
    BP.busy = true; BP.at = Date.now();
    api_raw({ action: "me", token: S.token }).then(function (r) {
      BP.busy = false; if (!r || !r.ok || !S.token || !S.user) return;
      var o = S.user, n = r.user, moved = Number(n.balance) !== Number(o.balance), more = Number(n.unread) > Number(o.unread || 0);
      if (!moved && !more && Number(n.unread) === Number(o.unread || 0)) return;
      S.user = n; try { if (store("q247.tok")) store("q247.user", S.user); } catch (e) {}
      renderAcct();
      try { var ad = $("#authDlg"), ae = document.activeElement; if (moved && ad && ad.open && !(ae && ad.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))) renderAuth(); } catch (e) {}
      if (more) toast(n.lastMsg === "Deposit received" ? "Deposit received. Your balance is updated." : "New message: " + (n.lastMsg || "check your inbox"));
    }, function () { BP.busy = false; });
  }
  setInterval(balPoll, 45000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { BP.act = Date.now(); BP.idle = false; setTimeout(balPoll, 600); } });
  window.addEventListener("focus", function () { BP.act = Date.now(); BP.idle = false; setTimeout(balPoll, 600); });
  function setSession(token, user, rem) {
    if (!token) { swrClear(); WD.on = false; clearTimeout(WD.x); voSet(false); } else { try { localStorage.setItem("q247.had", "1"); } catch (e) {} }
    S.token = token || ""; S.user = user || null;
    try {
      if (!S.token) { localStorage.removeItem("q247.tok"); sessionStorage.removeItem("q247.tok"); localStorage.removeItem("q247.user"); sessionStorage.removeItem("q247.user"); }
      else if (rem === false) { sessionStorage.setItem("q247.tok", S.token); localStorage.removeItem("q247.tok"); sessionStorage.setItem("q247.user", JSON.stringify(S.user || null)); localStorage.removeItem("q247.user"); }
      else if (rem === true) { store("q247.tok", S.token); sessionStorage.removeItem("q247.tok"); store("q247.user", S.user || null); sessionStorage.removeItem("q247.user"); }
    } catch (e) {}
    renderAcct(); loadTaskFlag(); if (S.token) prefetch();
    if (typeof satBar === "function") { satBar(); if (typeof satCheckUsed === "function") satCheckUsed(); }
    if (typeof shrAfterAuth === "function") shrAfterAuth(true);
  }
  function loadTaskFlag() {
    S.slipTask = false; S.slipTasks = []; S.bonusParts = []; S.useBonus = false;
    if (!S.token || !S.user || DEMO) { if (typeof renderSlip === "function") renderSlip(); return; }
    api({ action: "bonusInfo", token: S.token }).then(function (r) {
      S.bonusParts = (r.ok ? r.active : []).filter(function (x) { return x.task === "slip5" || x.task === "slip5w" || x.task === "slip5f"; }).map(function (x) { return { id: x.id, type: x.type, task: x.task, half: x.half, left: Number(x.left != null ? x.left : x.amount) || 0, amount: x.amount, expires: x.expires }; });
      if (r.ok && S.user) S.user.bonus = Number(r.bonusBalance) || 0;
      S.slipTasks = S.bonusParts; S.slipTask = S.bonusParts.length > 0;
      renderSlip();
    }).catch(function () {});
  }
  function renderAcct() {
    var a = $(".acts"), LP = $("#land"); if (LP) LP.hidden = false;   // the offers slider stays on screen for everyone, signed in or not
    try { if (HS && HS.li !== !!S.user) renderHero(); } catch (e) {}
    a.innerHTML = S.user
      ? '<button type="button" class="btn ghost" data-auth="wallet">' + esc(money(S.user.balance)) + '</button><button type="button" class="btn ghost dacc" data-auth="account" aria-label="My account">' + ic("user") + (S.user.unread ? '<span class="ndot">' + S.user.unread + '</span>' : "") + '</button>'
      : '<button type="button" class="btn ghost" data-auth="login">Log in</button><button type="button" class="btn lime" data-auth="join">Sign up</button>';
    $("#place").textContent = S.user ? "Place bet" : "Log in to place bet";
  }
  
  var acTab = "home";
  /* limit tiles: label, unit, value. Every value sits on its own line so it can never clip */
  function limTiles(a) {
    return '<div class="lim-tiles">' + a.map(function (x) { return "<div><span>" + esc(x[0]) + "</span>" + (x[1] ? "<small>" + esc(x[1]) + "</small>" : "<small>&nbsp;</small>") + "<b>" + esc(x[2]) + "</b></div>"; }).join("") + "</div>";
  }
  var TYPE = { DEPOSIT: "Deposit", BET_STAKE: "Bet placed", BONUS_STAKE: "Bonus bet placed", BET_WIN: "Bet won", SHARE_FEE: "Share bonus (to sharer)", PRED_WIN: "Predictor prize", BET_REFUND: "Bet refunded", JP_ENTRY: "Jackpot entry", JP_WIN: "Jackpot prize", GAME_STAKE: "Save My Girl stake", GAME_WIN: "Save My Girl win", TEST_CREDIT: "Test credit", BONUS: "Bonus", BONUS_RELEASE: "Bonus released", BONUS_EXPIRE: "Bonus expired", BONUS_FORFEIT: "Bonus forfeited", BONUS_CANCEL: "Bonus cancelled", WITHDRAW_HOLD: "Withdrawal", WITHDRAW_REFUND: "Withdrawal refunded", ADJUST: "Adjustment" };
  /* Delete one / all inbox messages or transactions (hidden for this player only; the records stay on file). Buttons carry data-del (action + data-id) or data-delall (action). */
  function wireDel(root, again) {
    $$("[data-del],[data-delall]", root).forEach(function (x) {
      x.onclick = function () {
        var all = x.hasAttribute("data-delall"), act = x.getAttribute(all ? "data-delall" : "data-del");
        if (all && !confirm("Delete all of these from your account? This cannot be undone.")) return;
        var body = { action: act, token: S.token }; if (all) body.all = "1"; else body.ids = [x.getAttribute("data-id")];
        x.disabled = true;
        api(body).then(function (r) {
          if (r.expired) { setSession("", null); closeDlg($("#authDlg")); openAuth("bet"); return; }
          if (!r.ok) { x.disabled = false; toast(r.error || "Could not delete."); return; }
          again();
        }).catch(function () { x.disabled = false; toast("Could not delete. Check your connection."); });
      };
    });
  }
  function acCall(body, ok) {
    api(body).then(function (r) {
      if (r.expired) { setSession("", null); closeDlg($("#authDlg")); openAuth("bet"); return; }
      if (!r.ok) { toast(r.error || "Something went wrong."); return; }
      if (r.balance !== undefined) { S.user.balance = r.balance; renderAcct(); }
      ok(r);
    }).catch(function () { toast("Network problem. Try again."); });
  }
  function renderAccount(b, t) {
    t.textContent = S.user.name;
    if (acTab === "home" || acTab === "reward" || acTab === "set") acPar = "home";
    var sub = acTab !== "home", wal = acTab === "dep" || acTab === "wd"; waAcctBar(acTab !== "dep");
    var TT = { inbox: "Inbox", hist: "Transactions", games: "Instant wins history", bonus: "Bonuses", lim: "Self-exclusion", pw: "Password", dep: "Wallet", wd: "Wallet", reward: "Rewards", set: "Settings" };
    t.textContent = "My account"; $("#authDlg").classList.add("dash");
    b.innerHTML = (sub ? '<div class="dbar"><button type="button" class="dback" id="dBack">&lsaquo; Back</button><b>' + TT[acTab] + "</b></div>" : "") +
      (wal ? '<div class="atabs"><button type="button" data-w="dep" aria-pressed="' + (acTab === "dep") + '">Deposit</button><button type="button" data-w="wd" aria-pressed="' + (acTab === "wd") + '">Withdraw</button></div>' : "") + '<div id="acBody"></div>';
    if (sub) $("#dBack").onclick = function () { acTab = acPar || "home"; acPar = "home"; renderAccount(b, t); };
    $$("[data-w]", b).forEach(function (x) { x.onclick = function () { acTab = x.getAttribute("data-w"); renderAccount(b, t); }; });
    var a = $("#acBody"); if (wal) a.className = "wallet";
    if (wal) { var sx = 0; a.ontouchstart = function (e) { sx = e.touches[0].clientX; }; a.ontouchend = function (e) { var dx = e.changedTouches[0].clientX - sx, nx = dx < 0 ? "wd" : "dep"; if (Math.abs(dx) > 60 && nx !== acTab) { acTab = nx; renderAccount(b, t); } }; }
    if (acTab === "home") { dashHome(a, b, t);
    } else if (acTab === "reward" || acTab === "set") { dashMenu(a, b, t);
    } else if (acTab === "dep") {
      a.innerHTML = '<p class="m">Choose how to deposit</p><button type="button" class="dm dm-go" id="dmMp" aria-label="Deposit with M-Pesa"><span class="dm-i"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M10.5 17.5h3M10 7.5h4"/></svg></span><span class="dm-t"><b>Deposit with M-Pesa</b><small>Instant, via STK push</small></span><span class="dm-arr" aria-hidden="true">&rsaquo;</span></button><p class="lim-line">Min KES ' + limN(LIM.dep.min) + ' &middot; Max KES ' + limN(LIM.dep.max) + ' per transaction</p>' + limMore() + lockedMethods();
      $("#dmMp").onclick = renderDeposit; wireLocked(a); depNudgeCheck();
    } else if (acTab === "inbox") {
      a.innerHTML = '<p class="m" id="ibNote"><span class=skl></span><span class=skl2></span><span class=skl3></span></p><div id="ibList"></div>';
      acCall({ action: "inbox", token: S.token }, function (r) {
        var L = $("#ibList"); if (!L) return;
        $("#ibNote").textContent = r.items.length ? "" : "No messages yet. Deposits, withdrawals and bonuses will show up here.";
        L.innerHTML = (r.items.length ? '<div class="delbar"><button type="button" class="btn ghost" data-delall="inboxDel">Delete all messages</button></div>' : "") + r.items.map(function (m) { var hw = /bonus|welcome/i.test(m.title || "") ? howType((m.title || "") + " " + (m.body || "")) : ""; return '<div class="msg' + (m.fresh ? " new" : "") + '"' + (hw ? ' data-how="' + hw + '"' : "") + '><button type="button" class="delx" data-del="inboxDel" data-id="' + esc(m.id) + '" aria-label="Delete this message">&times;</button><b>' + esc(m.title) + "</b><p>" + esc(m.body) + "</p>" + (hw ? '<button type="button" class="btn ghost how-b" data-how="' + hw + '">How to use this bonus</button>' : "") + (m.title === "Deposit not completed" || m.title === "Complete your deposit" ? depInboxBtn(m.body) : "") + "<time>" + esc(new Date(m.t).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })) + "</time></div>"; }).join("");
        wireDel(L, function () { renderAccount(b, t); });
        if (S.user.unread) { S.user.unread = 0; renderAcct(); var ib = $('[data-ac="inbox"]'); if (ib) ib.innerHTML = "Inbox"; }
      });
    } else if (acTab === "pw") {
      var eyeIn = function (id, lab, ac) { return '<label>' + lab + '<span class="pw"><input id="' + id + '" type="password" maxlength="10" autocomplete="' + ac + '"><button type="button" class="eye" data-eye="' + id + '" aria-label="Show password">' + EYE + '</button></span></label>'; };
      a.innerHTML = '<form id="pwForm" class="af" novalidate><p>Change your password. Other devices will be logged out.</p>' + eyeIn("cpOld", "Current password", "current-password") + eyeIn("cpNew", "New password (6 to 10 characters)", "new-password") + eyeIn("cpNew2", "Re-enter new password", "new-password") +
        '<p id="cpErr" class="aerr" role="alert"></p><button type="submit" class="btn lime wide">Save password</button><button type="button" id="cpBack" class="btn ghost wide">Back</button></form>';
      $$("[data-eye]", a).forEach(function (x) { x.onclick = function () { var i = $("#" + x.getAttribute("data-eye")), show = i.type === "password"; i.type = show ? "text" : "password"; x.innerHTML = show ? EYEOFF : EYE; }; });
      $("#cpBack").onclick = function () { acTab = "home"; renderAccount(b, t); };
      $("#pwForm").onsubmit = function (e) {
        e.preventDefault();
        var er = $("#cpErr"), o = $("#cpOld").value, n1 = $("#cpNew").value, n2 = $("#cpNew2").value;
        er.classList.remove("ok");
        if (!o) { er.textContent = "Enter your current password."; return; }
        if (n1.length < 6 || n1.length > 10) { er.textContent = "New password must be 6 to 10 characters."; return; }
        if (n1 !== n2) { er.textContent = "The two new passwords do not match."; return; }
        er.textContent = "";
        api({ action: "changePw", token: S.token, oldPassword: o, newPassword: n1 }).then(function (r) {
          if (r.expired) { setSession("", null); closeDlg($("#authDlg")); openAuth("bet"); return; }
          if (!r.ok) { er.textContent = r.error || "Could not change password."; return; }
          toast("Password changed."); acTab = "home"; renderAccount(b, t);
        }).catch(function () { er.textContent = "Network problem. Try again."; });
      };
    } else if (acTab === "hist") {
      a.innerHTML = "<p><span class=skl></span><span class=skl2></span><span class=skl3></span></p>";
      acCall({ action: "myLedger", token: S.token }, function (r) {
        a.innerHTML = r.items.length ? '<div class="delbar"><button type="button" class="btn ghost" data-delall="txDel">Delete all transactions</button></div>' + r.items.map(function (x) {
          var up = Number(x.amount) >= 0;
          return '<div class="ac-row"><div>' + esc(TYPE[x.type] || x.type) + "<small>" + esc(new Date(x.ts).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })) + '</small></div><b class="' + (up ? "ac-up" : "ac-dn") + '">' + (up ? "+" : "") + esc(money(x.amount)) + '</b><button type="button" class="delx" data-del="txDel" data-id="' + esc(x.id) + '" aria-label="Delete this transaction">&times;</button></div>';
        }).join("") : "<p>No transactions yet.</p>";
        wireDel(a, function () { renderAccount(b, t); });
      });
    } else if (acTab === "wd") {
      var WMIN = LIM.wd.min, WMAX = LIM.wd.max, WHIGH = LIM.wd.high, WCHUNK = LIM.wd.chunk, FEE = LIM.wd.fee, bal = Number(S.user.balance) || 0;
      a.innerHTML = '<div class="wd-info"><p class="wd-fine">The withholding levy is deducted from every withdrawal. Larger payouts, up to KES ' + limN(WHIGH) + ', are sent in several M-Pesa parts. Once your withdrawal is processed, the cash arrives in your M-Pesa.</p>' + limMore() + '</div>' + (bal < WMIN ? '<p class="wd-low">Your balance is below the KES ' + limN(WMIN) + ' minimum. <button type="button" class="flink" id="wdGoDep">Deposit now</button></p>' : "") + '<p class="modal-note" id="wdLock" hidden></p><form id="wdF" class="ac-f"><label class="wd-lbl">M-Pesa number<div class="wd-num"><input id="wdPh" type="text" value="' + esc(S.user.phone) + '" readonly tabindex="-1" aria-readonly="true"><span aria-hidden="true">&#128274;</span></div></label><p class="lim-bal">Your balance <b id="wdBal">' + esc(money(bal)) + '</b></p><input id="wdAmt" type="number" inputmode="numeric" min="' + WMIN + '" max="' + WHIGH + '" placeholder="Amount (KES)"><p class="lim-line">Min KES ' + limN(WMIN) + ' &middot; Max KES ' + limN(WMAX) + ' per request &middot; Levy ' + Math.round(FEE * 100) + '%</p><p id="wdCalc" class="wd-calc" hidden></p><p id="wdErr" class="aerr" role="alert"></p><button type="submit" class="btn lime wide">Withdraw</button></form><div id="wdDone"></div><div id="wdStat"></div>';
      var gd = $("#wdGoDep"); if (gd) gd.onclick = function () { acTab = "dep"; renderAccount(b, t); };
      if (!DEMO) api({ action: "bonusInfo", token: S.token }).then(function (r) { var n = $("#wdLock"); if (r.ok && n && r.blocksWithdraw) { n.hidden = false; n.innerHTML = "<b>Withdrawals are locked</b> while you have bonus balance. Use it on a qualifying slip, or forfeit it (Bonuses tab)."; } }).catch(function () {});
      var STG = ["Submitted", "In process", "Verified", "Sent"], IDX = { pending: 0, processing: 1, verified: 2, paid: 3 }, wdN = 0;
      var wdStat = function () {
        var box = $("#wdStat"); if (!box || DEMO) return;
        api({ action: "myWithdrawals", token: S.token }).then(function (r) {
          box = $("#wdStat"); if (!box || !r.ok) return;
          if (r.items[0]) WA.wd = { amt: r.items[0].amount, st: r.items[0].status === "rejected" ? "Rejected" : STG[IDX[r.items[0].status] || 0] };
          box.innerHTML = r.items.slice(0, 6).map(function (x) {
            var rej = x.status === "rejected", i = IDX[x.status] || 0;
            return '<div class="wd-tx"><b>' + esc(money(x.amount)) + '</b> &middot; you receive ' + esc(money(x.net)) + '<small style="display:block;opacity:.65">' + esc(new Date(x.t).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })) + "</small>" +
              (rej ? '<p class="aerr">Rejected. The amount was returned to your wallet.</p>' : '<div class="wd-steps">' + STG.map(function (s, k) { return '<span class="' + (k <= i ? "d" : "") + '">' + s + "</span>"; }).join("") + "</div>") + "</div>";
          }).join("");
          var live = r.items.some(function (x) { return x.status !== "paid" && x.status !== "rejected"; });
          if (live && wdN++ < 80) setTimeout(function () { if ($("#wdStat") && acTab === "wd") wdStat(); }, 15000);
        }).catch(function () {});
      };
      wdStat();
      if (S.user.phone.indexOf("254") !== 0) $("#wdF").innerHTML = '<p class="bn-note">M-Pesa withdrawals need a +254 number. Contact support for other options.</p>'; else {
        var wa = $("#wdAmt"), wc = $("#wdCalc"), we = $("#wdErr");
        var wdLimMsg = function (v) { if (!(v > 0)) return; if (v < WMIN) we.textContent = "Minimum withdrawal is KES " + limN(WMIN) + "."; else if (v > bal) we.textContent = "That is more than your balance of " + money(bal) + "."; else if (v > WHIGH) we.textContent = "Maximum withdrawal is KES " + limN(WHIGH) + "."; };
        wa.oninput = function () { var v = Number(wa.value) || 0; we.textContent = ""; if (v > 0) { var fee = Math.round(v * FEE * 100) / 100; wc.hidden = false; wc.innerHTML = "Withholding levy (" + Math.round(FEE * 100) + "%): <b>-" + esc(money(fee)) + "</b><br>You will receive: <b>" + esc(money(v - fee)) + "</b>" + (v > WCHUNK ? "<br><small>Paid in " + Math.ceil(v / WCHUNK) + " M-Pesa parts" + (v > WMAX ? " (high payout)" : "") + ".</small>" : ""); } else wc.hidden = true; wdLimMsg(v); };
        $("#wdF").onsubmit = function (e) {
          e.preventDefault();
          var v = Math.round(Number(wa.value)), btn = $("#wdF button[type=submit]"); we.textContent = ""; $("#wdDone").innerHTML = "";
          if (!(v > 0)) { we.textContent = "Enter the amount you want to withdraw."; return; }
          if (v < WMIN) { we.textContent = "Minimum withdrawal is KES " + limN(WMIN) + "."; return; }
          if (v > WHIGH) { we.textContent = "Maximum withdrawal is KES " + limN(WHIGH) + "."; return; }
          if (v > (Number(S.user.balance) || 0)) { we.textContent = "Insufficient balance. Your balance is " + money(S.user.balance) + ". Deposit to continue."; return; }
          btn.disabled = true; btn.textContent = "Processing...";
          api({ action: "withdraw", token: S.token, amount: v }).then(function (r) {
            btn.disabled = false; btn.textContent = "Withdraw";
            if (r.expired) { setSession("", null); closeDlg($("#authDlg")); openAuth("bet"); return; }
            if (!r.ok) { we.textContent = r.error || "Could not submit your withdrawal."; return; }
            S.user.balance = r.balance; renderAcct(); wa.value = ""; wc.hidden = true;
            $("#wdDone").innerHTML = '<div class="wd-ok"><b>Withdrawal request submitted.</b><br>You will receive ' + esc(money(r.net)) + " after the " + Math.round(FEE * 100) + "% withholding levy. Once it is processed, the cash arrives in your M-Pesa." + (r.parts > 1 ? " It will be paid in " + r.parts + " M-Pesa parts." : "") + (r.high ? " High payouts may take longer. Support may contact you." : "") + "</div>";
            wdStat();
          }).catch(function () { btn.disabled = false; btn.textContent = "Withdraw"; we.textContent = "Network problem. Try again."; });
        };
      }
    } else if (acTab === "games") {
      a.innerHTML = '<p class="m"><span class=skl></span><span class=skl2></span><span class=skl3></span></p>';
      acCall({ action: "myGames", token: S.token }, function (r) {
        a.innerHTML = iwhIntro(r.max) + (r.rounds.length ? r.rounds.map(function (x) {
          return '<div class="gm-gh"><span>Round ' + esc(x.round.slice(1)) + " <small>" + new Date(x.at).toLocaleString("en-KE", { dateStyle: "short", timeStyle: "short" }) + "</small></span><span>" + (x.crash ? "Popped at " + gmFmt(x.crash) : "In play") + "</span></div>" +
            x.bets.map(function (y) { return '<div class="gm-r ' + y.status + '"><span>Bet ' + y.slot + (y.auto ? " (auto " + gmFmt(y.auto) + ")" : "") + "</span><span>" + money(y.stake) + "</span><span>" + (y.status === "won" ? gmFmt(y.cashAt) : y.status === "lost" ? "lost" : "...") + "</span><span>" + (y.status === "won" ? money(y.payout) : "") + "</span></div>"; }).join("");
        }).join("") : iwhEmpty());
      });
    } else if (acTab === "bonus") {
      bonusTab(a);
    } else {
      a.innerHTML = '<p id="limNow"><span class=skl></span><span class=skl2></span><span class=skl3></span></p><p>Self-exclusion blocks betting and deposits for the period you choose. Once it starts, it cannot be cut short.</p><div class="ac-g"><button type="button" class="btn ghost" data-ex="1">24 hours</button><button type="button" class="btn ghost" data-ex="7">7 days</button><button type="button" class="btn ghost" data-ex="30">30 days</button><button type="button" class="btn ghost" data-ex="180">6 months</button><button type="button" class="btn ghost" data-ex="365">1 year</button></div>';
      var show = function (r) { $("#limNow").textContent = r.until > Date.now() ? "You are self-excluded until " + new Date(r.until).toLocaleDateString("en-KE") + "." : "You are not self-excluded."; };
      acCall({ action: "myLedger", token: S.token }, show);
      $$("[data-ex]", a).forEach(function (x) { x.onclick = function () { if (confirm("You will not be able to bet or deposit until this self-exclusion ends, and it cannot be cancelled. Continue?")) acCall({ action: "setLimit", token: S.token, excludeDays: Number(x.getAttribute("data-ex")) }, function (r) { toast("Self-exclusion started."); show(r); }); }; });
    }
  }
  function iwhIntro(max) {
    return '<div class="iwh-intro"><b>Your instant wins, all in one place</b><p>Every round you play across our virtuals, casino and instant-win games is recorded here, including crash games, spinners, slots and virtual sports. Each entry shows the round, your stake, how it finished and what you won, so you can look back whenever you like.</p><ul><li>Newest rounds first</li><li>Wins, losses and rounds still in play</li>' + (max ? '<li>Your latest ' + esc(max) + ' rounds are kept; as new rounds are played, the oldest drop off</li>' : "") + '</ul></div>';
  }
  function iwhEmpty() {
    return '<div class="iwh-empty"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><b>No rounds or history yet</b><p>Once you play, every round will appear here with its result. Your first win could be just one round away.</p></div>';
  }
  function ic(n) {
    var P = { mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>', copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>', bets: '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>', trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', gift: '<rect x="3" y="8" width="18" height="4"/><path d="M12 8v13M5 12v9h14v-9M12 8c-2-4-6-3-5 0 1 1 3 0 5 0 2 0 4 1 5 0 1-3-3-4-5 0z"/>', users: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M18 15a6 6 0 0 1 3 5"/>', shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>', lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', out: '<path d="M9 21H5V3h4M16 17l5-5-5-5M21 12H9"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', dep: '<path d="M12 3v13M6 10l6 6 6-6M5 21h14"/>', wd: '<path d="M12 21V8M6 14l6-6 6 6M5 3h14"/>', play: '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 12.5h4M9 10.5v4M16 11.5h.01M18 13.5h.01"/>', cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>' };
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + P[n] + "</svg>";
  }
  document.addEventListener("keydown", function (e) { var h = e.target.closest && e.target.closest(".land-hero[data-auth]"); if (h && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openAuth(h.getAttribute("data-auth")); } });
  var mDr = $("#menuDrawer"), mSc = $("#menuScrim");
  function menu(o) { mDr.hidden = !o; mSc.hidden = !o; $("#menuBtn").setAttribute("aria-expanded", o); document.body.style.overflow = o ? "hidden" : ""; if (o) { var f = mDr.querySelector(".mx"); if (f) f.focus(); predMenuLine(); } }
  /* gold Predictor ticket: one live line (closes in..., you're in, new round soon). Uses the cached predictor call, so it costs nothing extra. */
  function predMenuLine() {
    var el = $("#miPredSub"), row = el && el.closest(".mi-pred"); if (!el || DEMO) return;
    api_raw({ action: "predInfo", token: S.token || "" }).then(function (d) {
      if (!d || !d.ok) return;
      var rd = d.round, t = "Predict 5 scores, win cash", live = false;
      if (rd && d.canEnter) {
        var ms = rd.closes - Date.now(), m = Math.max(0, Math.round(ms / 60000)), dd = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), left = dd > 0 ? dd + "d " + hh + "h" : hh > 0 ? hh + "h " + (m % 60) + "m" : m + "m";
        t = d.mine ? "You\u2019re in \u2713 \u2022 closes in " + left : "Closes in " + left; live = true;
      } else if (rd) t = d.mine ? "You\u2019re in \u2713 \u2022 results soon" : "Round closed \u2022 results soon";
      else t = "New round soon";
      el.textContent = t; if (row) row.classList.toggle("live", live);
    }).catch(function () {});
  }
  $("#menuBtn").onclick = function () { menu(mDr.hidden); };
  mSc.onclick = function () { menu(false); };
  mDr.addEventListener("click", function (e) { if (e.target.closest("a,button")) menu(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !mDr.hidden) menu(false); });
  var acPar = "home";
  var DROWS = [["dep", "dep", "Deposit"], ["wd", "wd", "Withdraw"], ["play", "play", "Play"], ["reward", "gift", "Rewards"], ["set", "cog", "Settings"], ["bets", "bets", "My bets"], ["games", "play", "Instant wins history"], ["jp", "trophy", "Jackpots"], ["hist", "list", "Transactions"], ["out", "out", "Log out"]];
  function dRows(rows) { return '<div class="dlist">' + rows.map(function (r) { return '<button type="button" class="drow" data-go="' + r[0] + '"><span class="ico">' + ic(r[1]) + '</span><span class="l">' + r[2] + '</span><span class="ch">&rsaquo;</span></button>'; }).join("") + "</div>"; }
  function dWire(a, b, t) {
    var d = $("#authDlg");
    $$("[data-go]", a).forEach(function (x) {
      x.onclick = function () {
        var k = x.getAttribute("data-go");
        if (k === "bets") { closeDlg(d); openBets(); } else if (k === "jp") { closeDlg(d); openJackpots(); } else if (k === "aff") { closeDlg(d); openAff("dash"); } else if (k === "play") { closeDlg(d); openGame(); }
        else if (k === "out") { var tk = S.token; setSession("", null); closeDlg(d); toast("Logged out."); if (!DEMO) api_raw({ action: "logout", token: tk }).catch(function () {}); }
        else { acPar = (acTab === "reward" || acTab === "set") ? acTab : "home"; acTab = k; renderAccount(b, t); }
      };
    });
  }
  function dashMenu(a, b, t) {
    var u = S.user, RW = [["bonus", "gift", "Bonuses and promos"], ["aff", "users", "Invite and earn"]], ST = [["lim", "shield", "Self-exclusion"], ["pw", "lock", "Change password"], ["inbox", "mail", "Inbox" + (u.unread ? " (" + u.unread + " new)" : "")], ["out", "out", "Log out"]];
    a.innerHTML = dRows(acTab === "reward" ? RW : ST);
    dWire(a, b, t);
  }
  function dashHome(a, b, t) {
    var u = S.user;
    a.innerHTML = '<div class="dh"><span class="dav">' + esc((u.name || "?").trim().charAt(0).toUpperCase()) + '</span><div class="dwho"><b>' + esc(u.name) + "</b><small>" + esc(u.phone) + '</small><button type="button" class="did" id="dId" aria-label="Copy account number">ID ' + esc(u.acct || "") + " " + ic("copy") + '</button></div><button type="button" class="dmail" data-go="inbox" aria-label="Inbox">' + ic("mail") + (u.unread ? '<span class="ndot">' + u.unread + "</span>" : "") + "</button></div>" +
      '<div class="dbal2"><button type="button" class="dbal" data-go="dep"><small>Cash balance</small><b>' + esc(money(u.balance)) + '</b><i>Withdrawable &middot; tap to deposit</i></button><button type="button" class="dbal bon" data-how="all"><small>Bonus balance</small><b id="acBonus">' + esc(money(u.bonus || 0)) + '</b><span id="acLock" hidden></span><i>Play only &middot; tap to see how to use it</i></button></div>' +
      dRows(DROWS) + '<p class="modal-note">18+ only. Bet responsibly.</p>';
    $("#dId").onclick = function () { try { navigator.clipboard.writeText(String(u.acct || "")); toast("Account number copied."); } catch (e) { toast("Account number: " + u.acct); } };
    dWire(a, b, t);
    if (!DEMO) api_raw({ action: "bonusInfo", token: S.token }).then(function (r) { var n = $("#acLock"), bb = $("#acBonus"); if (r.ok && bb) { bb.textContent = money(r.bonusBalance || 0); if (S.user) S.user.bonus = r.bonusBalance || 0; } if (r.ok && n && r.active && r.active.length) { n.hidden = false; n.textContent = r.active.length + " active part" + (r.active.length > 1 ? "s" : ""); } }).catch(function () {});
  }
  function openAuth(kind) {
    acPar = "home";
    if (kind === "wallet") { if (S.user) acTab = "dep"; else kind = "login"; } else if (kind === "account") acTab = "home";
    authTab = kind === "join" ? "join" : "login";
    authNote = kind === "bet" ? "Log in to place your bet." : "";
    if (S.user && S.token && !DEMO) api({ action: "me", token: S.token }).then(function (r) { if (r.ok && S.user) { S.user = r.user; try { if (store("q247.tok")) store("q247.user", S.user); } catch (e) {} renderAcct(); if ($("#authDlg").open) renderAuth(); } }).catch(function () {});
    renderAuth();
    var d = $("#authDlg");
    if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else d.setAttribute("open", "");
  }
  var loginBy = "phone";
  var EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYEOFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.9 17.9A10.9 10.9 0 0 1 12 19c-7 0-11-7-11-7a19.8 19.8 0 0 1 5.1-5.9M9.9 4.2A10.7 10.7 0 0 1 12 4c7 0 11 8 11 8a19.7 19.7 0 0 1-3.2 4.2M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="M1 1l22 22"/></svg>';
  function pwField(id, label, ac) { return '<label>' + label + '<span class="pw"><input id="' + id + '" type="password" maxlength="10" autocomplete="' + ac + '"><button type="button" class="eye" data-eye="' + id + '" aria-label="Show password">' + EYE + '</button></span></label>'; }
  /* countries: ISO code | name | phone code | currency. Phone lengths are exact for the countries we know well and 6 to 12 digits for the rest (the +1 family is 10). */
  var CNT_RAW = "AF|Afghanistan|93|AFN;AL|Albania|355|ALL;DZ|Algeria|213|DZD;AD|Andorra|376|EUR;AO|Angola|244|AOA;AG|Antigua and Barbuda|1|XCD;AR|Argentina|54|ARS;AM|Armenia|374|AMD;AU|Australia|61|AUD;AT|Austria|43|EUR;AZ|Azerbaijan|994|AZN;BS|Bahamas|1|BSD;BH|Bahrain|973|BHD;BD|Bangladesh|880|BDT;BB|Barbados|1|BBD;BY|Belarus|375|BYN;BE|Belgium|32|EUR;BZ|Belize|501|BZD;BJ|Benin|229|XOF;BT|Bhutan|975|BTN;BO|Bolivia|591|BOB;BA|Bosnia and Herzegovina|387|BAM;BW|Botswana|267|BWP;BR|Brazil|55|BRL;BN|Brunei|673|BND;BG|Bulgaria|359|EUR;BF|Burkina Faso|226|XOF;BI|Burundi|257|BIF;CV|Cabo Verde|238|CVE;KH|Cambodia|855|KHR;CM|Cameroon|237|XAF;CA|Canada|1|CAD;CF|Central African Republic|236|XAF;TD|Chad|235|XAF;CL|Chile|56|CLP;CN|China|86|CNY;CO|Colombia|57|COP;KM|Comoros|269|KMF;CG|Congo (Republic)|242|XAF;CD|Congo (DR)|243|CDF;CR|Costa Rica|506|CRC;CI|C\u00f4te d'Ivoire|225|XOF;HR|Croatia|385|EUR;CU|Cuba|53|CUP;CY|Cyprus|357|EUR;CZ|Czechia|420|CZK;DK|Denmark|45|DKK;DJ|Djibouti|253|DJF;DM|Dominica|1|XCD;DO|Dominican Republic|1|DOP;EC|Ecuador|593|USD;EG|Egypt|20|EGP;SV|El Salvador|503|USD;GQ|Equatorial Guinea|240|XAF;ER|Eritrea|291|ERN;EE|Estonia|372|EUR;SZ|Eswatini|268|SZL;ET|Ethiopia|251|ETB;FJ|Fiji|679|FJD;FI|Finland|358|EUR;FR|France|33|EUR;GA|Gabon|241|XAF;GM|Gambia|220|GMD;GE|Georgia|995|GEL;DE|Germany|49|EUR;GH|Ghana|233|GHS;GR|Greece|30|EUR;GD|Grenada|1|XCD;GT|Guatemala|502|GTQ;GN|Guinea|224|GNF;GW|Guinea-Bissau|245|XOF;GY|Guyana|592|GYD;HT|Haiti|509|HTG;HN|Honduras|504|HNL;HK|Hong Kong|852|HKD;HU|Hungary|36|HUF;IS|Iceland|354|ISK;IN|India|91|INR;ID|Indonesia|62|IDR;IR|Iran|98|IRR;IQ|Iraq|964|IQD;IE|Ireland|353|EUR;IL|Israel|972|ILS;IT|Italy|39|EUR;JM|Jamaica|1|JMD;JP|Japan|81|JPY;JO|Jordan|962|JOD;KZ|Kazakhstan|7|KZT;KE|Kenya|254|KES;KI|Kiribati|686|AUD;XK|Kosovo|383|EUR;KW|Kuwait|965|KWD;KG|Kyrgyzstan|996|KGS;LA|Laos|856|LAK;LV|Latvia|371|EUR;LB|Lebanon|961|LBP;LS|Lesotho|266|LSL;LR|Liberia|231|LRD;LY|Libya|218|LYD;LI|Liechtenstein|423|CHF;LT|Lithuania|370|EUR;LU|Luxembourg|352|EUR;MO|Macao|853|MOP;MG|Madagascar|261|MGA;MW|Malawi|265|MWK;MY|Malaysia|60|MYR;MV|Maldives|960|MVR;ML|Mali|223|XOF;MT|Malta|356|EUR;MH|Marshall Islands|692|USD;MR|Mauritania|222|MRU;MU|Mauritius|230|MUR;MX|Mexico|52|MXN;FM|Micronesia|691|USD;MD|Moldova|373|MDL;MC|Monaco|377|EUR;MN|Mongolia|976|MNT;ME|Montenegro|382|EUR;MA|Morocco|212|MAD;MZ|Mozambique|258|MZN;MM|Myanmar|95|MMK;NA|Namibia|264|NAD;NR|Nauru|674|AUD;NP|Nepal|977|NPR;NL|Netherlands|31|EUR;NZ|New Zealand|64|NZD;NI|Nicaragua|505|NIO;NE|Niger|227|XOF;NG|Nigeria|234|NGN;KP|North Korea|850|KPW;MK|North Macedonia|389|MKD;NO|Norway|47|NOK;OM|Oman|968|OMR;PK|Pakistan|92|PKR;PW|Palau|680|USD;PS|Palestine|970|ILS;PA|Panama|507|PAB;PG|Papua New Guinea|675|PGK;PY|Paraguay|595|PYG;PE|Peru|51|PEN;PH|Philippines|63|PHP;PL|Poland|48|PLN;PT|Portugal|351|EUR;PR|Puerto Rico|1|USD;QA|Qatar|974|QAR;RO|Romania|40|RON;RU|Russia|7|RUB;RW|Rwanda|250|RWF;KN|Saint Kitts and Nevis|1|XCD;LC|Saint Lucia|1|XCD;VC|Saint Vincent and the Grenadines|1|XCD;WS|Samoa|685|WST;SM|San Marino|378|EUR;ST|S\u00e3o Tom\u00e9 and Pr\u00edncipe|239|STN;SA|Saudi Arabia|966|SAR;SN|Senegal|221|XOF;RS|Serbia|381|RSD;SC|Seychelles|248|SCR;SL|Sierra Leone|232|SLE;SG|Singapore|65|SGD;SK|Slovakia|421|EUR;SI|Slovenia|386|EUR;SB|Solomon Islands|677|SBD;SO|Somalia|252|SOS;ZA|South Africa|27|ZAR;KR|South Korea|82|KRW;SS|South Sudan|211|SSP;ES|Spain|34|EUR;LK|Sri Lanka|94|LKR;SD|Sudan|249|SDG;SR|Suriname|597|SRD;SE|Sweden|46|SEK;CH|Switzerland|41|CHF;SY|Syria|963|SYP;TW|Taiwan|886|TWD;TJ|Tajikistan|992|TJS;TZ|Tanzania|255|TZS;TH|Thailand|66|THB;TL|Timor-Leste|670|USD;TG|Togo|228|XOF;TO|Tonga|676|TOP;TT|Trinidad and Tobago|1|TTD;TN|Tunisia|216|TND;TR|T\u00fcrkiye|90|TRY;TM|Turkmenistan|993|TMT;TV|Tuvalu|688|AUD;UG|Uganda|256|UGX;UA|Ukraine|380|UAH;AE|United Arab Emirates|971|AED;GB|United Kingdom|44|GBP;US|United States|1|USD;UY|Uruguay|598|UYU;UZ|Uzbekistan|998|UZS;VU|Vanuatu|678|VUV;VA|Vatican City|39|EUR;VE|Venezuela|58|VES;VN|Vietnam|84|VND;YE|Yemen|967|YER;ZM|Zambia|260|ZMW;ZW|Zimbabwe|263|ZWG", CUR_RAW = "AFN Afghan afghani;ALL Albanian lek;DZD Algerian dinar;EUR Euro;AOA Angolan kwanza;XCD East Caribbean dollar;ARS Argentine peso;AMD Armenian dram;AUD Australian dollar;AZN Azerbaijani manat;BSD Bahamian dollar;BHD Bahraini dinar;BDT Bangladeshi taka;BBD Barbadian dollar;BYN Belarusian ruble;BZD Belize dollar;XOF West African CFA franc;BTN Bhutanese ngultrum;BOB Bolivian boliviano;BAM Bosnia-Herzegovina convertible mark;BWP Botswana pula;BRL Brazilian real;BND Brunei dollar;BIF Burundian franc;CVE Cape Verdean escudo;KHR Cambodian riel;XAF Central African CFA franc;CAD Canadian dollar;CLP Chilean peso;CNY Chinese yuan;COP Colombian peso;KMF Comorian franc;CDF Congolese franc;CRC Costa Rican col\u00f3n;CUP Cuban peso;CZK Czech koruna;DKK Danish krone;DJF Djiboutian franc;DOP Dominican peso;USD US dollar;EGP Egyptian pound;ERN Eritrean nakfa;SZL Swazi lilangeni;ETB Ethiopian birr;FJD Fijian dollar;GMD Gambian dalasi;GEL Georgian lari;GHS Ghanaian cedi;GTQ Guatemalan quetzal;GNF Guinean franc;GYD Guyanese dollar;HTG Haitian gourde;HNL Honduran lempira;HKD Hong Kong dollar;HUF Hungarian forint;ISK Icelandic kr\u00f3na;INR Indian rupee;IDR Indonesian rupiah;IRR Iranian rial;IQD Iraqi dinar;ILS Israeli shekel;JMD Jamaican dollar;JPY Japanese yen;JOD Jordanian dinar;KZT Kazakhstani tenge;KES Kenyan shilling;KWD Kuwaiti dinar;KGS Kyrgyzstani som;LAK Lao kip;LBP Lebanese pound;LSL Lesotho loti;LRD Liberian dollar;LYD Libyan dinar;CHF Swiss franc;MOP Macanese pataca;MGA Malagasy ariary;MWK Malawian kwacha;MYR Malaysian ringgit;MVR Maldivian rufiyaa;MRU Mauritanian ouguiya;MUR Mauritian rupee;MXN Mexican peso;MDL Moldovan leu;MNT Mongolian t\u00f6gr\u00f6g;MAD Moroccan dirham;MZN Mozambican metical;MMK Myanmar kyat;NAD Namibian dollar;NPR Nepalese rupee;NZD New Zealand dollar;NIO Nicaraguan c\u00f3rdoba;NGN Nigerian naira;KPW North Korean won;MKD Macedonian denar;NOK Norwegian krone;OMR Omani rial;PKR Pakistani rupee;PAB Panamanian balboa;PGK Papua New Guinean kina;PYG Paraguayan guaran\u00ed;PEN Peruvian sol;PHP Philippine peso;PLN Polish z\u0142oty;QAR Qatari riyal;RON Romanian leu;RUB Russian ruble;RWF Rwandan franc;WST Samoan t\u0101l\u0101;STN S\u00e3o Tom\u00e9 and Pr\u00edncipe dobra;SAR Saudi riyal;RSD Serbian dinar;SCR Seychellois rupee;SLE Sierra Leonean leone;SGD Singapore dollar;SBD Solomon Islands dollar;SOS Somali shilling;ZAR South African rand;KRW South Korean won;SSP South Sudanese pound;LKR Sri Lankan rupee;SDG Sudanese pound;SRD Surinamese dollar;SEK Swedish krona;SYP Syrian pound;TWD New Taiwan dollar;TJS Tajikistani somoni;TZS Tanzanian shilling;THB Thai baht;TOP Tongan pa\u02bbanga;TTD Trinidad and Tobago dollar;TND Tunisian dinar;TRY Turkish lira;TMT Turkmenistani manat;UGX Ugandan shilling;UAH Ukrainian hryvnia;AED UAE dirham;GBP British pound;UYU Uruguayan peso;UZS Uzbekistani som;VUV Vanuatu vatu;VES Venezuelan bol\u00edvar;VND Vietnamese dong;YER Yemeni rial;ZMW Zambian kwacha;ZWG Zimbabwe Gold", LEN_RAW = "KE:9-9;UG:9-9;TZ:9-9;RW:9-9;NG:10-10;GH:9-9;ZA:9-9;ET:9-9;EG:10-10;ZM:9-9;GB:10-10;IE:9-9";
  var CUR = {}; CUR_RAW.split(";").forEach(function (x) { var i = x.indexOf(" "); CUR[x.slice(0, i)] = x.slice(i + 1); });
  var CUR_ON = { KES: 1 };   /* currencies players can use now. Add a code here (and set up its payments) to switch another currency on */
  var LENS = {}; LEN_RAW.split(";").forEach(function (x) { var p = x.split(":"), r = p[1].split("-"); LENS[p[0]] = [+r[0], +r[1]]; });
  function flagOf(iso) { return String.fromCodePoint(0x1F1E6 + iso.charCodeAt(0) - 65, 0x1F1E6 + iso.charCodeAt(1) - 65); }
  var CCS = CNT_RAW.split(";").map(function (r) { var p = r.split("|"), L = LENS[p[0]] || (p[2] === "1" ? [10, 10] : [6, 12]); return [p[0], flagOf(p[0]), p[1], p[2], L[0], L[1], p[3]]; });
  CCS.sort(function (x, y) { return x[0] === "KE" ? -1 : y[0] === "KE" ? 1 : x[2].localeCompare(y[2]); });   /* Kenya first, then A to Z */
  var ccSel = "KE";   /* the chosen country, kept while the window switches between Log in, Sign up and Forgot */
  function ccOpts(withCode) { return CCS.map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === ccSel ? " selected" : "") + ">" + c[1] + " " + esc(c[2]) + (withCode ? " +" + c[3] : "") + "</option>"; }).join(""); }
  function phoneField() {   /* log in and forgot password: one compact row */
    return '<label>Phone number<span class="pf"><select id="afCc" aria-label="Country">' + ccOpts(true) + '</select>' +
      '<input id="afPhone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="712345678" maxlength="12"></span></label>';
  }
  function joinPhone() {    /* sign up: country first, then the number with its code in front */
    return '<label>Country<select id="afCc" aria-label="Country">' + ccOpts(false) + '</select></label>' +
      '<label>Phone number<span class="pn"><i id="afPfx" class="pfx"></i><input id="afPhone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="712345678" maxlength="12"></span></label>' +
      '<p id="curLine" class="cur-line"></p>';
  }
  function ccInfo() { var e = $("#afCc"), c = e ? e.value : ccSel; return CCS.filter(function (x) { return x[0] === c; })[0] || CCS[0]; }
  function fixPhone() {
    var i = $("#afPhone"), c = ccInfo(), d = i.value.replace(/\D/g, "");
    if (d.indexOf(c[3]) === 0 && d.length > c[5]) d = d.slice(c[3].length);
    d = d.replace(/^0+/, "");
    if (c[3] === "254") d = d.replace(/^[^17]+/, "");
    i.maxLength = c[5]; i.value = d.slice(0, c[5]);
  }
  function fullPhone() { var c = ccInfo(); fixPhone(); var d = $("#afPhone").value; return d.length >= c[4] && d.length <= c[5] ? c[3] + d : ""; }
  function phMsg() { var c = ccInfo(); return "Enter a valid " + (c[4] === c[5] ? c[4] + "-digit phone number" : "phone number (" + c[4] + " to " + c[5] + " digits)") + (c[3] === "254" ? " starting with 7 or 1." : "."); }
  function acctCur() { var c = ccInfo()[6]; return CUR_ON[c] ? c : "KES"; }   /* accounts stay in Kenyan shillings until a currency is switched on */
  function curText() {
    var c = ccInfo(), k = c[6], nm = CUR[k] || k;
    if (k === "KES") return "Currency: KES, Kenyan shilling (KSh)";
    if (CUR_ON[k]) return "Currency: " + k + ", " + nm;
    return "Your local currency is " + k + " (" + nm + "). Accounts are in Kenyan shillings (KSh) for now.";
  }
  function ccPaint() { var p = $("#afPfx"), l = $("#curLine"), c = ccInfo(); ccSel = c[0]; if (p) p.textContent = "+" + c[3]; if (l) l.textContent = curText(); var i = $("#afPhone"); if (i) i.placeholder = c[3] === "254" ? "712345678" : "Phone number"; }
  /* the promo field: locked and tagged when the visitor came from an affiliate link */
  function refField() {
    var c = REFLOCK.code;
    if (c && REFLOCK.st !== "bad") return '<label>Promo code &#128274;<input id="afRef" type="text" maxlength="12" value="' + esc(c) + '" readonly aria-readonly="true" tabindex="-1"></label><p class="ref-tag"><b>Referred by ' + esc(c) + '</b>' + (REFLOCK.st === "chk" ? " <i>checking...</i>" : "") + "</p>";
    var sv0 = REFLOCK.st === "bad" ? "" : (store("q247.ref") || "");
    if (!sv0 && REFLOCK.st !== "bad" && !REFLOCK.open) return '<button type="button" class="lnk ref-open" id="refOpen">Have a promo code?</button>';
    return '<label>Promo code (if you have one)<input id="afRef" type="text" maxlength="12" autocapitalize="characters" value="' + esc(REFLOCK.st === "bad" ? "" : (store("q247.ref") || "")) + '"></label>' +
      (REFLOCK.st === "bad" ? '<p class="ref-bad">The code ' + esc(REFLOCK.code) + " was not recognised. Type another code, or leave it empty.</p>" : "");
  }
  function refBind() { var x = $("#refOpen"); if (x) x.onclick = function () { REFLOCK.open = true; refPaint(); var i = $("#afRef"); if (i) i.focus(); }; }
  function refPaint() { var bx = $("#refBox"); if (bx && $("#authDlg").open && !S.user && authTab === "join") { bx.innerHTML = refField(); refBind(); } }
  function refVerify(code) {
    REFLOCK = { code: code, st: "chk" };
    if (DEMO) { REFLOCK.st = "unv"; return; }
    api({ action: "refCheck", code: code, dev: devId() }).then(function (r) {
      if (r && r.ok && r.valid === true) REFLOCK.st = "ok";
      else if (r && r.ok && r.valid === false) { REFLOCK.st = "bad"; store("q247.ref", ""); }
      else REFLOCK.st = "unv";            // server could not say: the sign-up itself still checks the code
    }).catch(function () { REFLOCK.st = "unv"; }).then(refPaint);
  }
  /* affiliate link (?ref=CODE): always opens Sign up with the code locked, whatever this browser has stored. "Already have an account? Log in" stays under the form. */
  function refEntry() {
    var q = "", sl = ""; try { var P = new URLSearchParams(location.search); q = P.get("ref") || ""; sl = P.get("slip") || ""; } catch (e) {}
    q = q.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    if (!q || q.length < 3 || sl || DEMO) return false;     // slip links keep their own behaviour
    if (S.token || S.user) { toast("You are already logged in. Referral links are for new sign-ups."); return false; }
    REFGO = true;
    refVerify(q); openAuth("join"); return true;
  }
  function bonusCard() {   /* the three sign-up bonuses, read from the same settings the rest of the site uses */
    var W = PROMO.welcome, K = PROMO.weekend, F = PROMO.free || { amount: 50, on: true }, kx = function (n) { return money(n).replace(".00", ""); }, r = [];
    if (F.on !== false) r.push("<li><b>" + kx(F.amount) + " free</b> when you register. No deposit needed</li>");
    r.push("<li><b>" + W.pct + "% welcome bonus</b> on your first deposit, up to " + kx(W.max) + "</li>");
    r.push("<li><b>" + K.pct + "% Saturday bonus</b> on your first deposit of the day, up to " + kx(K.max) + "</li>");
    return '<div class="bcard"><p class="bc-h">Your sign-up bonuses</p><ul>' + r.join("") + '</ul><p class="bc-n">A first deposit made on a Saturday gets the ' + W.pct + '% welcome bonus only.</p></div>';
  }
  function renderAuth() {
    var b = $("#authBody"), t = $("#authTitle");
    if (S.user) { renderAccount(b, t); return; }
    t.textContent = ""; $("#authDlg").classList.remove("dash"); waAcctBar(false);
    var view = authTab === "join" ? "join" : authTab === "forgot" ? "forgot" : "login", join = view === "join", h = "", foot = "", btn = "Log in";
    if (join) {
      btn = "Sign up";
      h = '<label>Full name<input id="afName" type="text" autocomplete="name" maxlength="60" placeholder="First and last name"></label>' + joinPhone() +
        '<div id="refBox">' + refField() + '</div>' +
        pwField("afPw", "Password (6 to 10 characters)", "new-password") + pwField("afPw2", "Re-enter your password", "new-password") +
        bonusCard() +
        '<div id="agBox" class="agree">' +
        '<label class="ag-c"><input id="afAgree" type="checkbox"><span>I am 18+, opening one account in my own name, and I understand betting uses real money and carries risk. I agree to the <button type="button" class="lnk" data-info="terms">Terms &amp; conditions</button>, <button type="button" class="lnk" data-info="bonus">Bonus terms</button> and <button type="button" class="lnk" data-info="privacy">Privacy notice</button>. <button type="button" class="lnk" data-info="rg">Play responsibly</button>.</span></label></div>';
      foot = '<p class="sub">Already have an account? <button type="button" class="lnk" data-at="login">Log in</button></p>';
    } else if (view === "login") {
      h = '<div class="atabs"><button type="button" data-by="id" aria-pressed="' + (loginBy === "id") + '">By ID</button><button type="button" data-by="phone" aria-pressed="' + (loginBy === "phone") + '">By phone</button></div>' +
        (loginBy === "id" ? '<label>Account number<input id="afId" type="text" inputmode="numeric" autocomplete="username" placeholder="e.g. 36812981781"></label>' : phoneField()) +
        pwField("afPw", "Password", "current-password") +
        '<label class="chk"><input id="afRem" type="checkbox" checked><span>Remember me</span></label>';
      foot = '<p class="sub"><button type="button" class="lnk" data-at="forgot">Forgot your password?</button></p><hr class="sep"><p class="sub">Don\'t have an account? <button type="button" class="lnk" data-at="join">Sign up</button></p>';
    } else {
      if (fgStep === 2) { btn = "Reset password"; h = '<p>Enter the 5-digit code we emailed you and choose a new password.</p><label>5-digit code<input id="afCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="5" placeholder="12345"></label>' + pwField("afPw", "New password (6 to 10 characters)", "new-password") + pwField("afPw2", "Re-enter new password", "new-password"); }
      else { btn = "Send code"; h = '<p>Enter the phone number on your account and an email you can open now. We will email you a 5-digit code.</p>' + phoneField() + '<label>Email<input id="afMail" type="email" autocomplete="email" maxlength="120" placeholder="you@example.com"></label>'; }
      foot = '<p class="sub"><button type="button" class="lnk" data-at="login">Back to log in</button></p>';
    }
    b.innerHTML = (view === "forgot" ? "" : '<div class="atabs"><button type="button" data-at="login" aria-pressed="' + !join + '">Log in</button><button type="button" data-at="join" aria-pressed="' + join + '">Sign up</button></div>') +
      '<form id="authForm" class="af" novalidate>' + h +
      '<p id="aerr" class="aerr" role="alert">' + esc(DEMO ? "Set API_URL in the settings block to enable accounts." : authNote) + '</p>' +
      '<button type="submit" class="btn lime wide">' + btn + '</button>' + foot + '</form>';
    $$("[data-at]", b).forEach(function (x) { x.onclick = function () { authTab = x.getAttribute("data-at"); authNote = ""; fgStep = 0; renderAuth(); }; });
    $$("[data-by]", b).forEach(function (x) { x.onclick = function () { loginBy = x.getAttribute("data-by"); authNote = ""; renderAuth(); }; });
    $$("[data-eye]", b).forEach(function (x) {
      x.onclick = function () { var i = $("#" + x.getAttribute("data-eye")), show = i.type === "password"; i.type = show ? "text" : "password"; x.innerHTML = show ? EYEOFF : EYE; x.setAttribute("aria-label", show ? "Hide password" : "Show password"); };
    });
    if ($("#afPhone")) { $("#afPhone").oninput = fixPhone; $("#afCc").onchange = function () { ccPaint(); fixPhone(); }; ccPaint(); }
    refBind();
    if ($("#afAgree")) $("#afAgree").onchange = function () { $("#agBox").classList.toggle("bad", false); $("#agBox").classList.toggle("ok", this.checked); if (this.checked) { var e0 = $("#aerr"); if (e0 && /tick the box/i.test(e0.textContent)) e0.textContent = ""; } };
    $("#authForm").onsubmit = function (e) {
      e.preventDefault();
      var err = $("#aerr"), sub = $("#authForm button[type=submit]");
      err.classList.remove("ok");
      if (DEMO) return;
      var body, fail = function (m) { err.textContent = m; };
      if (join) {
        var nm = $("#afName").value.trim(), ph = fullPhone(), p1 = $("#afPw").value, p2 = $("#afPw2").value;
        if (nm.length < 2) return fail("Enter your full name.");
        if (!ph) return fail(phMsg());
        if (p1.length < 6 || p1.length > 10) return fail("Password must be 6 to 10 characters.");
        if (p1 !== p2) return fail("The two passwords do not match.");
        if (!$("#afAgree").checked) {   /* the tick is required: no account without the 18+ confirmation and agreement */
          var ab = $("#agBox"); ab.classList.remove("shake"); void ab.offsetWidth; ab.classList.add("bad", "shake");
          try { ab.scrollIntoView({ block: "center", behavior: "smooth" }); $("#afAgree").focus({ preventScroll: true }); } catch (x) {}
          return fail("Please tick the box to confirm you are 18+ and agree to the Terms.");
        }
        body = { action: "register", dev: devId(), fp: fpId(), name: nm, phone: ph, password: p1, currency: acctCur(), country: ccInfo()[0], ref: ($("#afRef") || {}).value || "", camp: store("q247.camp") || "" };
      } else if (view === "login") {
        var pw = $("#afPw").value;
        if (loginBy === "id") { var id = $("#afId").value.trim(); if (!id) return fail("Enter your account number."); body = { action: "login", dev: devId(), fp: fpId(), env: loginEnv(), uid: id, password: pw }; }
        else { var lp = fullPhone(); if (!lp) return fail(phMsg()); body = { action: "login", dev: devId(), fp: fpId(), env: loginEnv(), phone: lp, password: pw }; }
        if (!pw) return fail("Enter your password.");
      } else {
        if (fgStep === 2) {
          var cd = $("#afCode").value.trim(), n1 = $("#afPw").value, n2 = $("#afPw2").value;
          if (!/^\d{5}$/.test(cd)) return fail("Enter the 5-digit code."); if (n1.length < 6 || n1.length > 10) return fail("Password must be 6 to 10 characters."); if (n1 !== n2) return fail("The two passwords do not match.");
          body = { action: "confirmReset", phone: fgPhone, code: cd, password: n1 };
        } else {
          var fp = fullPhone(), fm = $("#afMail").value.trim(); if (!fp) return fail(phMsg()); if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(fm)) return fail("Enter a valid email address.");
          fgPhone = fp; body = { action: "forgot", phone: fp, email: fm };
        }
      }
      sub.disabled = true; err.textContent = "";
      api(body).then(function (r) {
        sub.disabled = false;
        if (!r.ok) {
          if (join && /already registered/i.test(r.error || "")) { var typed = $("#afPhone").value; authTab = "join" === authTab ? "login" : authTab; loginBy = "phone"; authNote = r.error; renderAuth(); $("#afPhone").value = typed; return; }
          err.textContent = r.error || "Could not continue."; return;
        }
        if (view === "forgot") { if (r.queued) { err.classList.add("ok"); err.textContent = r.info; return; } if (fgStep === 2) { fgStep = 0; authTab = "login"; loginBy = "phone"; authNote = r.info || "Password changed."; renderAuth(); return; } fgStep = 2; authNote = r.info || "Code sent."; renderAuth(); return; }
        closeDlg($("#authDlg")); try { setSession(r.token, r.user, view === "login" ? $("#afRem").checked : true); } catch (e) { console.error(e); } toast(join ? "Welcome to 247Bet." : "You are logged in."); if (join && r.free) setTimeout(function () { freeBonusPopup(r.free, welcomePopup); }, 450); else if (join && (r.freeWhy === "device" || r.freeWhy === "print")) setTimeout(function () { freeBlockedPopup(welcomePopup); }, 450); else if (join) setTimeout(welcomePopup, 450);
        if (affAfterLogin) { var am = affAfterLogin; affAfterLogin = ""; setTimeout(function () { openAff(am); }, 400); }
        if (DEP_PEND) { var dpn = DEP_PEND; DEP_PEND = null; setTimeout(function () { depPrompt(dpn.amt); }, 450); }
        if (GO_PEND) { var gow = GO_PEND; GO_PEND = ""; if (!join) setTimeout(function () { goOpen(gow); }, 450); }
      }).catch(function () { sub.disabled = false; err.textContent = "Network problem. Try again."; });
    };
  }

  function freeBlockedPopup(then) {
    var o = document.createElement("div"); o.setAttribute("role", "dialog"); o.style.cssText = "position:fixed;inset:0;z-index:300;background:rgba(2,11,32,.82);display:flex;align-items:center;justify-content:center;padding:18px";
    o.innerHTML = '<div style="max-width:340px;width:100%;background:var(--surf);border:1px solid var(--line,#2a3b5c);border-radius:16px;padding:22px 18px;text-align:center;color:var(--text)"><div style="font-size:calc(34px * var(--ts))">&#128241;</div><h3 style="margin:6px 0">Welcome to 247Bet</h3><p style="margin:0 0 6px">Your account is ready.</p><p style="margin:0 0 14px;font-size:calc(13px * var(--ts));opacity:.85">Your free registration bonus was not added. Please tap Talk to a human and tell us your account number. You can deposit and bet as normal.</p><button type="button" class="btn lime wide" id="fbOk2">Got it</button></div>';
    document.body.appendChild(o); var dn2 = false; function cl2() { if (dn2) return; dn2 = true; o.remove(); if (then) setTimeout(then, 250); } o.querySelector("#fbOk2").onclick = cl2; o.onclick = function (e) { if (e.target === o) cl2(); };
  }
  function freeBonusPopup(amt, then) {
    var o = document.createElement("div"); o.setAttribute("role", "dialog"); o.style.cssText = "position:fixed;inset:0;z-index:300;background:rgba(2,11,32,.82);display:flex;align-items:center;justify-content:center;padding:18px";
    o.innerHTML = '<div style="max-width:340px;width:100%;background:var(--surf);border:1px solid var(--lime);border-radius:16px;padding:22px 18px;text-align:center;color:var(--text)"><div style="font-size:calc(34px * var(--ts))">&#127873;</div><h3 style="margin:6px 0">Congratulations!</h3><p style="margin:0 0 6px">Your <b>KES ' + k0(amt) + ' free registration bonus</b> is active.</p><p style="margin:0 0 14px;font-size:calc(13px * var(--ts));opacity:.85">Stake all of it on one slip of 5 or more matches, every match at odds 1.5 or higher, within 24 hours. If it wins, the KES ' + k0(amt) + ' is deducted and you keep the winnings.</p><button type="button" class="btn lime wide" id="fbOk">Pick my matches</button></div>';
    document.body.appendChild(o); var dn = false; function cl() { if (dn) return; dn = true; o.remove(); if (then) setTimeout(then, 250); } o.querySelector("#fbOk").onclick = cl; o.onclick = function (e) { if (e.target === o) cl(); };
  }
  function welcomePopup() {   /* 200% first-deposit bonus: shown once, right after sign-up (after the free-bonus popup, never on top of it). Every figure comes from PROMO (the server). */
    if (!S.user) return;
    var W = PROMO.welcome, sl = W.slip, o = document.createElement("div"); o.setAttribute("role", "dialog"); o.style.cssText = "position:fixed;inset:0;z-index:300;background:rgba(2,11,32,.82);display:flex;align-items:center;justify-content:center;padding:18px";
    o.innerHTML = '<div style="max-width:360px;width:100%;max-height:92vh;overflow:auto;background:var(--surf);border:1px solid var(--lime);border-radius:16px;padding:22px 18px;text-align:center;color:var(--text)"><div style="font-size:calc(34px * var(--ts))">&#127881;</div><h3 style="margin:6px 0">' + W.pct + '% welcome bonus</h3><p style="margin:0 0 8px">Your <b>first deposit</b> gets <b>' + W.pct + '% extra</b>, from KES ' + k0(W.min) + ', up to KES ' + k0(W.max) + ', valid ' + W.days + ' days.</p><div style="text-align:left;font-size:calc(13px * var(--ts));opacity:.9;margin:0 0 12px"><b>How to use it</b><ul style="margin:4px 0 0;padding-left:18px"><li>Make a slip of <b>' + sl.matches + '+ matches</b>, every match at odds <b>' + sl.odds.toFixed(2) + '+</b>.</li><li>Minimum stake <b>KES ' + k0(sl.stake) + '</b>, then switch on <b>Use bonus</b> on the bet slip.</li><li>Withdrawals stay locked until the bonus is played. The bonus stake is deducted from your winnings.</li><li>It is ' + W.pct + '% on your first deposit on any day, even a Saturday.</li></ul></div><button type="button" class="btn lime wide" id="wbDep">Deposit now</button><button type="button" class="btn ghost wide" id="wbLater" style="margin-top:8px">Later</button></div>';
    document.body.appendChild(o);
    function cw() { o.remove(); } o.querySelector("#wbLater").onclick = cw; o.onclick = function (e) { if (e.target === o) cw(); };
    o.querySelector("#wbDep").onclick = function () { cw(); openAuth("wallet"); };
  }

  $("#authDlg").addEventListener("close", function () { this.classList.remove("payview"); if (document.querySelector("#payBox iframe")) payKill();   /* window closed with the X or Escape: destroy the gateway frame too (the session itself keeps being watched, so a late approval is still credited) */
    setTimeout(function () { affAfterLogin = ""; DEP_PEND = null; GO_PEND = ""; }, 0); });
  /* ---------- deposits ---------- */
  function msg(t) { var e = $("#aerr"); if (e) e.textContent = t; }
  /* ---- other payment methods: shown as tiles, all locked for now ---- */
  var LOCKED = [
    ["E-wallets", [["Airtm", "w", "AIRTM", "#ffffff"], ["MoneyGo", "w", "MoneyGo", "#ff5c99"], ["Skrill", "w", "Skrill", "#c2328f"], ["Neteller", "w", "NETELLER", "#7ac943"], ["Binance Pay", "w", "BINANCE", "#f3ba2f"], ["Perfect Money", "w", "PM", "#ff5a5f"]]],
    ["Mobile payments", [["Airtel Money", "w", "airtel", "#ff4a4a"]]],
    ["Prepaid cards", [["Vouchers", "w", "Voucher", "#c9d3e6"]]],
    ["Cryptocurrency", [["Bitcoin", "c", "\u20bf", "#f7931a"], ["Ethereum", "c", "\u039e", "#627eea"], ["Tether TRC20", "c", "\u20ae", "#26a17b"], ["Tether BEP20", "c", "\u20ae", "#26a17b"], ["USD Coin", "c", "$", "#2775ca"], ["Litecoin", "c", "\u0141", "#345d9d"], ["BNB", "c", "B", "#d99e0b"], ["TRON", "c", "T", "#ef0027"], ["Dogecoin", "c", "\u00d0", "#c2a633"], ["XRP", "c", "X", "#3b4652"], ["Solana", "c", "S", "#9945ff"], ["TON", "c", "T", "#0098ea"]]]
  ];
  var LOCKSVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>';
  function lockedMethods() {
    return '<p class="lk-head">Not available yet</p><div class="lk-wrap">' + LOCKED.map(function (g) {
      return '<p class="dmh">' + esc(g[0]) + '</p><div class="lkg">' + g[1].map(function (t) {
        var ic = t[1] === "c" ? '<span class="lk-ic coin" style="background:' + t[3] + '">' + esc(t[2]) + "</span>" : '<span class="lk-ic word" style="color:' + t[3] + '">' + esc(t[2]) + "</span>";
        return '<button type="button" class="lk" data-lk="' + esc(t[0]) + '" aria-label="' + esc(t[0]) + ', not available in your country">' + ic + '<span class="lk-n">' + esc(t[0]) + '</span><i class="lk-l" aria-hidden="true">' + LOCKSVG + "</i></button>";
      }).join("") + "</div>";
    }).join("") + '</div><div id="lkMsg" class="lk-msg" role="status" hidden></div>';
  }
  function wireLocked(a) {
    var box = $("#lkMsg"), tm = 0; if (!box) return;
    $$(".lk", a).forEach(function (x) {
      x.onclick = function () {
        box.innerHTML = '<span aria-hidden="true">&#128274;</span><div><b>' + esc(x.getAttribute("data-lk")) + " is locked</b><small>Not available in your country yet. Deposit instantly with M-Pesa.</small></div>";
        box.hidden = false; clearTimeout(tm); tm = setTimeout(function () { box.hidden = true; }, 5000);
      };
    });
  }
  function renderDeposit() {
    DEP_BUSY = false; setTimeout(function () { try { depNudgeCheck(); } catch (e) {} }, 400);
    paySweep();   /* a payment left hanging earlier is closed first, so every deposit starts afresh */
    var b = $("#authBody"); $("#authTitle").textContent = "Deposit"; $("#authDlg").classList.remove("payview");
    b.innerHTML = '<form id="depForm" class="af" novalidate><p class="lim-bal">Your balance <b id="dpBal">' + esc(money(S.user ? S.user.balance : 0)) + '</b></p><p id="dpBonus" class="bn-note"></p><label>Amount (KES)<input id="dpAmt" type="tel" inputmode="numeric" placeholder="e.g. 500" autocomplete="off"></label><p id="dpLim" class="lim-msg" role="status"></p>' +
      '<div class="quick">' + [100, 500, 1000, 5000].map(function (n) { return '<button type="button" data-dq="' + n + '">+' + n.toLocaleString("en-KE") + "</button>"; }).join("") + "</div>" +
      '<p class="lim-line">Min KES ' + limN(LIM.dep.min) + ' &middot; Max KES ' + limN(LIM.dep.max) + ' per transaction &middot; Daily KES ' + limN(LIM.dep.day) + '</p>' + limMore() +
      '<p id="aerr" class="aerr" role="alert"></p><button type="submit" class="btn lime wide">Pay with M-Pesa</button><button type="button" id="dpBack" class="btn ghost wide">Back</button><a class="btn ghost wide wa-btn" data-wa="dep" href="https://t.me/Official247Bet" target="_blank" rel="noopener">Deposit help? Chat with 247Bet on Telegram</a></form>';
    depositNote();
    var coolMs = PAY_COOL - Date.now();   /* just left a payment box: the pay button stays locked until the 500ms cooldown ends */
    if (coolMs > 0) { var cb = $("#depForm button[type=submit]"); if (cb) { cb.disabled = true; cb.style.transition = "opacity .25s"; cb.style.opacity = ".55"; setTimeout(function () { var c2 = $("#depForm button[type=submit]"); if (c2) { c2.style.opacity = ""; if (!PAYS) c2.disabled = false; } }, coolMs + 20); } }
    function dpCheck() {
      var el = $("#dpLim"), inp = $("#dpAmt"); if (!el || !inp) return;
      var raw = String(inp.value).replace(/\D/g, ""), v = parseInt(raw, 10) || 0;
      el.textContent = !raw ? "" : v < LIM.dep.min ? "Minimum deposit is KES " + limN(LIM.dep.min) + "." : v > LIM.dep.max ? "Maximum is KES " + limN(LIM.dep.max) + " per transaction. You can deposit again, up to KES " + limN(LIM.dep.day) + " per day." : "";
    }
    $("#dpAmt").addEventListener("input", dpCheck);
    if (!DEMO && S.token) api({ action: "me", token: S.token }).then(function (r) { var e = $("#dpBal"); if (r && r.ok && r.user && S.user) { S.user.balance = r.user.balance; if (e) e.textContent = money(r.user.balance); } }).catch(function () {});
    $$("[data-dq]", b).forEach(function (x) { x.onclick = function () { var cur = parseInt($("#dpAmt").value, 10) || 0; $("#dpAmt").value = cur + Number(x.getAttribute("data-dq")); dpCheck(); }; });
    $("#dpBack").onclick = function () { $("#authTitle").textContent = ""; renderAuth(); };
    $("#depForm").onsubmit = function (e) {
      e.preventDefault();
      var btn = $("#depForm button[type=submit]"), amt = parseInt($("#dpAmt").value, 10);
      if (btn.disabled || DEP_BUSY) return;   /* a second tap or Go key while the first is still opening is ignored */
      if (!(amt >= LIM.dep.min)) { msg("Minimum deposit is KES " + limN(LIM.dep.min) + "."); return; }
      if (amt > LIM.dep.max) { msg("Maximum deposit is KES " + limN(LIM.dep.max) + " per transaction (KES " + limN(LIM.dep.day) + " per day)."); return; }
      DEP_LAST = amt; DEP_BUSY = true; btn.disabled = true; depFreeze(true); msg("Opening secure payment...");
      var slowT = setTimeout(function () { msg("Opening secure payment. Please wait..."); }, 6000);
      function go(tries) {
        api({ action: "deposit", token: S.token, amount: amt }).then(function (r) {
          clearTimeout(slowT);
          if (r.expired) { setSession("", null); renderAuth(); return; }
          if (!r.ok) {
            if (tries < 1 && /could not open the payment page/i.test(r.error || "")) { setTimeout(function () { go(tries + 1); }, 1200); return; }
            DEP_BUSY = false; btn.disabled = false; depFreeze(false); msg(r.error || "Could not start payment."); return;
          }
          DEP_BUSY = false; showPayFrame(r.url, r.ref);
          msg("Complete the payment in the box below. Your balance updates by itself.");
          pollDeposit(r.ref, 0);
        }).catch(function () { clearTimeout(slowT); DEP_BUSY = false; btn.disabled = false; depFreeze(false); msg("Network problem. Try again."); });
      }
      setTimeout(function () { go(0); }, Math.max(0, PAY_COOL - Date.now()));   /* waits out the 500ms cooldown after a closed box, without freezing the page */
    };
  }
  /* ---------- payment session: 3-minute life, clean reset ----------
   * Starts the moment the payment box opens. At zero (or when the player comes back after it has passed) the box is removed
   * completely, only this payment's own temporary key is cleared (never the login or chat), the deposit screen is rebuilt blank,
   * and the server is told so it can close the deposit. A late approval is still credited by the server, so no money is lost. */
  var PAYS = null, PAY_MS = 180000, PAY_KEY = "pay247";
  var DEP_BUSY = false, DEP_LAST = 0;
  function depFreeze(on) { $$("#depForm input, #depForm button").forEach(function (x) { x.disabled = !!on; }); }
  function payKeyGet() { try { return JSON.parse(sessionStorage.getItem(PAY_KEY) || "null"); } catch (e) { return null; } }
  function payKeyDel() { try { sessionStorage.removeItem(PAY_KEY); } catch (e) {} }
  function payClockTxt(ms) { var t = Math.max(0, Math.ceil(ms / 1000)), m = Math.floor(t / 60), x = t % 60; return "Time left " + m + ":" + (x < 10 ? "0" : "") + x; }
  function payStart(ref) {
    payStop();
    PAYS = { ref: ref, t0: Date.now(), tm: 0 };
    try { sessionStorage.setItem(PAY_KEY, JSON.stringify({ ref: ref, t0: PAYS.t0 })); } catch (e) {}
    PAYS.tm = setInterval(payTick, 1000); payTick();
  }
  function payStop() { if (PAYS && PAYS.tm) clearInterval(PAYS.tm); PAYS = null; payKeyDel(); }
  var PAY_COOL = 0;   /* a payment box that was just closed cannot be re-opened for 500ms, so the old frame is fully gone first */
  function payKill() {   /* cut the gateway connection in this window and remove the box */
    PAY_COOL = Date.now() + 500;
    $$("#payBox iframe, #authBody iframe").forEach(function (f) { try { f.src = "about:blank"; } catch (e) {} if (f.parentNode) f.parentNode.removeChild(f); });
  }
  function payTick() {
    if (!PAYS) return;
    var left = PAYS.t0 + PAY_MS - Date.now(), c = $("#payClock");
    if (c) c.textContent = payClockTxt(left);
    if (left <= 0) payEnd("expired");
  }
  function payEnd(why) {
    if (!PAYS) return;
    var ref = PAYS.ref, shown = !!$("#payBox");
    payStop(); payKill();
    if (why === "expired" && S.token) api({ action: "depositExpire", token: S.token, ref: ref }).then(function (r) { if (r && r.ok && r.status === "success") { S.user.balance = r.balance; renderAcct(); toast("Deposit received."); } }).catch(function () {});
    if (shown) {
      renderDeposit();
      msg(why === "failed" ? "Payment was not completed. Please start afresh." : "Payment Session Expired. Please start afresh.");
      toast(why === "failed" ? "Payment was not completed." : "Payment session expired.");
      depRetryCard(DEP_LAST);
    }
  }
  function paySweep() {   /* a session left from a page that was reloaded or closed: tell the server, then forget it */
    if (PAYS) return;
    var k = payKeyGet(); if (!k) return;
    payKeyDel();
    if (k.ref && S.token) api({ action: "depositExpire", token: S.token, ref: k.ref }).catch(function () {});
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) payTick(); });
  window.addEventListener("pageshow", function () { payTick(); });
  window.addEventListener("focus", function () { payTick(); });
  function payFreshUrl(url) {   /* every opening gets a one-off address, so nothing saved from an earlier box can be reused */
    var u = String(url), x = u.indexOf("#"), h = x > -1 ? u.slice(x) : ""; if (x > -1) u = u.slice(0, x);
    return u + (u.indexOf("?") > -1 ? "&" : "?") + "cb=" + Date.now() + "&nonce=" + Math.random().toString(36).slice(2, 10) + h;
  }
  function payMakeFrame(url) {   /* a brand-new, empty frame every time; "credentialless" gives it its own blank cookie/storage space (Chrome, Edge, Opera; other browsers ignore it) */
    var f = document.createElement("iframe");
    f.title = "M-Pesa payment"; f.setAttribute("allow", "payment"); f.setAttribute("autocomplete", "off");
    f.setAttribute("credentialless", ""); try { f.credentialless = true; } catch (e) {}
    f.src = payFreshUrl(url);
    return f;
  }
  function showPayFrame(url, ref) {
    if (!/^https:\/\/pay\.paynecta\.co\.ke\//.test(String(url))) return;
    payKill();
    $("#authDlg").classList.add("payview");
    $("#authBody").innerHTML = '<div id="payBox" class="pbox"></div><p id="payClock" class="mt" role="timer" aria-live="off" style="text-align:center;font-weight:700;margin:6px 0">' + payClockTxt(PAY_MS) + '</p><p id="aerr" class="aerr" role="status"></p><p class="mt"><a href="' + esc(url) + '" target="_blank" rel="noopener">Payment box not showing? Open it in a new tab.</a></p><button type="button" id="dpBack2" class="btn ghost wide">Back</button><a class="wa-sm" data-wa="pay" data-ref="' + esc(String(ref || "")) + '" href="https://t.me/Official247Bet" target="_blank" rel="noopener">Payment problem? Chat with 247Bet on Telegram</a>';
    $("#payBox").appendChild(payMakeFrame(url));
    $("#dpBack2").onclick = function () { payKill(); $("#authDlg").classList.remove("payview"); $("#authTitle").textContent = ""; renderAuth(); };
    if (ref) payStart(String(ref));
  }
  function pollDeposit(ref, n) {
    if (!PAYS || PAYS.ref !== ref) return;   /* the session ended (expired, paid or replaced): stop asking */
    api({ action: "depositStatus", token: S.token, ref: ref }).then(function (r) {
      if (!PAYS || PAYS.ref !== ref) return;
      if (r.ok && r.status === "success") { payStop(); payKill(); S.user.balance = r.balance; renderAcct(); $("#authDlg").classList.remove("payview"); $("#authTitle").textContent = ""; renderAuth(); toast("Deposit received."); return; }
      if (r.ok && r.status === "review") { payStop(); msg("We received your payment. It is being checked and will show in your balance shortly."); return; }
      if (r.ok && r.status === "failed") { payEnd("failed"); return; }
      if (r.ok && r.status === "expired") { payEnd("server"); return; }
      if (n < 60) setTimeout(function () { pollDeposit(ref, n + 1); }, 3000);
    }).catch(function () { if (n < 60) setTimeout(function () { pollDeposit(ref, n + 1); }, 4000); });
  }

  /* ---------- deposit link (?deposit or ?deposit=AMOUNT) and one-tap retry ----------
   * The link only shows a prompt on the player's own account. Nothing is charged and no payment session is opened until the player
   * taps Pay, and every tap goes through the normal deposit form (limits, cooldown, a brand-new session). */
  var DEPGO = false, DEP_PEND = null;
  function depAmtClamp(v) {
    var n = parseInt(String(v == null ? "" : v).replace(/\D/g, ""), 10);
    if (!(n > 0)) return 0;
    return Math.min(LIM.dep.max, Math.max(LIM.dep.min, n));
  }
  function depOpenWin() {   /* the Deposit window, built directly (openAuth would re-draw the account over a payment box) */
    acPar = "home"; acTab = "dep"; authTab = "login"; authNote = "";
    var d = $("#authDlg"); renderAuth();
    if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else d.setAttribute("open", "");
    renderDeposit();
  }
  function depInboxBtn(body) {
    var x = String(body || "").match(/KES\s*([\d,]+)/), a = x ? depAmtClamp(x[1].replace(/,/g, "")) : 0;
    return '<button type="button" class="btn lime" data-dretry="' + a + '" style="margin:6px 0">' + (a ? "Try again KES " + limN(a) : "Deposit now") + "</button>";
  }
  function depGo(amt) {   /* fills the deposit form and presses Pay, so a new session opens at once */
    if (!S.user || !S.token) { openAuth("login"); return; }
    if (!$("#authDlg").open || !$("#depForm")) depOpenWin();
    var i = $("#dpAmt"), a = depAmtClamp(amt); if (!i) return;
    if (!a) { try { i.focus(); } catch (e) {} return; }
    i.value = a; i.dispatchEvent(new Event("input"));
    var tries = 0;
    (function fire() {
      var f = $("#depForm"), b = $("#depForm button[type=submit]"); if (!f) return;
      if (b && b.disabled && !DEP_BUSY && tries++ < 8) { setTimeout(fire, 150); return; }   /* waits out the short cooldown after a closed payment box */
      if (f.onsubmit) f.onsubmit({ preventDefault: function () {} });
    })();
  }
  function depRetryCard(amt) {   /* inside the Deposit window after a payment did not complete */
    var f = $("#depForm"), a = depAmtClamp(amt); if (!f || !a) return;
    var i = $("#dpAmt"); if (i) { i.value = a; i.dispatchEvent(new Event("input")); }
    var c = document.createElement("div"); c.id = "dpRetryCard";
    c.style.cssText = "border:1px solid var(--lime);border-radius:12px;padding:12px;margin:0 0 10px;text-align:center";
    c.innerHTML = "<b>Payment not completed</b><p style=\"margin:4px 0 10px;font-size:calc(13px * var(--ts));opacity:.85\">Start a new one in one tap. If M-Pesa already took the money, it is still added to your balance.</p><button type=\"button\" class=\"btn lime wide\" id=\"dpRetry\">Try again KES " + limN(a) + "</button>";
    f.insertBefore(c, f.firstChild);
    $("#dpRetry").onclick = function () { depGo(a); };
  }
  function depPrompt(amt) {   /* the "Complete your deposit" pop-up opened by a deposit link */
    var old = document.getElementById("depPrompt"); if (old) old.remove();
    var o = document.createElement("div"); o.id = "depPrompt"; o.setAttribute("role", "dialog"); o.setAttribute("aria-modal", "true");
    o.style.cssText = "position:fixed;inset:0;z-index:300;background:rgba(2,11,32,.82);display:flex;align-items:center;justify-content:center;padding:18px";
    o.innerHTML = "<div style=\"max-width:340px;width:100%;background:var(--surf);border:1px solid var(--lime);border-radius:16px;padding:22px 18px;text-align:center;color:var(--text)\"><div style=\"font-size:calc(34px * var(--ts))\">&#128178;</div><h3 style=\"margin:6px 0\">Complete your deposit</h3>" +
      "<p style=\"margin:0 0 6px\">" + (amt ? "Deposit <b>KES " + limN(amt) + "</b> with M-Pesa." : "Deposit with M-Pesa.") + "</p>" +
      "<p style=\"margin:0 0 14px;font-size:calc(13px * var(--ts));opacity:.85\">" + (amt ? "Tap the button to start a fresh, secure payment, then approve it on your phone." : "Tap the button, then choose your amount.") + "</p>" +
      "<button type=\"button\" class=\"btn lime wide\" id=\"dpPrGo\">" + (amt ? "Pay KES " + limN(amt) : "Continue to deposit") + "</button><button type=\"button\" class=\"btn ghost wide\" id=\"dpPrX\" style=\"margin-top:8px\">Not now</button></div>";
    (document.querySelector("dialog[open]") || document.body).appendChild(o);   /* inside an open window, or it would hide behind it */
    o.querySelector("#dpPrGo").onclick = function () { o.remove(); depGo(amt); };
    o.querySelector("#dpPrX").onclick = function () { o.remove(); };
    o.onclick = function (e) { if (e.target === o) o.remove(); };
    try { o.querySelector("#dpPrGo").focus(); } catch (e) {}
  }
  function depLinkEntry() {   /* called once as the splash hides; the ?deposit part is then removed from the address so a refresh does not reopen it */
    var has = false, raw = "";
    try {
      var P = new URLSearchParams(location.search); has = P.has("deposit"); raw = P.get("deposit") || "";
      if (has) { P.delete("deposit"); var qs = P.toString(); history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash); }
    } catch (e) {}
    if (!has || DEMO) return false;
    DEPGO = true;
    var amt = depAmtClamp(raw);
    if (!S.user || !S.token) { DEP_PEND = { amt: amt }; openAuth("login"); authNote = "Log in to complete your deposit."; renderAuth(); return true; }
    depPrompt(amt); return true;
  }
  /* ---------- install shortcuts and ?go= links: ?go=bets | deposit | jackpot ----------
   * The installed app's long-press shortcuts (see manifest.webmanifest) open the site with ?go=... . Logged in: the screen opens at once.
   * Logged out: the Log in window opens with a short note, and the screen opens right after a successful login. */
  var GO_PEND = "";
  var GO_OK = { bets: "bets", mybets: "bets", deposit: "deposit", jackpot: "jackpot", jackpots: "jackpot" };
  function goOpen(w) { if (w === "bets") openBets(); else if (w === "deposit") openAuth("wallet"); else openJackpots(); }
  function goLinkEntry() {   /* called once as the splash hides, after the ?ref and ?deposit links; ?go= is then removed from the address so a refresh does not reopen it */
    var w = "";
    try {
      var P = new URLSearchParams(location.search);
      if (P.has("go")) { w = String(P.get("go") || "").toLowerCase().replace(/[^a-z]/g, ""); P.delete("go"); var qs = P.toString(); history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash); }
    } catch (e) {}
    w = Object.prototype.hasOwnProperty.call(GO_OK, w) ? GO_OK[w] : "";
    if (!w) return false;
    DEPGO = true;   /* opened through a link: no welcome or Saturday pop-up on top of it */
    if (w !== "jackpot" && (!S.user || !S.token)) {
      GO_PEND = w; openAuth("login");
      authNote = w === "bets" ? "Log in to see your bets." : "Log in to make a deposit."; renderAuth(); return true;
    }
    goOpen(w); return true;
  }
  document.addEventListener("click", function (e) {   /* the "Try again" button on a Deposit not completed message in the inbox */
    var b = e.target.closest && e.target.closest("[data-dretry]"); if (!b) return;
    e.preventDefault(); depGo(b.getAttribute("data-dretry"));
  });

  /* ---------- deposit reminder pop-ups on the payment page ----------
   * While a "Deposit not completed" / "Complete your deposit" notice is unresolved (not deleted, no deposit since), the payment page shows the
   * "Complete your deposit" pop-up at most 3 times: when the page is opened, again after 5+ minutes, and once more after 20+ hours.
   * Tapping Pay stops them. The inbox message stays either way. */
  var DN_BUSY = false;
  function depNudgeCheck() {
    if (DEMO || !S.user || !S.token || DN_BUSY || document.getElementById("depPrompt")) return;
    DN_BUSY = true;
    api({ action: "depNudge", token: S.token }).then(function (r) {
      DN_BUSY = false;
      if (!r || !r.ok || !r.nudge || document.getElementById("depPrompt")) return;
      var n = r.nudge, st = store("q247.dn") || {};
      if (st.id !== n.id) st = { id: n.id, n: 0, last: 0 };
      var now = Date.now(), gap = st.n === 0 ? 0 : st.n === 1 ? 300000 : 72000000;
      if (st.n >= 3 || now - st.last < gap) return;
      st.n++; st.last = now; store("q247.dn", st);
      depPrompt(depAmtClamp(n.amt));
      var g = document.getElementById("dpPrGo"); if (g) g.addEventListener("click", function () { st.n = 3; store("q247.dn", st); });
    }).catch(function () { DN_BUSY = false; });
  }
  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-lgmore]")) { var d = $("#lgDlg"); $("#lgQ").value = ""; lgRender(); if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else d.setAttribute("open", ""); return; }
    if (e.target.closest("#lgDlg [data-league]")) closeDlg($("#lgDlg"));
  });
  $("#lgQ").addEventListener("input", lgRender);

  /* ---------- Telegram support: every help button copies a short message (topic and details) and opens the official 247Bet Telegram account ---------- */
  function waAcct() { return S && S.user ? String(S.user.acct || S.user.phone || "") : ""; }
  var WA = { bet: "", wd: null };
  var WA_TABS = { home: "My account", reward: "Rewards", set: "Settings", hist: "Transactions", wd: "Withdrawals", dep: "Deposits", games: "Games (instant wins history)", bonus: "Bonuses and promos", inbox: "Inbox", lim: "Self-exclusion", pw: "Password and login" };
  /* Telegram cannot pre-type a message, so the details are copied to the clipboard first and the customer pastes them in the chat */
  function waHref() { return "https://t.me/" + String(C.TG_USER || "Official247Bet").replace(/[^A-Za-z0-9_]/g, ""); }
  function waText(kind, el) {
    var topic = "General help", ex = [], a = waAcct(), tab = kind === "acct" ? acTab : kind;
    if (kind === "chat") { topic = BOT.topic || "General help"; }
    else if (kind === "dep") { var v = parseInt(($("#dpAmt") || {}).value, 10) || 0; topic = "Deposit"; if (v > 0) ex.push("Amount: KES " + v); }
    else if (kind === "pay") { var r = el && el.getAttribute("data-ref"); topic = "Payment problem"; if (r) ex.push("Ref: " + r); }
    else if (kind === "bets") { topic = "My bets"; if (WA.bet) ex.push("Bet ID: " + WA.bet); }
    else if (kind === "jp") { topic = "Jackpots"; }
    else if (kind === "games") { topic = "Games"; }
    else if (kind === "acct") {
      topic = WA_TABS[tab] || "My account";
      if (tab === "wd") {
        var w = parseInt(($("#wdAmt") || {}).value, 10) || 0; if (w > 0) ex.push("Amount: KES " + w);
        if (WA.wd) ex.push("Latest withdrawal: KES " + WA.wd.amt + " (" + WA.wd.st + ")");
      }
    }
    return "Hello 247Bet, I need help.\nTopic: " + topic + (ex.length ? "\n" + ex.join("\n") : "") + (a ? "\nMy account: " + a : "");
  }
  function waCopy(t) {   // clipboard copy; never blocks opening Telegram, returns true when a copy was made
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).catch(function () {}); return true; }
    } catch (e) {}
    try {
      var x = document.createElement("textarea"); x.value = t; x.setAttribute("readonly", ""); x.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(x); x.select(); x.setSelectionRange(0, t.length);
      var ok = document.execCommand("copy"); document.body.removeChild(x); return !!ok;
    } catch (e2) { return false; }
  }
  /* the account window's Telegram button follows the section being viewed (hidden on log in, and on Deposit which has its own help buttons) */
  function waAcctBar(on) { var x = $("#waAcct"); if (x) x.hidden = !on; }
  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-wa]"); if (!el) return;
    el.href = waHref();
    if (waCopy(waText(el.getAttribute("data-wa"), el))) toast("Your details are copied. Paste them in Telegram.");   /* link still opens right after */
  }, true);
  /* ---------- live chat ---------- */
  var chatT = 0;
  function chatSeen(v) { try { if (v !== undefined) localStorage.setItem("chatSeen", String(v)); return Number(localStorage.getItem("chatSeen")) || 0; } catch (e) { return 0; } }
  var CH = { srv: [], ids: {}, pend: [], nodes: {}, last: "", cv: "", human: false, who: "", busy: false, again: false, n: 0, hsave: 0, hpend: false };
  function chatReset() {   // a different player on this browser starts from a clean chat
    var w = S.user ? String(S.user.phone || S.user.acct || "") : ""; if (CH.who === w) return;
    CH.who = w; CH.srv = []; CH.ids = {}; CH.pend = []; CH.nodes = {}; CH.last = ""; CH.cv = ""; CH.human = false; BOT.topic = "";
    var lg = $("#chatLog"); if (lg) lg.innerHTML = "";
  }
  function cbTime(t) { var d = new Date(t); return isNaN(d) ? "" : d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", timeZone: C.TZ }); }
  function cbHtml(x) {
    var who = x.kind === "me" ? "You" : x.kind === "bot" ? "247 Assistant" : "Support", ag = x.kind === "agent" ? String(x.agent || "").trim() : "";
    if (ag.toLowerCase() === "support") ag = "";
    return esc(x.text) + "<small>" + (ag ? '<span class="ag">' + esc(ag.toUpperCase().slice(0, 4)) + "</span>" : "") + who + " &middot; " + esc(cbTime(x.t)) + (x.sending ? " &middot; sending" : "") + "</small>";
  }
  function chatDup(p) {   // a saved local message that the server list also holds is shown once
    if (!p.savedAt) return false;
    var pt = new Date(p.t).getTime() - 5000;
    for (var i = CH.srv.length - 1; i >= 0; i--) { var x = CH.srv[i]; if (new Date(x.t).getTime() < pt) break; if (x.kind === p.kind && x.text === p.text) return true; }
    return false;
  }
  /* Adds, moves or updates only the bubbles that changed. The log is never wiped and rewritten, so nothing flickers and your scroll position stays put. */
  function chatSync(stick) {
    var lg = $("#chatLog"); if (!lg) return;
    var near = lg.scrollHeight - lg.scrollTop - lg.clientHeight < 60;
    var all = CH.srv.concat(CH.pend.filter(function (p) { return !chatDup(p); }));   // server messages in server order, then what is still being sent (never reordered by the phone's clock)
    var g = lg.querySelector("p.m");
    if (!all.length) { if (!g) { g = document.createElement("p"); g.className = "m"; g.textContent = "Hi " + ((S.user && S.user.name || "").split(" ")[0]) + "! I am the 247Bet assistant. Pick a topic below or type your question."; lg.appendChild(g); } }
    else if (g) g.remove();
    var keep = {};
    all.forEach(function (x, idx) {
      var k = x.id || x.k, el = CH.nodes[k], h = cbHtml(x), cls = "cb " + x.kind + (x.sending ? " pend" : "");
      keep[k] = 1;
      if (!el) { el = document.createElement("div"); CH.nodes[k] = el; }
      if (el._h !== h) { el._h = h; el.innerHTML = h; }
      if (el.className !== cls) el.className = cls;
      if (lg.children[idx] !== el) lg.insertBefore(el, lg.children[idx] || null);
    });
    Object.keys(CH.nodes).forEach(function (k) { if (!keep[k]) { var n = CH.nodes[k]; if (n.parentNode) n.parentNode.removeChild(n); delete CH.nodes[k]; } });
    if (stick || near) lg.scrollTop = lg.scrollHeight;
  }
  function chatAdd(kind, text, sending) {   // shows a bubble at once; the server copy replaces it after it is saved
    var p = { k: "p" + (++CH.n), kind: kind, from: kind === "bot" ? "bot" : "user", text: text, t: new Date().toISOString(), agent: "", sending: !!sending };
    CH.pend.push(p); chatSync(true); return p;
  }
  function chatDrop(ps) { CH.pend = CH.pend.filter(function (p) { return ps.indexOf(p) < 0; }); chatSync(); }
  function chatLoad() {
    if (!S.user) return;
    chatReset();
    if (CH.busy) { CH.again = true; return; }   // one request at a time
    CH.busy = true; CH.again = false;
    var started = Date.now(), req = { action: "chatList", token: S.token };
    if (CH.last) { req.since = CH.last; if (CH.cv) req.cv = CH.cv; }   // only newer messages; the server answers instantly when nothing changed
    api(req).then(function (r) {
      CH.busy = false;
      if (!r || !r.ok) return;
      var added = false, newest = 0;
      (r.items || []).forEach(function (x) { if (!x.id || CH.ids[x.id]) return; CH.ids[x.id] = 1; x.kind = x.kind || (x.from === "bot" ? "bot" : x.from === "admin" ? "agent" : "me"); CH.srv.push(x); added = true; });
      if (added) CH.srv.sort(function (a, b) { return new Date(a.t) - new Date(b.t); });
      CH.srv.forEach(function (x) { var t = new Date(x.t).getTime(); if (String(x.id).charAt(0) !== "L" && t > newest) { newest = t; CH.last = x.t; } });
      if (r.now) CH.cv = r.now;
      var was = CH.human;
      if (typeof r.human === "boolean" && !CH.hpend && started > CH.hsave) CH.human = r.human;   // handed over to a person is decided by the server, not the browser
      CH.pend = CH.pend.filter(function (p) {
        var done = p.savedAt ? p.savedAt < started : !!(p.anchor && p.anchor.savedAt && p.anchor.savedAt < started);
        if (!done) return true;
        if (p.anchor) {   // the assistant's hand-over note is not stored by the server: keep it, right after the request line the server now holds
          var at = null; CH.srv.forEach(function (x) { if (x.kind === "me" && x.text === p.anchor.text) at = x; });
          var t = at ? new Date(new Date(at.t).getTime() + 1).toISOString() : p.t;
          CH.srv.push({ id: "L" + p.k, t: t, from: "bot", kind: "bot", text: p.text }); CH.ids["L" + p.k] = 1; added = true;
        }
        return false;
      });
      if (added) CH.srv.sort(function (a, b) { return new Date(a.t) - new Date(b.t); });
      var d = $("#chatDlg"), open = !!(d && d.open), seen = chatSeen(), bg = $("#chatBadge");
      var un = CH.srv.filter(function (x) { return x.kind !== "me" && new Date(x.t).getTime() > seen; }).length;
      if (open) { if (added) chatSync(); if (newest) chatSeen(newest); un = 0; if (CH.human !== was) botMenu(); }
      if (bg) { bg.hidden = un === 0; bg.textContent = un; }
      if (CH.again) chatLoad();
    }).catch(function () { CH.busy = false; });
  }
  function chatTick() { clearTimeout(chatT); var d = $("#chatDlg"), open = !!(d && d.open); if (!document.hidden) chatLoad(); chatT = setTimeout(chatTick, open ? 3000 : 60000); }   // about every 3 seconds while open, paused while the tab is hidden
  document.addEventListener("visibilitychange", function () { if (!document.hidden) chatTick(); });
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#chatOpen")) return;
    var x = $("#menuDrawer .mx"); if (x) x.click();
    if (!S.user) { openAuth("bet"); return; }
    chatReset(); chatSync(true);
    var d = $("#chatDlg"); if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else d.setAttribute("open", "");
    chatTick(); botMenu(); setTimeout(function () { $("#chatIn").focus(); }, 50);
  });
  $("#chatDlg").addEventListener("close", chatTick);

  /* ---------- automated assistant: answers by topic, hands over to a person when asked ---------- */
  var BOT = { busy: false, miss: 0, topic: "" };
  /* Each topic: t = button name, re = words that point to it (English, Swahili, Sheng), q = [question button, answer, optional words that point to exactly this question] */
  var BKB = [
    { t: "Registration", re: /regist|sign.?up|join|create (an )?account|new account|jisajili|jiunge|akaunti mpya|verify|verification|\b18\b|\bage\b/, q: [
      ["How do I register?", "Tap Sign up, enter your name, your M-Pesa phone number and a password (6 to 10 characters). It is free and you must be 18 or older. You can deposit straight after.", /how.*(regist|sign|join)|jisajili|jiunge/],
      ["I did not get the free bonus", "Every new account gets the free registration bonus, even if other accounts were opened on the same phone or browser. If you did not see it, check your Bonus balance and your inbox. If it is still missing, tap Talk to a human and tell us your account number.", /free.*(bonus|kes)|no bonus|bonus.*(not|did)|zawadi/],
      ["I cannot log in", "Check your phone number and password. If you forgot the password, tap Forgot password on the login screen and send the request; support will give you a temporary password.", /log ?in|sign ?in|cannot enter|nenosiri|password/]] },
    { t: "Deposits", re: /deposit|m-?pesa|top.?up|stk|paybill|add money|\bfund|weka|ongeza pesa|kuweka/, q: [
      ["How do I deposit?", "Open Wallet, tap Deposit, choose M-Pesa, enter the amount and approve the payment on your phone. Your balance updates by itself.", /how.*deposit|how.*(add|put).*money|kuweka/],
      ["Deposit limits", "You can deposit KES {DEPMIN} to KES {DEPMAX} per transaction, up to KES {DEPDAY} per day.", /limit|minimum|maximum|min\b|max\b|how much/],
      ["My deposit has not arrived", "Wait 1 to 2 minutes; the page keeps checking by itself. If M-Pesa took your money and it still has not arrived, tap Talk to a human and send your M-Pesa code.", /not (arrive|reflect|come|show|receive)|missing|delay|haijaingia|pending|taken my/]] },
    { t: "Withdrawals", re: /withdraw|cash.?out|payout|levy|\btax\b|send my money|toa pesa|kutoa|nitoe|pesa yangu/, q: [
      ["How do I withdraw?", "Open Wallet, tap Withdraw, enter the amount (minimum KES {WDMIN}) and submit. Once your withdrawal is processed, the cash arrives in your registered M-Pesa.", /how.*withdraw|kutoa|toa pesa|nitoe/],
      ["Limits and levy", "Minimum KES {WDMIN}. Up to KES {WDMAX} per withdrawal; payouts up to KES {WDHIGH} are sent in several M-Pesa parts. A {WDFEE}% withholding levy is deducted from every withdrawal.", /limit|levy|tax|fee|charge|minimum|maximum|deduct/],
      ["Track my withdrawal", "In Wallet > Withdraw you can follow each step: Submitted, In process, Verified, Sent. A rejected request is returned to your wallet.", /track|status|where|when|how long|delay|not (arrive|received)|haijafika/]] },
    { t: "Bets", re: /\bbet|slip|odds|stake|settle|won\b|lost\b|void|cancel|bet ?id|dau|beti|mechi|ushindi/, q: [
      ["How do I place a bet?", "Tap the odds you want to add them to your bet slip, enter your stake and confirm. Every bet gets its own unique Bet ID.", /how.*(place|make|bet)|place a bet|weka beti/],
      ["Where is my Bet ID?", "Open My bets. The Bet ID is shown at the top of every bet, for example B1A2B3C4D5. Quote it if you contact support.", /bet ?id|id\b|reference|number/],
      ["When is my bet settled?", "Bets are settled automatically after the match ends, usually within minutes. A cancelled or void bet returns your stake.", /settle|result|won|lost|win|lose|void|cancel|paid|when/]] },
    { t: "Bonuses", re: /bonus|boost|welcome|free|promo|saturday|locked|zawadi|bure/, q: [
      ["Welcome bonus", "Make your first deposit and the welcome bonus is added to your bonus balance as one bonus. To play it, pick 5 or more matches with every match at odds of 1.5 or higher, stake KES 100 or more and switch on Use bonus on the bet slip. Tap the bonus anywhere on the site for step-by-step instructions.", /welcome|first deposit|200/],
      ["Free registration bonus", "New accounts can get a free bonus. Stake it on one slip of 5 or more matches, every match at odds of 1.5 or more, within 24 hours. Every new account gets it, and it never locks your withdrawals.", /free|registration bonus|no deposit|bure/],
      ["Multibet boost", "Add picks at 1.5 odds or more to a multibet and we add a percentage boost to your winnings. The more picks, the bigger the boost.", /boost|multibet|accumulator|acca/],
      ["Why can't I withdraw?", "While you have bonus balance, withdrawals stay locked until you use it, it expires, or you forfeit it. Check the Bonuses tab for what is left.", /why.*withdraw|cannot withdraw|can't withdraw|locked|lock/]] },
    { t: "Jackpots and games", re: /jackpot|millionaire|game|instant|save my girl|balloon|aviator|mega|midweek|super/, q: [
      ["How do jackpots work?", "Predict the results of 13 games (Midweek Millionaire, entry KES 20) or 17 games (Super Millionaire, entry KES 50). The top prize is fixed and grows every week until it is won. Bonus prizes are paid for 12, 11 and 10 correct (Midweek) and 16, 15 and 14 correct (Super).", /jackpot|millionaire|predict|how/],
      ["Instant Wins", "Our instant-win games, including Save My Girl, are currently not available in your country. Matches and jackpots are not affected.", /instant|game|save my girl|balloon|aviator|crash|slot/]] },
    { t: "Payment problems", re: /wrong number|wrong (phone|till|paybill)|reversed?|refund|double|twice|charged|stuck|failed|fail|did not go|pesa imekatwa|imekwama/, q: [
      ["I paid but nothing showed", "Wait 1 to 2 minutes first. If it still does not show, tap Talk to a human and send the M-Pesa message (the code, amount and time) and the phone number you used.", /paid|nothing|not show|haikuingia|imekatwa/],
      ["I was charged twice", "Tap Talk to a human and send both M-Pesa messages. We check each payment and credit any amount that was taken twice.", /twice|double|two times|mara mbili/],
      ["I sent to the wrong number", "Payments made to a number that is not ours cannot be traced by us. Contact M-Pesa on 100 or 234 straight away to ask for a reversal. For a payment to our paybill, tap Talk to a human.", /wrong (number|phone|till|paybill)/],
      ["My withdrawal failed", "A failed or rejected withdrawal is returned to your wallet. Open Wallet > Withdraw to see the status. If your balance was not returned, tap Talk to a human with your withdrawal time and amount.", /withdraw.*(fail|reject|stuck)|failed|rejected/]] },
    { t: "Account", re: /password|login|log in|forgot|account|phone number|change number|self.?exclu|close|nenosiri|akaunti/, q: [
      ["Forgot my password", "On the login screen tap Forgot password and send the request. Support will give you a temporary password to change after you log in.", /forgot|reset|lost|nimesahau/],
      ["Change my password", "Open Account > Password, enter your current password and choose a new one (6 to 10 characters).", /change|new password|update/],
      ["Self-exclusion", "Account > Self-exclusion lets you block betting and deposits for 24 hours up to 1 year. Once started it cannot be cut short.", /exclu|break|stop me|block me/]] },
    { t: "Security", re: /secur|safe|scam|fraud|hack|stolen|someone|fake|phish|trust|legit|licen|salama|tapeli/, q: [
      ["Is my money safe?", "Your cash balance is kept in your own wallet and every deposit, bet and withdrawal is recorded in your transactions. We never ask for your password or M-Pesa PIN.", /safe|trust|legit|secure|licen/],
      ["Someone used my account", "Change your password now in Account > Password, then tap Talk to a human so support can check your recent activity. Never share your password, even with someone who says they work for us.", /someone|hack|stolen|not me|used my/],
      ["Spot a fake message or site", "Our messages come only inside this site (Inbox and chat). Our only official Telegram account is @Official247Bet. We never ask for your PIN, password or an M-Pesa code by SMS, WhatsApp or Telegram. Check the web address before you log in.", /fake|scam|phish|fraud|sms|whatsapp|telegram|link/]] },
    { t: "Responsible play", re: /responsible|addict|gambling problem|too much|stop gambling|limit myself|\b18\b|underage|minor|help me stop/, q: [
      ["Limit or stop my betting", "Account > Self-exclusion blocks betting and deposits for 24 hours up to 1 year. Once started it cannot be cut short. Only bet with money you can afford to lose.", /limit|stop|exclu|break|control/],
      ["Get free, confidential help", "If betting is causing you stress, free and confidential advice is available from BeGambleAware (begambleaware.org). You can also tap Talk to a human to speak to our team.", /help|addict|problem|support|worried/],
      ["Age rule", "You must be 18 or older to register and play.", /\bage\b|\b18\b|minor|under ?age/]] },
    { t: "App and website", re: /\bapp\b|install|apk|download|\bslow\b|loading|blank|refresh|\bdark\b|\blight\b|theme|\bmode\b|screen|data bundle|website|\bsite\b/, q: [
      ["Install the app", "Open the menu and tap Install APK. On Android Chrome your phone asks to install and the 247Bet icon appears on your home screen. On iPhone use Share > Add to Home Screen in Safari.", /install|apk|app|download|home screen/],
      ["The site is slow or not loading", "Check your internet or data bundle, then open the menu and refresh the page. If it still fails, close the browser fully and open the site again.", /slow|loading|not loading|blank|stuck|refresh|error/],
      ["Dark or light screen", "Open the menu and choose Dark, Light or Auto under Theme. Auto follows your phone setting.", /\bdark\b|\blight\b|theme|bright|\bmode\b|screen colou?r/]] },
    { t: "Affiliate", re: /affiliate|partner|referral|refer|commission|invite|earn/, q: [
      ["How do I join?", "Open Affiliate from the menu, tell us about your channel and apply. We review every application and set your terms.", /join|apply|become|start/],
      ["What can I earn?", "Approved affiliates earn a revenue share of at least 25%, growing with time and active players up to a maximum of 45%, on the net revenue of the players they refer (or CPA), plus 5% of the affiliates they recruit. Earnings are paid automatically every Tuesday into your 247Bet player wallet.", /earn|commission|rate|percent|%|how much/],
      ["How do I get paid?", "Earnings are paid automatically every Tuesday into your 247Bet wallet after we approve them. Minimum payout is KES 1,500 (25% rate), 2,500 (35%) or 3,500 (45%), with at least 3 / 6 / 10 referred players active in the last 7 days. Smaller or held amounts roll over to the next Tuesday.", /paid|payout|payment|tuesday|when/]] },
    { t: "Complaints", re: /complain|complaint|unhappy|angry|dispute|unfair|wrong decision|appeal|report a problem|malalamiko/, q: [
      ["How do I complain?", "Tap Talk to a human and explain what went wrong, with any Bet ID or M-Pesa code. You can also read the complaints procedure in the Terms.", /complain|unhappy|angry|report|malalamiko/],
      ["I disagree with a bet result", "Bets are settled from the official match result. Tap Talk to a human with the Bet ID and we will check it.", /result|settle|wrong|dispute|disagree|unfair|appeal/]] }
  ];
  var BOT_HI = /^(hi+|hello+|hey+|hallo|good (morning|afternoon|evening)|mambo|sasa|niaje|vipi|habari|hujambo|jambo)\b/, BOT_THX = /^(thanks?|thank you|asante|shukran|ok(ay)?|cool|great|nice|sawa)\b/;
  function botIntro(tp) { return tp.t + ": here is what I can help with. " + tp.q.map(function (x) { return x[0]; }).join(" | ") + ". Tap one below, or type your question."; }
  function botScore(low, q) { var sc = q[2] && q[2].test(low) ? 3 : 0; q[0].toLowerCase().split(/\W+/).forEach(function (w) { if (w.length > 3 && low.indexOf(w) > -1) sc++; }); return sc; }
  function botSay(q, a) {
    a = limFill(a);
    var pq = chatAdd("me", q), pa = chatAdd("bot", a);   // shown instantly, saved in the background
    api({ action: "chatBot", token: S.token, q: q, a: a }).then(function (r) { if (r && r.ok) pq.savedAt = pa.savedAt = Date.now(); }).catch(function () {});
  }
  function botMenu() {
    var box = $("#chatQuick"); if (!box) return;
    var tp = BOT.topic ? BKB.filter(function (x) { return x.t === BOT.topic; })[0] : null;
    var note = CH.human ? '<p class="m" style="margin:4px 0 6px;text-align:center;width:100%">Customer care has been notified and a person will reply here. While you wait, tap a topic or ask me.</p>' : "";
    box.innerHTML = note + (tp ? tp.q.map(function (x, i) { return '<button type="button" data-bq="' + i + '">' + esc(x[0]) + "</button>"; }).join("") + '<button type="button" data-bt="">&lsaquo; Topics</button>' : BKB.map(function (x) { return '<button type="button" data-bt="' + esc(x.t) + '">' + esc(x.t) + "</button>"; }).join("")) + (CH.human ? "" : '<button type="button" class="hum" data-bh="1">Talk to a human</button>');
  }
  /* quiet = a person is already handling this chat: answer only when sure, as an extra, and never say "I did not get that" */
  function botReplyOnly(a) {   // the player's own message is already saved as a message to support; save just the assistant's answer
    a = limFill(a); var pa = chatAdd("bot", a);
    api({ action: "chatBot", token: S.token, noq: 1, q: "-", a: a }).then(function (r) { if (r && r.ok) pa.savedAt = Date.now(); }).catch(function () {});
  }
  function botAsk(txt, quiet) {
    var low = txt.toLowerCase().trim(), best = null, bs = 0, tpHit = null;
    if (BOT_HI.test(low) && low.length < 30) { if (quiet) return; BOT.topic = ""; botSay(txt, "Hello! I am the 247Bet assistant. Pick a topic below or type your question."); botMenu(); return; }
    if (BOT_THX.test(low) && low.length < 30) { if (quiet) return; botSay(txt, "You are welcome! Anything else I can help with?"); botMenu(); return; }
    BKB.forEach(function (tp) { var hit = tp.re.test(low); if (hit && !tpHit) tpHit = tp; tp.q.forEach(function (q) { var sc = botScore(low, q) + (hit ? 1 : 0); if (sc > bs) { bs = sc; best = { tp: tp, q: q }; } }); });
    if (best && bs >= (quiet ? 4 : 3)) { BOT.miss = 0; BOT.topic = best.tp.t; if (quiet) botReplyOnly("While you wait for a person: " + best.q[1]); else botSay(txt, best.q[1]); botMenu(); return; }
    if (tpHit) { if (quiet) return; BOT.miss = 0; BOT.topic = tpHit.t; botSay(txt, botIntro(tpHit)); botMenu(); return; }
    if (quiet) return;
    BOT.miss++; BOT.topic = "";
    botSay(txt, BOT.miss >= 2 ? "I am sorry, I could not find an answer for that. Tap Talk to a human and our customer care team will take over." : "I did not quite get that. Pick one of the topics below, or ask in a few different words.");
    botMenu();
  }
  function botHuman() {
    if (CH.hpend) return;
    var t = BOT.topic || "General", prev = CH.human, pu = chatAdd("me", "You asked to talk to a person (" + t + ")"),
      pb = chatAdd("bot", "Done. Our customer care team has been notified. Type your message below and a person will reply here as soon as possible.");
    pb.anchor = pu; CH.human = true; CH.hpend = true; botMenu();
    function undo(msg) { CH.hpend = false; CH.human = prev; chatDrop([pu, pb]); botMenu(); toast(msg); }
    api({ action: "chatHuman", token: S.token, topic: t }).then(function (r) {
      if (r.expired) { CH.hpend = false; chatDrop([pu, pb]); closeDlg($("#chatDlg")); setSession("", null); openAuth("bet"); return; }
      if (!r.ok) { undo(r.error || "Could not reach support."); return; }
      CH.hpend = false; CH.hsave = Date.now(); if (r.already) chatDrop([pu, pb]); else pu.savedAt = CH.hsave;
      chatLoad();
    }).catch(function () { undo("Network problem. Try again."); });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("#chatQuick button"); if (!b) return;
    if (b.hasAttribute("data-bh")) return botHuman();
    if (b.hasAttribute("data-bt")) {
      var tn = b.getAttribute("data-bt"), tpx = BKB.filter(function (x) { return x.t === tn; })[0];
      BOT.topic = tn; if (tpx) botSay(tn, botIntro(tpx)); botMenu(); return;   // every topic tap now gets a visible reply
    }
    var tp = BKB.filter(function (x) { return x.t === BOT.topic; })[0], q = tp && tp.q[Number(b.getAttribute("data-bq"))]; if (q) { botSay(q[0], q[1]); }
  });
  $("#chatF").onsubmit = function (e) {
    e.preventDefault();
    var i = $("#chatIn"), t = i.value.trim(); if (!t) return;
    if (!CH.human) { i.value = ""; botAsk(t); return; }
    i.value = ""; var pm = chatAdd("me", t, true);   // appears at once, marked "sending" until the server confirms
    api({ action: "chatSend", token: S.token, text: t }).then(function (r) {
      if (r.expired) { chatDrop([pm]); closeDlg($("#chatDlg")); setSession("", null); openAuth("bet"); return; }
      if (!r.ok) { chatDrop([pm]); toast(r.error || "Could not send."); i.value = t; return; }
      pm.sending = false; pm.savedAt = Date.now(); chatSync(); chatLoad();
      botAsk(t, true);   // while waiting, the assistant still answers what it can
    }).catch(function () { chatDrop([pm]); i.value = t; toast("Network problem. Try again."); });
  };
  setTimeout(chatTick, 3000);

  /* ---------- my bets ---------- */
  var MB = { tab: "bets", status: "all", bets: [], jps: [], hb: [], hj: [], hid: false, sel: false, pick: {}, ask: false };
  var ST_LABEL = { open: "Active", won: "Won", lost: "Lost", void: "Cancelled", cancelled: "Cancelled" };
  function stKey(x) { x = String(x || "").toLowerCase(); return x === "void" ? "cancelled" : x; }
  function stLabel(x) { return ST_LABEL[String(x || "").toLowerCase()] || (x ? String(x).charAt(0).toUpperCase() + String(x).slice(1) : ""); }
  function stFilterKey(x) { x = stKey(x); return x === "open" ? "active" : x; }
  function openBets(tab) {
    if (!S.user) { openAuth("bet"); return; }
    var d = $("#betsDlg"), body = $("#betsBody");
    MB.tab = tab === "jps" ? "jps" : "bets"; MB.status = "all"; MB.hid = false; MB.sel = false; MB.pick = {}; MB.ask = false; betsView(false);
    body.innerHTML = "<p><span class=skl></span><span class=skl2></span><span class=skl3></span></p>";
    if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else d.setAttribute("open", "");
    Promise.all([api({ action: "myBets", token: S.token }), api({ action: "myJackpots", token: S.token })]).then(function (rs) {
      var a = rs[0], b = rs[1];
      if ((a && a.expired) || (b && b.expired)) { closeDlg(d); setSession("", null); openAuth("bet"); return; }
      if (!a.ok) { body.innerHTML = "<p>" + esc(a.error || "Could not load bets.") + "</p>"; return; }
      MB.bets = a.bets || []; MB.hb = a.hiddenBets || []; MB.jps = b && b.ok ? (b.entries || []) : []; MB.hj = b && b.ok ? (b.hiddenEntries || []) : [];
      renderMyBets();
    }).catch(function () { body.innerHTML = "<p>Network problem. Try again.</p>"; });
  }
  function renderMyBets() {
    var body = $("#betsBody"), list = mbList();
    var present = {}; list.forEach(function (x) { present[stFilterKey(x.status)] = 1; });
    var order = ["active", "won", "lost", "cancelled"], opts = order.filter(function (k) { return present[k]; });
    Object.keys(present).forEach(function (k) { if (order.indexOf(k) < 0) opts.push(k); });
    if (MB.status !== "all" && !present[MB.status]) MB.status = "all";
    var shown = list.filter(function (x) { return MB.status === "all" || stFilterKey(x.status) === MB.status; });
    var h = '<div class="mb-tabs" role="tablist"><button type="button" data-mbt="bets" aria-pressed="' + (MB.tab === "bets") + '">Bets (' + MB.bets.length + ')</button><button type="button" data-mbt="jps" aria-pressed="' + (MB.tab === "jps") + '">Jackpots (' + MB.jps.length + ')</button></div>';
    h += mbBar();
    h += '<label class="mb-filter">bet status <select id="mbStatus" aria-label="Bet status"><option value="all">all</option>' + opts.map(function (k) { return '<option value="' + esc(k) + '"' + (MB.status === k ? " selected" : "") + ">" + esc(stLabel(k === "active" ? "open" : k).toLowerCase()) + "</option>"; }).join("") + "</select></label>";
    if (!list.length) h += '<p class="mb-empty">' + (MB.tab === "bets" ? "No bets yet. Tap any odds to start a slip." : "No jackpot entries yet. Open Jackpots to place your first one.") + "</p>";
    else if (!shown.length) h += '<p class="mb-empty">Nothing with this status.</p>';
    else { MB.shown = shown; h += shown.map(function (x) { var c = (MB.tab === "bets" ? betCard : jpCard)(x); return MB.sel ? mbRow(x, c) : c; }).join(""); }
    if (MB.sel) h += mbAct();
    body.innerHTML = h;
    $$("[data-bi]", body).forEach(function (b) { b.onclick = function () { openBetDetail(Number(b.getAttribute("data-bi"))); }; });
    $$("[data-ji]", body).forEach(function (b) { b.onclick = function () { openJpDetail(Number(b.getAttribute("data-ji"))); }; });
    mbWire(body);
    $$("[data-mbt]", body).forEach(function (b) { b.onclick = function () { MB.tab = b.getAttribute("data-mbt"); MB.status = "all"; MB.pick = {}; MB.ask = false; renderMyBets(); }; });
    var sel = $("#mbStatus"); if (sel) sel.onchange = function () { MB.status = sel.value; renderMyBets(); };
  }
  /* ---- hide / delete from the player's own list (records stay on file; only settled bets can be chosen) ---- */
  function mbList() { return MB.tab === "bets" ? (MB.hid ? MB.hb : MB.bets) : (MB.hid ? MB.hj : MB.jps); }
  function mbAt(arr, hidArr, i) { return i < arr.length ? arr[i] : hidArr[i - arr.length]; }
  function mbId(x) { return String(x.id); }
  function mbSettled(x) { return stKey(x.status) !== "open"; }
  function mbBar() {
    var hn = MB.tab === "bets" ? MB.hb.length : MB.hj.length, any = MB.tab === "bets" ? MB.bets.length + MB.hb.length : MB.jps.length + MB.hj.length;
    if (!any) return "";
    return '<div class="mbx-tools"><button type="button" class="mbx-btn' + (MB.sel ? " on" : "") + '" data-mbx="sel">' + (MB.sel ? "Done" : "Select") + '</button><button type="button" class="mbx-btn' + (MB.hid ? " on" : "") + '" data-mbx="hid">Hidden (' + hn + ')</button></div>' + (MB.hid ? '<p class="mbx-note">Hidden bets are kept out of your main list. Select them and tap Unhide to bring them back.</p>' : "") + (MB.sel ? '<p class="mbx-note">Active bets are locked <span aria-hidden="true">&#128274;</span> until they are settled.</p>' : "");
  }
  function mbRow(x, card) {
    var ok = mbSettled(x), on = !!MB.pick[mbId(x)];
    return '<div class="mbx-row' + (on ? " on" : "") + (ok ? "" : " lock") + '"><span class="mbx-ck" aria-hidden="true">' + (ok ? (on ? "&#10003;" : "") : "&#128274;") + "</span>" + card + (ok ? '<button type="button" class="mbx-ov" data-mbp="' + esc(mbId(x)) + '" aria-pressed="' + on + '" aria-label="Select ' + esc(mbId(x)) + '"></button>' : "") + "</div>";
  }
  function mbAct() {
    var n = Object.keys(MB.pick).length, word = MB.tab === "bets" ? (n === 1 ? "bet" : "bets") : (n === 1 ? "entry" : "entries");
    if (MB.ask) return '<div class="mbx-act ask" role="alertdialog"><p>Delete ' + n + " " + word + ' from your list for good? You will not be able to bring ' + (n === 1 ? "it" : "them") + ' back.</p><div><button type="button" class="mbx-b" data-mbx="no">Cancel</button><button type="button" class="mbx-b del" data-mbx="yes">Yes, delete</button></div></div>';
    return '<div class="mbx-act"><p>' + (n ? n + " selected" : "Tap bets to select them") + '</p><div><button type="button" class="mbx-b" data-mbx="all">Select all settled</button>' + (MB.hid ? '<button type="button" class="mbx-b" data-mbx="unhide"' + (n ? "" : " disabled") + ">Unhide</button>" : '<button type="button" class="mbx-b" data-mbx="hide"' + (n ? "" : " disabled") + ">Hide</button>") + '<button type="button" class="mbx-b del" data-mbx="del"' + (n ? "" : " disabled") + ">Delete</button></div></div>";
  }
  function mbLoad(done) {
    apiBust(); try { swrClear(); } catch (e) {}
    Promise.all([api({ action: "myBets", token: S.token }), api({ action: "myJackpots", token: S.token })]).then(function (rs) {
      var a = rs[0], b = rs[1];
      if (a && a.ok) { MB.bets = a.bets || []; MB.hb = a.hiddenBets || []; }
      if (b && b.ok) { MB.jps = b.entries || []; MB.hj = b.hiddenEntries || []; }
      done();
    }).catch(function () { done(); });
  }
  /* While My bets is open on the list view, quietly re-check the bets every 25 s and redraw only when a status changed (e.g. an open bet was just settled). Paused when the tab is hidden, while selecting/deleting, or on a bet's detail page. */
  var mbPollBusy = false;
  setInterval(function () {
    var d = $("#betsDlg");
    if (mbPollBusy || !d || !d.open || document.hidden || !S.token || MB.tab !== "bets" || MB.sel || MB.ask || d.classList.contains("in-detail")) return;
    if (!MB.bets.some(function (x) { return stFilterKey(x.status) === "active"; })) return;
    mbPollBusy = true; apiBust();
    api({ action: "myBets", token: S.token }).then(function (a) {
      mbPollBusy = false;
      if (!a || !a.ok || !d.open || d.classList.contains("in-detail") || MB.sel || MB.ask) return;
      var sig = function (l) { return (l || []).map(function (x) { return x.id + ":" + x.status; }).join("|"); };
      if (sig(a.bets) === sig(MB.bets)) return;
      var body = $("#betsBody"), top = body ? body.scrollTop : 0;
      MB.bets = a.bets || []; MB.hb = a.hiddenBets || [];
      renderMyBets(); if (body) body.scrollTop = top;
      toast("Your bets were updated.");
    }).catch(function () { mbPollBusy = false; });
  }, 25000);
  function mbRun(op) {
    var ids = Object.keys(MB.pick); if (!ids.length) return;
    var act = op === "hide" ? "hideBets" : op === "unhide" ? "unhideBets" : "deleteBets", kind = MB.tab === "bets" ? "bet" : "jp";
    $$("#betsBody .mbx-b").forEach(function (b) { b.disabled = true; });
    api({ action: act, token: S.token, kind: kind, ids: ids }).then(function (r) {
      if (r && r.expired) { closeDlg($("#betsDlg")); setSession("", null); openAuth("bet"); return; }
      if (!r || !r.ok) { toast((r && r.error) || "Could not update. Try again."); MB.ask = false; renderMyBets(); return; }
      var n = r.done || 0;
      MB.pick = {}; MB.ask = false; MB.sel = false;
      mbLoad(function () {
        if (MB.hid && !(MB.tab === "bets" ? MB.hb : MB.hj).length) MB.hid = false;
        renderMyBets();
        toast(n ? (op === "hide" ? n + " hidden." : op === "unhide" ? n + " back in your list." : n + " deleted from your list.") : "Nothing changed. Active bets cannot be hidden or deleted.");
      });
    }).catch(function () { toast("Network problem. Try again."); MB.ask = false; renderMyBets(); });
  }
  function mbWire(body) {
    $$("[data-mbx]", body).forEach(function (b) {
      b.onclick = function () {
        var k = b.getAttribute("data-mbx");
        if (k === "sel") { MB.sel = !MB.sel; MB.pick = {}; MB.ask = false; renderMyBets(); }
        else if (k === "hid") { MB.hid = !MB.hid; MB.status = "all"; MB.pick = {}; MB.ask = false; renderMyBets(); }
        else if (k === "all") { mbList().forEach(function (x) { if (mbSettled(x)) MB.pick[mbId(x)] = 1; }); renderMyBets(); }
        else if (k === "hide" || k === "unhide") mbRun(k);
        else if (k === "del") { MB.ask = true; renderMyBets(); }
        else if (k === "no") { MB.ask = false; renderMyBets(); }
        else if (k === "yes") mbRun("delete");
      };
    });
    $$("[data-mbp]", body).forEach(function (b) {
      b.onclick = function () { var id = b.getAttribute("data-mbp"); if (MB.pick[id]) delete MB.pick[id]; else MB.pick[id] = 1; MB.ask = false; var sc = $("#betsBody").scrollTop; renderMyBets(); $("#betsBody").scrollTop = sc; };
    });
  }
  /* ---- bet history: card + detail view (v5) ---- */
  function fmtDT(v) {
    if (!v) return ""; var d = v instanceof Date ? v : new Date(isNaN(v) ? v : Number(v));
    return isNaN(d.getTime()) ? "" : d.toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
  }
  function betWhen(x) { return fmtDT(x.t || x.ts || x.placedAt || x.created || x.time); }
  function betKind(x) { var n = (x.legs || []).length || Number(x.count) || 0; return n > 1 ? "Multibet (" + n + ")" : "Single"; }
  function betCls(x) { var k = stKey(x.status); return k === "open" ? "active" : k === "void" ? "cancelled" : k; }
  function betWin(x) { return stKey(x.status) === "won" ? Number(x.payout != null ? x.payout : x.winnings != null ? x.winnings : x.potential) || 0 : 0; }
  function betPill(x) { var k = betCls(x); return '<span class="bst">' + esc(k === "won" ? "Won" : k === "lost" ? "Lost" : k === "cancelled" ? "Cancelled" : k === "active" ? "Active" : stLabel(x.status)) + "</span>" + (Number(x.bonusStake) > 0 ? '<span class="bst bnb">Bonus bet</span>' : ""); }
  function betCard(x) {
    var k = betCls(x), win = betWin(x), wl = k === "active" ? "To win" : "Winnings", wv = k === "active" ? Number(x.potential) || 0 : win;
    var i = MB.bets.indexOf(x); if (i < 0) i = MB.bets.length + MB.hb.indexOf(x);
    var c = '<button type="button" class="bc s-' + esc(k) + (x.locked ? " lk" : "") + '" data-bi="' + i + '" aria-label="' + (x.locked ? (x.link ? "Place bet " : "Bet ") : "Open bet ") + esc(x.id) + '">' +
      '<div class="bc-top"><span>' + esc(betWhen(x)) + "</span>" + betPill(x) + "</div>" +
      '<div class="bc-id"><b>' + esc(x.id) + "</b><span>" + esc(betKind(x)) + "</span></div>" +
      '<div class="bc-g"><div><small>Odds</small><b>' + odds2(x.odds) + "</b></div><div><small>Stake</small><b>" + esc(money(x.stake)) + '</b></div><div><small>' + wl + '</small><b class="bc-w">' + esc(money(wv)) + "</b></div></div>" +
      (x.locked ? (x.link ? '<div class="bc-ft">&#128274; Tap to place this bet <span aria-hidden="true">&rsaquo;</span></div>' : '<div class="bc-ft off">Not available &middot; match started</div>') : '<span class="bc-more" aria-hidden="true">&rsaquo;</span>') +
      "</button>";
    return c;
  }
  function legRes(g, x) {
    var r = String(g.res || g.r || g.result || g.outcome || "").toLowerCase();
    if (/^(won|win|w)$/.test(r)) return "win";
    if (/^(lost|lose|l)$/.test(r)) return "lose";
    if (/^(void|cancelled|canceled|v)$/.test(r)) return "void";
    var k = betCls(x);
    if (k === "won") return "win"; if (k === "cancelled") return "void"; if (k === "active") return "pend";
    return "";
  }
  function legScore(g) {
    var s = g.score || g.ft || g.fs;
    if (!s && g.hs != null && g.as != null) s = g.hs + " - " + g.as;
    if (!s && g.h != null && g.a != null && typeof g.h !== "string") s = g.h + " - " + g.a;
    return s ? String(s).replace(/\s*[:\-]\s*/, " - ") : "";
  }
  /* ---- bet details: one ticket card (summary, then every event) ---- */
  var TK_ST = {
    win: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor"/><path d="m6 10.3 2.6 2.6L14 7.5" fill="none" stroke="#04122a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    lose: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor"/><path d="M7 7l6 6M13 7l-6 6" fill="none" stroke="#04122a" stroke-width="2" stroke-linecap="round"/></svg>',
    void: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor"/><path d="M6.5 10h7" fill="none" stroke="#04122a" stroke-width="2" stroke-linecap="round"/></svg>',
    pend: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor"/><path d="M10 5.5V10l3 2" fill="none" stroke="#04122a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  function stx(kind, text) { return '<b class="stx ' + kind + '">' + TK_ST[kind] + esc(text) + "</b>"; }
  /* ---------- team logos: the list of ready logos is read once from the logos site; a team without one keeps its initials badge ---------- */
  var LOGO = { base: String(C.LOGOS || ""), map: null, ok: {} };
  function lkey(n) {
    var s = String(n || "").toLowerCase();
    try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    return s.replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(function (w) { return w && w !== "fc" && w !== "afc" && w !== "cf"; }).join(" ");
  }
  function miniLogo(name) {
    var k = lkey(name); if (!k) return "";
    var f = LOGO.map && LOGO.map[k];
    if (f && LOGO.ok[f]) return '<i class="lgo on" data-lg="1"><img alt="" src="' + esc(LOGO.base + f) + '" width="40" height="40" loading="lazy" decoding="async" onerror="this.parentNode.className=\'lgo\';this.remove()"></i>';
    return '<i class="lgo" data-lk="' + esc(k) + '" aria-hidden="true"></i>';
  }
  function applyLogos(root) {
    if (!LOGO.map || !LOGO.base) return;
    var list = (root || document).querySelectorAll("[data-lk]:not([data-lg])");
    for (var i = 0; i < list.length; i++) {
      var el = list[i], f = LOGO.map[el.getAttribute("data-lk")]; el.setAttribute("data-lg", "1"); if (!f) continue;
      var im = document.createElement("img"); im.alt = ""; im.width = 40; im.height = 40;
      (function (el, im, f) { im.onerror = function () { if (im.parentNode) im.parentNode.removeChild(im); el.classList.remove("on"); }; im.onload = function () { LOGO.ok[f] = 1; el.classList.add("on"); }; })(el, im, f);
      im.src = LOGO.base + f; el.appendChild(im);
    }
  }
  function logoLoad() {
    if (!LOGO.base) return;
    var stale = true, t = 0;
    try { var c = JSON.parse(localStorage.getItem("q247.logos") || "null"); if (c && c.m) { LOGO.map = c.m; stale = Date.now() - c.t > 6 * 3600000; } } catch (e) {}
    new MutationObserver(function () { if (t) return; t = requestAnimationFrame(function () { t = 0; applyLogos(document.body); }); }).observe(document.body, { childList: true, subtree: true });
    applyLogos(document.body);
    if (!stale) return;
    fetch(LOGO.base + "teams.json").then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (j && j.t) { LOGO.map = j.t; try { localStorage.setItem("q247.logos", JSON.stringify({ t: Date.now(), m: j.t })); } catch (e) {} applyLogos(document.body); }
    }).catch(function () {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", logoLoad); else logoLoad();
  function crest(name) {
    name = String(name || "?"); var w = name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/), h = 0, i;
    var t = ((w[0] || "?").charAt(0) + (w[1] ? w[1].charAt(0) : (w[0] || "").charAt(1))).toUpperCase();
    for (i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return '<span class="tk-cr" style="--h:' + h + '" data-lk="' + esc(lkey(name)) + '" aria-hidden="true">' + esc(t) + "</span>";
  }
  function betDetailHtml(x) {
    var k = betCls(x), legs = x.legs || [], prod = 1, okp = legs.length > 0, doneN = 0;
    legs.forEach(function (g) { var p = Number(g.p); if (p > 0) prod *= p; else okp = false; var r = legRes(g, x); if (r !== "pend" && r) doneN++; });
    var stake = Number(x.stake) || 0, pot = Number(x.potential) || 0, boost = Number(x.boost) || 0;
    var shownOdds = Number(x.odds) || (okp ? prod : 0);   /* the stored total odds of the selections, the same figure as in the My bets list; the boost is its own line and winnings = stake x odds + boost */
    var win = k === "won" ? betWin(x) : k === "active" ? Math.max(0, pot - (Number(x.bonusStake) || 0)) : 0;
    var wLbl = k === "active" ? "Possible winnings" : k === "cancelled" ? "Refunded" : "Winnings";
    var wVal = k === "cancelled" ? stake : win;
    var stTxt = k === "won" ? stx("win", "Paid out") : k === "lost" ? stx("lose", "Lost") : k === "cancelled" ? stx("void", "Cancelled") : stx("pend", "Active");
    var settled = k === "active" ? "" : fmtDT(x.settled || x.settledAt || x.st);
    var h = '<div class="tk s-' + esc(k) + '"><div class="tk-top">' +
      '<div class="tk-date">' + esc(betWhen(x)) + "</div>" +
      '<div class="tk-title">' + esc(legs.length > 1 ? "Accumulator" : "Single") + " <small>&#8470; " + esc(x.id) + "</small></div>" +
      '<div class="tk-ne"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14"/></svg>Number of events: ' + legs.length + "</span><b>" + doneN + " of " + legs.length + " completed</b></div>" +
      '<div class="tk-r"><span>Odds:</span><b>' + odds2(shownOdds) + "</b></div>" +
      (boost > 0 ? '<div class="tk-r"><span>Multibet boost' + (x.boostPct ? " (" + esc(x.boostPct) + "%)" : "") + ':</span><b class="up">+' + esc(money(boost)) + "</b></div>" : "") +
      '<div class="tk-r"><span>Stake:</span><b>' + esc(money(stake)) + "</b></div>" +
      '<div class="tk-r"><span>' + wLbl + ':</span><b class="' + (k === "won" ? "up" : "") + '">' + esc(money(wVal)) + "</b></div>" +
      '<div class="tk-r"><span>Status:</span>' + stTxt + "</div>" +
      (settled ? '<div class="tk-r"><span>Settled:</span><b>' + esc(settled) + "</b></div>" : "") + "</div>";
    h += legs.map(function (g) {
      var m = g.mid ? byId(String(g.mid)) : null, mk = g.mk || (/^(1|X|2)$/.test(g.l) ? "1x2" : ""), r = legRes(g, x);
      var ko = g.kickoff || g.t || g.ko || g.kick || (m && m.t) || 0, koTxt = ko ? (isNaN(ko) ? fmtDT(ko) : startFmt(Number(ko))) : "";
      var title = g.title || g.mkName || (mk === "1x2" ? "1X2" : (m && mkt(m, mk) ? mkt(m, mk).title : (SHT[mk] || mk))) || "Market";
      var sm = /(\d+)\s*-\s*(\d+)/.exec(legScore(g)), mid, per = "";
      if (sm) {
        mid = '<span class="tk-sc">' + sm[1] + " : " + sm[2] + "</span>"; per = sm[1] + ":" + sm[2];
        var hm = /(\d+)\s*[:\-]\s*(\d+)/.exec(String(g.ht || g.halftime || ""));
        if (hm && Number(sm[1]) >= Number(hm[1]) && Number(sm[2]) >= Number(hm[2])) per += " (" + hm[1] + ":" + hm[2] + "," + (sm[1] - hm[1]) + ":" + (sm[2] - hm[2]) + ")";
      } else mid = '<span class="tk-sc vs">VS</span>';
      var lst = r === "win" ? stx("win", "Win") : r === "lose" ? stx("lose", "Lose") : r === "void" ? stx("void", "Void") : r === "pend" ? stx("pend", "Pending") : '<b class="stx">-</b>';
      return '<div class="tk-sep"></div><div class="tk-ev">' +
        '<div class="tk-lg"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m12 7.5 3.6 2.6-1.4 4.2H9.8L8.4 10.1z"/></svg><div><b>Football. ' + esc(g.lg || g.league || (m && m.league) || "") + "</b>" + (koTxt ? "<small>" + esc(koTxt) + "</small>" : "") + "</div></div>" +
        '<div class="tk-tm"><span class="tk-n h">' + esc(g.home) + "</span>" + crest(g.home) + mid + crest(g.away) + '<span class="tk-n">' + esc(g.away) + "</span></div>" +
        (per ? '<div class="tk-per">' + esc(per) + "</div>" : '<div class="tk-per">&nbsp;</div>') +
        '<div class="tk-mk"><b>' + esc(title + ". " + pickName(mk, g.l, g.home, g.away)) + '</b><b class="tk-od">' + odds2(g.p) + "</b></div>" +
        '<div class="tk-r"><span>Status:</span>' + lst + "</div></div>";
    }).join("");
    return h + "</div>";
  }
  /* Placement sheet (temporary access): opened by tapping an active bet card. Continue runs pbStart(). */
  function pbSheet(x) {
    var d = $("#pbDlg"), b = $("#pbBody"); if (!d || !b) return;
    var ok = !!x.link, h = '<div class="pb-sum"><div class="pb-r"><b>' + esc(x.id) + "</b><span>" + esc(betKind(x)) + "</span></div>" +
      '<div class="bc-g"><div><small>Odds</small><b>' + odds2(x.odds) + "</b></div><div><small>Stake</small><b>" + esc(kes0(x.stake)) + "</b></div><div><small>To win</small><b class=\"bc-w\">" + esc(kes0(x.potential)) + "</b></div></div></div>";
    if (ok) h += "<p>You&rsquo;re on temporary access, which is view only.</p><p>Log in to your own account to place it. Minimum stake <b>" + esc(kes0(x.stake)) + "</b>, and you can stake more.</p><p>You&rsquo;ll see the picks once you&rsquo;ve placed it.</p>" +
      '<div class="pb-b"><button type="button" class="btn lime wide" id="pbGo">Continue</button><button type="button" class="btn ghost wide" data-close>Cancel</button></div>';
    else h += "<p>A match in this bet has started, so it can&rsquo;t be placed now.</p>" +
      '<div class="pb-b"><button type="button" class="btn ghost wide" data-close>Close</button></div>';
    b.innerHTML = h;
    var go = $("#pbGo"); if (go) go.onclick = function () { go.disabled = true; pbStart(x.link); };
    openDlg(d);
  }
  /* Place this bet (temporary login): ends the temporary session, then opens the locked slip (?slip=CODE). The slip window asks the member to log in or register with their own account, then shows the slip. */
  function pbStart(code) {
    code = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8); if (!code) return;
    var tk = S.token; WD.on = false; clearTimeout(WD.x);
    try { $$("dialog[open]").forEach(function (d) { closeDlg(d); }); } catch (e) {}
    setSession("", null); voSet(false);
    var go = function () { location.href = location.pathname + "?slip=" + code; };
    if (tk) api_raw({ action: "logout", token: tk }).then(go, go); else go();
  }
  function betsView(detail, title) {
    var d = $("#betsDlg"), b = $("#betsBack"), t = $("#betsTitle");
    d.classList.toggle("in-detail", !!detail); if (b) b.hidden = !detail; if (!detail) WA.bet = "";
    if (t) t.textContent = detail ? (title || "Bet details") : "My bets";
  }
  function openBetDetail(i) {
    var x = mbAt(MB.bets, MB.hb, i); if (!x) return;
    if (x.locked) { try { if (!DEMO && S.token && x.id) api_raw({ action: "tmpTap", token: S.token, id: x.id }).catch(function () {}); } catch (e) {} pbSheet(x); return; }
    WA.bet = String(x.id || "");
    var body = $("#betsBody"); MB.scroll = body.scrollTop;
    betsView(true, "Bet details");
    body.innerHTML = betDetailHtml(x); body.scrollTop = 0;
    if (!DEMO && S.token && x.id) { try { api_raw({ action: "betOpened", token: S.token, ids: [x.id] }).catch(function () {}); } catch (e) {} }   // lets the admin see when this bet was last opened
  }
  (function () {
    var bb = $("#betsBody"); if (!bb) return;
    bb.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest("[data-bt],#btAll"); if (!t) return;
      if (t.id === "btAll") { var all = bb.querySelectorAll(".bt-ev"), anyOpen = bb.querySelector(".bt-ev:not(.closed)"); [].forEach.call(all, function (v) { v.classList.toggle("closed", !!anyOpen); var h = v.querySelector(".bt-eh"); if (h) h.setAttribute("aria-expanded", anyOpen ? "false" : "true"); }); return; }
      var ev = t.closest(".bt-ev"); if (!ev) return; var c = ev.classList.toggle("closed"); t.setAttribute("aria-expanded", c ? "false" : "true");
    });
  })();
  (function () {
    var b = $("#betsBack"); if (!b) return;
    b.addEventListener("click", function () { betsView(false); renderMyBets(); $("#betsBody").scrollTop = MB.scroll || 0; });
  })();
  /* ---- jackpot history: same card + detail view as bets ---- */
  var JP_PICK = { "1": "Home", "X": "Draw", "2": "Away", "1X": "Home or draw", "12": "Home or away", "X2": "Draw or away" };
  function jpCls(x) { var k = stKey(x.status); return k === "open" ? "active" : k === "won" ? "won" : k === "lost" ? "lost" : "cancelled"; }
  function jpCard(x) {
    var k = jpCls(x), done = k !== "active", i = MB.jps.indexOf(x), size = x.size || (x.picks || []).length; if (i < 0) i = MB.jps.length + MB.hj.indexOf(x);
    var pl = k === "active" ? "Prize" : "Prize";
    return '<button type="button" class="bc s-' + esc(k) + '" data-ji="' + i + '" aria-label="Open jackpot entry ' + esc(x.id) + '">' +
      '<div class="bc-top"><span>' + esc(fmtDT(x.created)) + "</span>" + betPill(x) + "</div>" +
      '<div class="bc-id"><b>' + esc(x.id) + "</b><span>" + esc(x.name || "Jackpot") + " (" + size + ")</span></div>" +
      '<div class="bc-g"><div><small>Entry fee</small><b>' + esc(money(x.fee)) + "</b></div><div><small>Correct</small><b>" + (done && x.correct !== "" ? esc(x.correct) + "/" + size : "-") + "</b></div><div><small>" + pl + '</small><b class="bc-w">' + (done ? esc(money(x.prize || 0)) : "-") + "</b></div></div>" +
      '<span class="bc-more" aria-hidden="true">&rsaquo;</span></button>';
  }
  function jpDetailHtml(x) {
    var k = jpCls(x), ms = x.matches || [], size = x.size || ms.length, done = k !== "active";
    var h = '<div class="bd-sum s-' + esc(k) + '"><div class="bc-top"><span>' + esc(fmtDT(x.created)) + "</span>" + betPill(x) + '</div><div class="bc-id" style="margin-bottom:0"><b>' + esc(x.id) + "</b><span>" + esc(x.name || "Jackpot") + "</span></div></div>";
    h += ms.map(function (m) {
      var res = String(m.result || ""), badge = m.hit === true ? '<span class="bdg win">&#10003; CORRECT</span>' : m.hit === false ? '<span class="bdg lose">&#10007; WRONG</span>' : '';
      var real = res === "V" ? "Void (counts as correct)" : res ? res + " (" + (JP_PICK[res] || res) + ")" : "Not played yet";
      return '<div class="bd-leg"><div class="bd-lh"><span>' + esc(m.league || "Football") + "</span><span>" + (m.kickoff ? "Kickoff " + esc(fmtDT(m.kickoff)) : "") + "</span></div>" +
        '<div class="bd-tm"><span>' + esc((m.n || "") + ". " + m.home + " v " + m.away) + "</span></div>" +
        '<div class="bd-mk"><div><small>Your pick</small><b>' + esc(m.pick) + (JP_PICK[m.pick] ? " &middot; " + esc(JP_PICK[m.pick]) : "") + (m.double ? ' <span class="bdg dbl">DOUBLE</span>' : "") + "</b></div>" +
        '<div class="bd-o"><small>Result</small><b>' + esc(real) + "</b></div>" + badge + "</div></div>";
    }).join("");
    h += '<div class="bd-tot">' +
      "<div><span>Correct</span><b>" + (done && x.correct !== "" ? esc(x.correct) + " of " + size : x.results ? "Results in, prize being confirmed" : "Waiting for results") + "</b></div>" +
      '<div class="hl"><span>Prize</span><b>' + (done ? esc(money(x.prize || 0)) : "-") + "</b></div>" +
      "<div><span>Entry fee</span><b>" + esc(money(x.fee)) + "</b></div>" +
      "<div><span>Doubles used</span><b>" + (Number(x.doubles) || 0) + "</b></div>" +
      (done && x.closes ? "<div><span>Jackpot closed</span><b>" + esc(fmtDT(x.closes)) + "</b></div>" : "") + "</div>";
    return h;
  }
  function openJpDetail(i) {
    var x = mbAt(MB.jps, MB.hj, i); if (!x) return;
    if (x.locked) { toast("Open jackpot entries cannot be opened on temporary access."); return; }
    var body = $("#betsBody"); MB.scroll = body.scrollTop;
    betsView(true, "Entry " + x.id);
    body.innerHTML = jpDetailHtml(x); body.scrollTop = 0;
  }

  /* ---------- About: policy pages (footer) ---------- */
  var LIC = C.LICENCE || {}, MAIL = C.SUPPORT_EMAIL || "";
  function kes(n) { return "KES " + Number(n).toLocaleString("en-KE"); }
  function httpsUrl(u) { return /^https:\/\//i.test(u || "") ? u : ""; }
  function mailLink(subject, label) {
    return MAIL ? '<a href="mailto:' + esc(MAIL) + "?subject=" + encodeURIComponent(subject) + '">' + esc(label || MAIL) + "</a>" : "";
  }
  function btnLink(key, label) { return '<button type="button" class="flink" data-info="' + key + '">' + label + "</button>"; }

  function renderLicence() {
    var el = $("#licence");
    if (!el || !LIC.operator || !LIC.licenceNo) return;
    var reg = httpsUrl(LIC.regulatorUrl), who = esc(LIC.regulator || "the licensing regulator");
    el.innerHTML = "247Bet is operated by <b>" + esc(LIC.operator) + "</b>" +
      (LIC.regNo ? ", registration no. " + esc(LIC.regNo) : "") +
      (LIC.address ? ", registered office: " + esc(LIC.address) : "") + ". " +
      "Licensed and regulated by " + (reg ? '<a href="' + esc(reg) + '" target="_blank" rel="noopener noreferrer">' + who + "</a>" : who) +
      ", licence number " + esc(LIC.licenceNo) + ".";
    el.hidden = false;
  }

  /* ---------- bonuses ---------- */
  var DEFBOOST = { enabled: true, minOdds: 1.5, maxBoost: 50000, ladder: [[3, 3], [4, 5], [5, 7], [6, 10], [8, 15], [10, 20], [15, 30], [20, 40]] };
  var BOOSTCFG = DEMO ? DEFBOOST : null;   // live site: only on when the server says so, so the page never promises a boost the server will not pay
  var PROMO = { welcome: { pct: 200, min: 100, max: 20000, days: 30, slip: { matches: 5, odds: 1.5, stake: 100 } }, free: { on: true, amount: 50, hours: 24, slip: { matches: 5, odds: 1.5, stake: 50 } }, weekend: { pct: 100, min: 200, max: 20000, days: 7, slip: { matches: 5, odds: 1.5, stake: 100 } } };
  /* ---- device id: one random id per phone browser, kept in four places (page storage, cookie, IndexedDB, Cache storage) so clearing one does not lose it ---- */
  var devMem = "", devFresh = false;
  function devCookieGet() { try { var m = document.cookie.match(/(?:^|;\s*)q247dev=([A-Za-z0-9_-]{16,64})/); return m ? m[1] : ""; } catch (e) { return ""; } }
  function devCookieSet(d) { try { document.cookie = "q247dev=" + d + ";max-age=63072000;path=/;SameSite=Lax" + (location.protocol === "https:" ? ";Secure" : ""); } catch (e) {} }
  function devSave(d, quick) {
    devMem = d; store("q247.dev", d); devCookieSet(d); if (quick) return;
    try { var q = indexedDB.open("q247", 1); q.onupgradeneeded = function () { q.result.createObjectStore("k"); }; q.onsuccess = function () { try { q.result.transaction("k", "readwrite").objectStore("k").put(d, "dev"); } catch (e) {} }; } catch (e) {}
    try { if (window.caches) caches.open("q247-id").then(function (c) { return c.put("/__q247_dev", new Response(d)); }).catch(function () {}); } catch (e) {}
  }
  function idbGet(cb) { try { var q = indexedDB.open("q247", 1); q.onupgradeneeded = function () { q.result.createObjectStore("k"); }; q.onerror = function () { cb(""); }; q.onsuccess = function () { try { var g = q.result.transaction("k").objectStore("k").get("dev"); g.onsuccess = function () { cb(g.result || ""); }; g.onerror = function () { cb(""); }; } catch (e) { cb(""); } }; } catch (e) { cb(""); } }
  function cacheGet(cb) { try { if (!window.caches) return cb(""); caches.open("q247-id").then(function (c) { return c.match("/__q247_dev"); }).then(function (r) { return r ? r.text() : ""; }).then(cb, function () { cb(""); }); } catch (e) { cb(""); } }
  /* what this phone reports at sign-in (shown to the owner in Admin > Logins; no location permission is asked) */
  function loginEnv() {
    try { return { ua: String(navigator.userAgent || "").slice(0, 200), tz: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || "", lang: String(navigator.language || ""), scr: (screen && screen.width ? screen.width + "x" + screen.height : "") }; } catch (e) { return {}; }
  }
  function devId() {
    if (devMem) return devMem;
    var d = store("q247.dev"); if (!d || String(d).length < 16) d = devCookieGet();
    if (!d || String(d).length < 16) {
      var a = new Uint8Array(16); try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256); }
      d = Array.prototype.map.call(a, function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); devFresh = true; devSave(d, true);   // new id: IndexedDB / Cache copies are checked first (devHeal) before it is saved there
    } else devSave(d);
    return d;
  }
  function devHeal() {      // page storage and cookie were empty: if IndexedDB or Cache storage still hold the old id, take it back
    if (!devFresh) return;
    var left = 2, found = "";
    function fin() { if (--left) return; devSave(found && found !== devMem ? found : devMem); devFresh = false; }
    [idbGet, cacheGet].forEach(function (g) { g(function (d) { d = String(d || ""); if (!found && /^[A-Za-z0-9_-]{16,64}$/.test(d)) found = d; fin(); }); });
  }
  devId(); devHeal();
  /* ---- browser fingerprint: screen, graphics chip, time zone, language and a hidden drawing, hashed. Same phone gives the same value even in a private window or after clearing data ---- */
  var FP = "";
  function cyrb53(str, seed) { var h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed; for (var i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909); return 4294967296 * (2097151 & h2) + (h1 >>> 0); }
  function fpId() {
    if (FP) return FP;
    try {
      var sc = window.screen || {}, c = [Math.max(sc.width || 0, sc.height || 0) + "x" + Math.min(sc.width || 0, sc.height || 0), window.devicePixelRatio || 1, sc.colorDepth || 0, navigator.hardwareConcurrency || 0, navigator.deviceMemory || 0, navigator.maxTouchPoints || 0, navigator.platform || "", (navigator.languages || [navigator.language || ""]).join(","), (Intl.DateTimeFormat().resolvedOptions().timeZone || ""), new Date().getTimezoneOffset()];
      try { var cv = document.createElement("canvas"); cv.width = 220; cv.height = 40; var x = cv.getContext("2d"); x.textBaseline = "top"; x.font = "14px Arial"; x.fillStyle = "#f60"; x.fillRect(10, 5, 80, 20); x.fillStyle = "#069"; x.fillText("247Bet fp \u00e9\u00f1\u2603", 4, 8); x.fillStyle = "rgba(102,204,0,.6)"; x.fillText("247Bet fp \u00e9\u00f1\u2603", 6, 12); c.push(cv.toDataURL()); } catch (e) { c.push("nc"); }
      try { var gl = document.createElement("canvas").getContext("webgl"), ex = gl && gl.getExtension("WEBGL_debug_renderer_info"); c.push(ex ? gl.getParameter(ex.UNMASKED_VENDOR_WEBGL) + "|" + gl.getParameter(ex.UNMASKED_RENDERER_WEBGL) : "nogl"); } catch (e) { c.push("nogl"); }
      var j = c.join("||"), pad = function (n) { return ("00000000000000" + n.toString(16)).slice(-14); };
      FP = pad(cyrb53(j, 1)) + pad(cyrb53(j, 2));
    } catch (e) { FP = ""; }
    return FP;
  }
  try { var rq = new URLSearchParams(location.search).get("ref"); if (rq) store("q247.ref", rq.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12)); var cq = new URLSearchParams(location.search).get("c"); if (rq && cq) store("q247.camp", cq.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 20)); } catch (e) {}
  function k0(n) { return Number(n).toLocaleString("en-KE", { maximumFractionDigits: 0 }); }
  var JPTOP = {};   // live top prize of the open (or latest) jackpot of each type, filled by loadJpTops()
  function topTxt(k, from) { return JPTOP[k] > 0 ? "KES " + k0(JPTOP[k]) : "KES " + k0(from) + "+"; }
  function topShort(k, from) { var n = JPTOP[k] > 0 ? JPTOP[k] : from; return (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M"; }
  function loadJpTops() {
    if (DEMO) return;
    api({ action: "jackpots" }).then(function (r) {
      if (!r || !r.ok) return; var t = {};
      (r.jackpots || []).forEach(function (j) { var k = j.type || (j.size >= 14 ? "WKD" : "MID"); if (!t[k] && j.v2 && j.top > 0 && j.status === "open") t[k] = j.top; });
      (r.jackpots || []).forEach(function (j) { var k = j.type || (j.size >= 14 ? "WKD" : "MID"); if (!t[k] && j.v2 && j.top > 0) t[k] = j.top; });
      JPTOP = t; renderPromo(); renderHero();
    }).catch(function () {});
  }
  /* ---------- Saturday bonus: notice from midnight (popup once per Saturday per device + a slim strip all day). The SERVER says whether it is Saturday, so a wrong phone clock cannot show or hide it. ---------- */
  var SAT = { on: false, date: "", ready: false, ui: false, usedBy: "", openFor: "", at: 0 };
  function satUsed() { return !!(S.token && SAT.usedBy === S.token); }
  function satFromServer(p) {
    if (!p || !p.sat) return;
    SAT.on = !!p.sat.on; SAT.date = String(p.sat.date || ""); SAT.ready = true; SAT.at = Date.now();
    satBar(); satTry();
  }
  function satBar() {
    var b = $("#satBar"); if (!b) return;
    var K = PROMO.weekend || { pct: 100, min: 200, max: 20000 };
    if (!SAT.on) { b.className = "sat-bar"; b.innerHTML = ""; return; }
    if (S.user && satUsed()) { b.className = "sat-bar on used"; b.innerHTML = "&#10003; Saturday bonus claimed today. Tap to see how to use it"; return; }
    b.className = "sat-bar on";
    b.innerHTML = "&#127881; SATURDAY BONUS: <b>" + K.pct + "%</b> on your first deposit today (from KES " + k0(K.min) + ", up to KES " + k0(K.max) + ") &rsaquo;";
  }
  function satBody(r) {   /* r = bonusInfo answer for a logged-in player, or null */
    var K = PROMO.weekend, W = PROMO.welcome, sl = K.slip || { matches: 5, odds: 1.5, stake: 100 }, li = !!S.user, h = "", a = "";
    var how = '<button type="button" class="btn ghost" data-how="weekend" data-satclose>How to use it</button>';
    if (!li) {
      h = "<p>Make your first deposit today and get a <b>" + K.pct + "% bonus</b> (from KES " + k0(K.min) + ", up to KES " + k0(K.max) + "). Valid " + K.days + " days.</p><p style=\"font-size:calc(12px * var(--ts))\">New here? Your very first deposit earns the <b>" + W.pct + "% welcome bonus</b> instead.</p>";
      a = '<button type="button" class="btn lime" data-auth="join" data-satclose>Sign up</button><button type="button" class="btn ghost" data-auth="login" data-satclose>Log in</button>' + how;
    } else if (r && r.ok && !r.hasDeposit) {
      h = "<p>Make your first deposit today and get the <b>" + W.pct + "% welcome bonus</b> (from KES " + k0(W.min) + ", up to KES " + k0(W.max) + "). From your next Saturday, your first deposit gets <b>" + K.pct + "%</b>.</p>";
      a = '<button type="button" class="btn lime" data-auth="wallet" data-satclose>Deposit now</button>' + how;
    } else {
      h = "<p>Your <b>first deposit today</b> of KES " + k0(K.min) + " or more gets a <b>" + K.pct + "% bonus</b>, up to KES " + k0(K.max) + ". Valid " + K.days + " days. Use it on " + sl.matches + "+ matches, every match at " + Number(sl.odds).toFixed(2) + "+, minimum stake KES " + k0(sl.stake) + ".</p><p style=\"font-size:calc(12px * var(--ts))\">Offer ends at midnight tonight (East Africa time).</p>";
      a = '<button type="button" class="btn lime" data-auth="wallet" data-satclose>Deposit now</button>' + how;
    }
    $("#satTxt").innerHTML = h; $("#satActs").innerHTML = a;
  }
  function satShow(r) { var d = $("#satDlg"); if (!d || d.open) return; satBody(r); openDlg(d); }
  function satCheckUsed() {   /* quiet check for a logged-in player: has today's Saturday bonus already been taken? (updates the strip only) */
    if (DEMO || !SAT.on || !S.token || SAT.usedBy === S.token || SAT.chk === S.token + SAT.date) return;
    var tk = S.token; SAT.chk = tk + SAT.date;
    api({ action: "bonusInfo", token: tk }).then(function (r) { if (r && r.ok && r.weekendUsed && S.token === tk) { SAT.usedBy = tk; satBar(); } }).catch(function () { SAT.chk = ""; });
  }
  function satTry() {
    if (!SAT.on || !SAT.ready || !SAT.ui || SAT.shown) { satCheckUsed(); return; }
    if (store("q247.sat") === SAT.date) { satCheckUsed(); return; }   // already shown on this Saturday on this device
    if (REFGO || DEPGO || (SHR && SHR.code)) return;                  // opened through a shared link: do not interrupt
    var pd = $("#popDlg");
    if (pd && pd.open) { if (!SAT.wait) { SAT.wait = true; pd.addEventListener("close", function () { SAT.wait = false; setTimeout(satTry, 400); }, { once: true }); } return; }   // the welcome popup goes first
    if (document.querySelector("dialog[open]")) return;
    SAT.shown = true; store("q247.sat", SAT.date);
    if (!S.user || DEMO) { satShow(null); return; }
    api({ action: "bonusInfo", token: S.token }).then(function (r) {
      if (r && r.ok) { if (r.weekendUsed) { SAT.usedBy = S.token; satBar(); return; } satShow(r); }
      else satShow(null);
    }).catch(function () { satShow(null); });
  }
  function satRefresh() {   /* a page left open past midnight: ask the server again */
    if (DEMO || Date.now() - SAT.at < 20 * 60 * 1000) return;
    fetch(C.API_URL + "?action=promo").then(function (r) { return r.json(); }).then(function (p) { if (p && p.ok) { if (p.sat && p.sat.date !== SAT.date) SAT.shown = false; satFromServer(p); } }).catch(function () {});
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) satRefresh(); });
  document.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("[data-satclose]"); if (b) { var d = $("#satDlg"); if (d && d.open) closeDlg(d); } });
  function renderPromo() {
    var W = PROMO.welcome, K = PROMO.weekend, it = [
      "<b>Free KES " + ((PROMO.free || { amount: 50 }).amount) + " bonus</b> when you register. No deposit needed",
      "<b>" + W.pct + "% welcome bonus</b> on your first deposit (up to KES " + k0(W.max) + ")",
      "<b>Saturday bonus " + K.pct + "%</b> on your first deposit every Saturday (up to KES " + k0(K.max) + ")",
      "<b>Midweek Millionaire:</b> pick 13 games, entry KES 20, top prize " + topTxt("MID", 1000000) + ". <b>Super Millionaire:</b> pick 17 games, entry KES 50, top prize " + topTxt("WKD", 5000000),
      "<b>Instant Wins:</b> crash, spinner, slot and instant-win games. Currently not available in your country",
      "Affiliate programme: earn <b>25% growing to 45% revenue share</b>",
      "Sign up today. 18+ only. T&Cs apply"];
    var t = $("#promoTxt"); if (t) t.innerHTML = it.join("<i>|</i>") + "<i>|</i>";
  }
  function loadPromo() {
    renderPromo();
    if (DEMO) { try { SAT.on = new Date().toLocaleDateString("en-US", { timeZone: C.TZ, weekday: "short" }) === "Sat"; SAT.date = new Date().toLocaleDateString("en-CA", { timeZone: C.TZ }); SAT.ready = true; satBar(); satTry(); } catch (e) {} return; }
    loadJpTops();
    fetch(C.API_URL + "?action=promo").then(function (r) { return r.json(); }).then(function (p) { if (p && p.ok) { PROMO = p; limSet(p.limits); BOOSTCFG = (p.boost && p.boost.enabled && Array.isArray(p.boost.ladder)) ? p.boost : null; renderPromo(); renderSlip(); renderHero(); satFromServer(p); } }).catch(function () {});
  }
  function bonusTab(a) {
    a.innerHTML = "<p><span class=skl></span><span class=skl2></span><span class=skl3></span></p>";
    acCall({ action: "bonusInfo", token: S.token }, function (r) {
      var W = PROMO.welcome, K = PROMO.weekend, sl = W.slip, h = "";
      function ruleTxt(q) { return q.matches + "+ matches, every match at odds " + q.odds + " or more, stake KES " + k0(q.stake) + "+"; }
      var ST = { used: "Used up", expired: "Expired", forfeited: "Forfeited", cancelled: "Cancelled", completed: "Released" };
      function badge(t, on) { return '<span class="bb-st"' + (on ? "" : ' style="border-color:var(--mute);color:var(--mute)"') + ">" + esc(t) + "</span>"; }
      function parts(type) {
        var act = r.active.filter(function (x) { return x.type === type; }), old = (r.past || []).filter(function (x) { return x.type === type; });
        return { act: act, old: old, has: act.length + old.length > 0 };
      }
      h += '<div class="bb-sum"><div><small>Cash (withdrawable)</small><b>' + esc(money(r.cash != null ? r.cash : r.balance)) + '</b></div><div><small>Bonus (play only)</small><b>' + esc(money(r.bonusBalance || 0)) + "</b></div></div>";
      h += '<p class="bn-note">Bonus is played on your bet slip: switch on <b>Use bonus</b> when the slip meets the rule. If it wins you get the <b>winnings</b> in cash; if it loses, that stake is used up. Withdrawals stay locked while you have welcome, referral or Saturday bonus balance. The free registration bonus never locks them.</p><button type="button" class="btn ghost wide" data-how="all" style="margin:0 0 10px">How to use your bonus</button>';
      function partCards(list) {
        return list.map(function (x) {
          var q = ruleOf(x.task), left = x.left != null ? x.left : x.amount, used = x.amount ? Math.min(100, Math.round((x.amount - left) / x.amount * 100)) : 0;
          return '<div class="bn-card" data-how="' + esc(x.type) + '" style="margin:8px 0 0"><h4>' + esc(bonusName(x)) + " " + badge("Active", true) + '</h4><b style="color:#ffd166">' + esc(money(left)) + '</b> <small style="display:inline">left of ' + esc(money(x.amount)) + '</small><div class="bn-bar" style="margin-top:6px"><i style="width:' + used + '%"></i></div><small><b>Rule:</b> ' + esc(ruleTxt(q)) + ". Stake KES " + k0(q.stake) + " up to " + esc(money(left).replace(".00", "")) + ". <b>Expires</b> " + esc(new Date(x.expires).toLocaleDateString("en-KE")) + ".</small></div>";
        }).join("");
      }
      function pastLine(list) { return list.length ? "<small>" + list.map(function (x) { return esc(bonusName(x)) + " " + esc(money(x.amount).replace(".00", "")) + ": " + esc(ST[x.status] || x.status); }).join(" &middot; ") + "</small>" : ""; }
      /* 1. Welcome bonus */
      var wp = parts("welcome"), wst = wp.act.length ? "Active" : wp.has ? "Received" : !r.hasDeposit ? "Waiting for deposit" : "Not available";
      var fz = parts("free"), FZ = PROMO.free || { amount: 50, hours: 24 };
      if (fz.has) h += '<div class="bn-card" data-how="free"><h4>Free registration bonus ' + badge(fz.act.length ? "Active" : "Ended", fz.act.length > 0) + "</h4><small>KES " + k0(FZ.amount) + " free for new players, valid " + FZ.hours + " hours. Stake all of it on one slip. If it wins, the KES " + k0(FZ.amount) + " is deducted and you keep the winnings. It never locks withdrawals.</small>" + partCards(fz.act) + pastLine(fz.old) + '<span class="how-l">How to use this bonus &rsaquo;</span></div>';
      h += '<div class="bn-card" data-how="welcome"><h4>1. Welcome bonus ' + badge(wst, wp.act.length > 0 || !r.hasDeposit) + "</h4><small><b>" + W.pct + "%</b> on your first deposit, from KES " + k0(W.min) + " (up to KES " + k0(W.max) + "). One part, valid " + W.days + " days.<br><b>Rule:</b> " + esc(ruleTxt(sl)) + ".<br>First deposit only, one per M-Pesa number.</small>" + partCards(wp.act) + pastLine(wp.old) + '<span class="how-l">How to use this bonus &rsaquo;</span></div>';
      /* 2. Saturday bonus */
      var sp = parts("weekend"), sst = sp.act.length ? "Active" : r.weekendOpen ? "Open today" : !r.hasDeposit ? "After first deposit" : "Every Saturday";
      h += '<div class="bn-card" data-how="weekend"><h4>2. Saturday bonus ' + badge(sst, sp.act.length > 0 || r.weekendOpen) + "</h4><small><b>" + K.pct + "%</b> bonus on the first deposit you make every Saturday (East Africa time), from KES " + k0(K.min) + " (up to KES " + k0(K.max) + "). Valid " + K.days + " days.<br><b>Rule:</b> " + esc(ruleTxt(sl)) + ".</small>" + partCards(sp.act) + pastLine(sp.old) + '<span class="how-l">How to use this bonus &rsaquo;</span></div>';
      /* 3. Affiliate programme */
      h += '<div class="bn-card"><h4>3. Affiliate programme ' + badge("Apply", false) + '</h4><small>Earn <b>25% revenue share, growing to 45%</b>, on the players you bring, plus 5% from affiliates you recruit. Paid every Tuesday into your wallet. Open Account &rsaquo; Rewards &rsaquo; Invite and earn to apply.</small></div>';
      /* 4. Invite friends bonus (filled in below) */
      var rp = parts("referral");
      h += '<div class="bn-card" id="bnInvite" data-how="referral"><h4>4. Invite friends bonus ' + badge(rp.act.length ? "Active" : "Open", true) + "</h4><small><span class=skl></span><span class=skl2></span><span class=skl3></span></small>" + partCards(rp.act) + pastLine(rp.old) + '<span class="how-l">How to use this bonus &rsaquo;</span></div>';
      if (r.active.length) h += '<button type="button" id="bnForfeit" class="btn ghost wide">Forfeit bonus balance</button>';
      a.innerHTML = h;
      api({ action: "refInfo", token: S.token }).then(function (x) {
        var box = $("#bnInvite"); if (!x.ok || !box || !$("#acBody")) return;
        var link = location.origin + location.pathname.replace(/index\.html$/, "") + "?ref=" + x.code, first = box.querySelector("small");
        if (first) first.outerHTML = "<small>When a friend you invite makes a first deposit of " + esc(money(x.minDeposit).replace(".00", "")) + " or more, you get a " + esc(money(x.reward).replace(".00", "")) + " bonus (same rule as the welcome bonus, up to " + x.max + ' rewards).</small><div class="aff-l" style="margin-top:8px"><input id="rfL" readonly value="' + esc(link) + '"><button type="button" id="rfC" class="btn ghost">Copy</button></div><small>Invited ' + x.invited + " &middot; Rewarded " + x.rewarded + ". Your code: <b>" + esc(x.code) + "</b></small>";
        var c = $("#rfC"); if (c) c.onclick = function () { var i = $("#rfL"); i.select(); try { navigator.clipboard.writeText(i.value); } catch (e) { document.execCommand("copy"); } toast("Link copied."); };
      }).catch(function () {});
      var f = $("#bnForfeit"); if (f) f.onclick = function () { if (confirm("Forfeit your bonus balance? You lose the unused bonus money. Your own deposit is not touched and withdrawals open up again.")) acCall({ action: "bonusForfeit", token: S.token }, function () { toast("Bonus forfeited."); loadTaskFlag(); bonusTab(a); }); };
    });
  }
  function depositNote() {
    var n = $("#dpBonus"); if (!n) return;
    var W = PROMO.welcome, K = PROMO.weekend;
    var both = "<b>Welcome bonus " + W.pct + "%</b> on your first deposit, from KES " + k0(W.min) + ".<br><b>Every Saturday: " + K.pct + "% bonus</b> on the first deposit you make that day.";
    var sat = "<b>Every Saturday: " + K.pct + "% bonus</b> on the first deposit you make that day.";
    var hl = ' <button type="button" class="flink" data-how="all">How to use your bonus</button>';
    n.innerHTML = both + hl;
    if (DEMO) return;
    api({ action: "bonusInfo", token: S.token }).then(function (r) {
      if (r.ok && r.weekendUsed) { SAT.usedBy = S.token; satBar(); }
      if (!r.ok || !n) return;
      if (r.hasDeposit) n.innerHTML = (r.weekendOpen ? "<b>Saturday bonus is open!</b> Your first deposit of KES " + k0(K.min) + " or more today gets a " + K.pct + "% bonus." : r.weekendUsed ? "<b>Saturday bonus claimed today.</b> Your next one opens next Saturday." : sat) + hl;
    }).catch(function () {});
  }

  var INFO = {
    bonus: function () {
      var W = PROMO.welcome, K = PROMO.weekend, sl = W.slip;
      var slip = "<b>a slip of " + sl.matches + " or more matches</b>, with <b>every match at odds " + sl.odds + " or higher</b>, staking at least KES " + k0(sl.stake);
      return { title: "Bonuses & affiliates", html: [
        "<p>Bonus money goes into your <b>bonus balance</b>. It is play-only: you stake it by switching on <b>Use bonus</b> on your bet slip when the slip meets the bonus part's rule. A bonus bet is paid fully from bonus and never mixed with cash. If it wins, you receive the <b>winnings</b> in cash (the bonus stake is not returned). If it loses, that bonus stake is used up. You can stake any amount from KES 100 up to the part; the rest stays for another slip. While you have bonus balance you cannot withdraw. You can forfeit it at any time (we remove the bonus, never your own deposit).</p>",
        "<h3>Welcome bonus</h3><ul><li><b>" + W.pct + "% on your first deposit</b>, minimum deposit KES " + k0(W.min) + ", maximum bonus KES " + k0(W.max) + ".</li><li>The bonus expires after " + W.days + " days. Use it on " + slip + ".</li><li>A void match does not count towards the required matches.</li><li><b>Free registration bonus:</b> new players get KES " + k0((PROMO.free || { amount: 50 }).amount) + " with no deposit. It lasts " + (PROMO.free || { hours: 24 }).hours + " hours, must be staked all on one slip (5+ matches, every match at odds 1.5+), and never locks withdrawals. If it wins, the bonus amount is deducted from the winnings.</li><li>First deposit only. The welcome bonus is given once per M-Pesa number. There is no limit on accounts per device, and every new account gets the free registration bonus.</li></ul>",
        "<h3>Saturday bonus</h3><ul><li><b>" + K.pct + "%</b> on your first deposit of the Saturday (East Africa time), minimum deposit KES " + k0(K.min) + ", maximum bonus KES " + k0(K.max) + ".</li><li>Use it on " + slip + ". Expires after " + K.days + " days.</li><li>A deposit under KES " + k0(K.min) + " does not use up the day: your first deposit of KES " + k0(K.min) + " or more that Saturday qualifies.</li><li>Not available if your welcome bonus was earned the same day.</li></ul>",
        "<h3>Affiliate programme</h3><ul><li>Earn <b>25% revenue share, growing to a maximum of 45%</b>, on the players you refer, for as long as they play, plus <b>5%</b> from affiliates you recruit.</li><li>Every affiliate is approved before earning. Self-referrals, fake accounts and accounts on the same device do not qualify.</li></ul>",
        "<h3>Referral bonus</h3><ul><li>Invite a friend with your link or code. When they make a first deposit of KES 200 or more, you get a KES 100 bonus (added to your bonus balance) with the same slip rule as the welcome bonus. Up to 10 rewards.</li><li>Not paid for self-referrals, players on your device, or if you are an approved affiliate (affiliates earn commission instead).</li></ul><h3>Share and earn</h3><ul><li>Any player who is not an affiliate can share a bet slip. The picks are locked, and every friend chooses their own stake.</li><li>When a shared bet wins, <b>5% of the winnings</b> (return minus stake) goes to the player who shared it as a share bonus, taken from the winner. It never locks withdrawals and lasts 14 days after the last credit.</li><li>No bonus for bets placed by yourself or from your own device.</li></ul><h3>Super 5 Predictor</h3><ul><li>Free to enter. Predict the exact score of 5 matches. <b>5 of 5</b> wins cash; <b>4 of 5</b> and <b>3 of 5</b> win bonus balance. Fewer than 3 wins nothing.</li></ul><h3>Multibet boost</h3><ul><li>Build a slip of 3 or more picks, each at odds of " + (BOOSTCFG || DEFBOOST).minOdds.toFixed(2) + " or higher, and earn a boost on your winnings if the slip wins. The boost grows with every qualifying pick.</li><li>The boost is a percentage of your winnings (return minus stake), set when you place the bet, and paid only if the whole slip wins.</li></ul><h3>Fair play</h3><ul><li>Abuse (multiple accounts, matched or hedged betting) can void bonuses and winnings.</li><li>We may change or end offers at any time. 18+ only. Bet responsibly.</li></ul>"].join("") };
    },
    boost: function () {
      var B = BOOSTCFG || DEFBOOST, L = B.ladder, rows = L.map(function (r, i) {
        var nx = L[i + 1], range = nx ? (nx[0] - 1 > r[0] ? r[0] + " to " + (nx[0] - 1) : String(r[0])) : r[0] + " or more";
        return "<li><b>" + range + " picks:</b> " + r[1] + "% boost</li>";
      }).join("");
      return { title: "Multibet boost", html: [
        "<p>Build a multibet and we add a boost to your winnings. The more qualifying picks, the bigger the boost.</p>",
        "<h3>The boost ladder</h3><ul>" + rows + "</ul>",
        "<h3>How it works</h3><ul>",
        "<li>A pick counts only at odds of <b>" + B.minOdds.toFixed(2) + " or higher</b>.</li>",
        "<li>The boost is a percentage of your <b>winnings</b> (your return minus your stake). Example: stake KES 100, total odds 104.05, return KES 10,405, winnings KES 10,305, so a 3% boost is KES 309.15.</li>",
        "<li>It is worked out by us when you place the bet and is shown in My bets. The figure on your slip is the one we apply.</li>",
        "<li>Paid only when the whole slip wins, together with your winnings. A lost slip earns no boost.</li>",
        "<li>If a match is voided and the qualifying picks fall below the minimum, or into a lower tier, the boost is recalculated on the picks that remain.</li>",
        "<li>The most we add as a boost is <b>KES " + k0(B.maxBoost) + "</b> per bet, and the maximum payout of KES " + k0(C.MAX_PAYOUT) + " per bet still applies.</li>",
        "<li>Bets used for a bonus task also earn the boost. We may change or end the boost at any time. 18+ only. Bet responsibly.</li></ul>"
      ].join("") };
    },
    rg: function () {
      return {
        title: "Responsible gambling policy",
        html: [
          "<p>Betting should be entertainment, never a way to make money or fix money problems. This policy explains what we do to keep it that way, and the tools you can use today.</p>",
          "<h3>Our commitments</h3><ul>",
          "<li><b>Adults only.</b> You must be 18 or older to sign up, and by signing up you confirm your age. We may ask for proof of age at any time.</li>",
          "<li><b>No pressure.</b> We do not present betting as a way out of money trouble or encourage you to chase losses.</li>",
          "<li><b>Built-in caps.</b> Each slip is limited to " + kes(LIM.bet.minStake) + " minimum and " + kes(LIM.bet.maxStake) + " maximum stake, and winnings on a single bet are capped at " + kes(LIM.bet.maxPayout) + ".</li>",
          "<li><b>Breaks are firm.</b> Once a break starts it cannot be cut short.</li></ul>",
          "<h3>Tools you can use now</h3>",
          '<div class="cards two">',
          "<div><b>Self-exclusion</b><span>Pause your account for 1 day, 7 days, 30 days, 6 months or 1 year. You cannot bet or deposit until it ends.</span></div></div>",
          "<p>Find it under <b>Account &rsaquo; Settings &rsaquo; Self-exclusion</b> after you log in.</p>",
          "<h3>Know the warning signs</h3><ul><li>Betting more than planned, or chasing losses.</li><li>Borrowing money or missing bills to bet.</li><li>Hiding your betting, or feeling anxious, guilty or irritable about it.</li><li>Betting has stopped being fun but you cannot stop.</li></ul><p>If any of this sounds familiar, take a break now with self-exclusion and talk to someone.</p>",
          '<div class="help"><h3>Get free, confidential help</h3><ul><li><a href="https://www.begambleaware.org" target="_blank" rel="noopener noreferrer">BeGambleAware</a>: independent advice, tools and support.</li><li><a href="https://www.gamcare.org.uk" target="_blank" rel="noopener noreferrer">GamCare</a>: a UK charity with a helpline and live chat.</li><li><a href="https://www.gamblersanonymous.org" target="_blank" rel="noopener noreferrer">Gamblers Anonymous</a>: peer support for people who want to stop.</li><li><a href="https://www.befrienderskenya.org" target="_blank" rel="noopener noreferrer">Befrienders Kenya</a>: free emotional support if you are struggling to cope.</li></ul><p>These organisations are independent and are not run by us. You can also block gambling sites on your devices for free with <a href="https://www.betblocker.org" target="_blank" rel="noopener noreferrer">BetBlocker</a>.</p></div>',
          "<h3>Know the warning signs</h3><ul>",
          "<li>Betting more than you planned, or for longer than you planned.</li>",
          "<li>Chasing losses, or betting to win back what you lost.</li>",
          "<li>Borrowing money, or using rent, food or school-fee money to bet.</li>",
          "<li>Feeling anxious, irritable or guilty about your betting, or hiding it from people close to you.</li>",
          "<li>Betting taking over time you used to spend on family, work or friends.</li></ul>",
          "<h3>Staying in control</h3><ul>",
          "<li>Decide your budget before you start, and stop when it is gone.</li>",
          "<li>Only use money you can afford to lose.</li>",
          "<li>Do not bet when you are upset, tired or have been drinking.</li>",
          "<li>Take regular breaks, and keep other things in your life going.</li></ul>",
          "<h3>Keeping under-18s out</h3>",
          '<p>Under-18s may not open an account or bet. If you share a phone or computer with a young person, keep your login private and consider free blocking software such as <a href="https://www.betblocker.org" target="_blank" rel="noopener noreferrer">BetBlocker</a>.</p>',
          "<h3>Need help?</h3>",
          "<p>If gambling is hurting you or someone close to you, talk to someone you trust, your doctor or a counsellor. You can also ask us to close your account" + (MAIL ? ": " + mailLink("Close my account") : "") + ". Read how we protect players in " + btnLink("protection", "Player protection") + ".</p>",
          '<p class="fine">Last reviewed October 2026. We review this policy at least once a year.</p>'
        ].join("")
      };
    },

    faq: function () {
      var D = LIM.dep, W = LIM.wd, B = LIM.bet, G = LIM.game, R = LIM.ref, pc = Math.round(W.fee * 100), WL = PROMO.welcome, WK = PROMO.weekend, BO = BOOSTCFG || DEFBOOST;
      var T = function (k, t) { return btnLink(k, t); };
      var Q = [
        ["Account", [
          ["How do I sign up?", "Tap <b>Sign up</b>, enter your name, your M-Pesa phone number and a password of 6 to 10 characters, and confirm you are 18 or older. If a friend sent you their link, their promo code is added for you."],
          ["I forgot my password. What do I do?", "On the log-in window choose the forgot-password option and follow the steps. Never share your password. We will never ask for it."],
          ["Can I have more than one account?", "No. You may hold one account, for yourself. Duplicate accounts, or accounts sharing a phone number or payment details, may be closed. See the " + T("terms", "Terms and conditions") + "."]]],
        ["Deposits", [
          ["How do I deposit?", "Open <b>Wallet</b>, tap <b>Deposit</b>, choose M-Pesa, enter the amount and approve the payment on your phone. Your balance updates by itself."],
          ["What are the deposit limits?", "From KES <b>" + limN(D.min) + "</b> to KES <b>" + limN(D.max) + "</b> each time, and up to KES <b>" + limN(D.day) + "</b> in any 24 hours."],
          ["My deposit has not arrived.", "Wait 1 to 2 minutes. The page keeps checking by itself. If M-Pesa took your money and it still has not arrived, open live chat, tap <b>Talk to a human</b> and send your M-Pesa code."]]],
        ["Withdrawals", [
          ["How do I withdraw?", "Open <b>Wallet</b>, tap <b>Withdraw</b>, enter the amount and submit. Once your withdrawal is processed, the cash arrives in your M-Pesa."],
          ["What are the withdrawal limits and fees?", "The minimum is KES <b>" + limN(W.min) + "</b> and the maximum is KES <b>" + limN(W.max) + "</b> per request. Requests up to KES <b>" + limN(W.high) + "</b> are allowed and are paid in parts of up to KES " + limN(W.chunk) + ". A <b>" + pc + "%</b> withholding levy is deducted from every withdrawal, and the screen shows exactly what you will receive before you submit."],
          ["Why can I not withdraw?", "Check these: your balance is at least KES " + limN(W.min) + "; your account number is a +254 number (M-Pesa withdrawals need one); and you have no bonus balance, because withdrawals stay locked while you hold bonus. Use it, let it expire, or forfeit it in the Bonuses tab."],
          ["How do I follow my withdrawal?", "In <b>Wallet &rsaquo; Withdraw</b> each request moves through four steps: Submitted, In process, Verified and Sent. A rejected request is returned to your wallet."],
          ["Which number is paid?", "Only the M-Pesa number registered on your account. Deposit from a number in your own name."]]],
        ["Betting", [
          ["How do I place a bet?", "Tap the odds you want to add them to your bet slip, enter your stake and confirm. Every bet gets its own Bet ID, shown in <b>My bets</b>."],
          ["What are the stake and payout limits?", "Stakes run from KES <b>" + limN(B.minStake) + "</b> to KES <b>" + limN(B.maxStake) + "</b> per bet, and winnings on any one bet are capped at KES <b>" + limN(B.maxPayout) + "</b>."],
          ["How many selections can I add?", "Up to <b>" + B.legs + "</b> selections in one bet."],
          ["When is my bet settled?", "Bets are settled automatically after the match ends, usually within minutes, on official results from our data sources."],
          ["What happens if a match is postponed?", "If a match is postponed, abandoned or not played within a reasonable time, bets on it are void and the stake is returned, unless the outcome is already certain."]]],
        ["Bonuses", [
          ["What is the welcome bonus?", "<b>" + WL.pct + "%</b> on your first deposit, from a deposit of KES " + k0(WL.min) + ", up to a bonus of KES " + k0(WL.max) + ". It is added as one bonus and expires after " + WL.days + " days. To use it: pick 5 or more matches, every match at odds of 1.5 or higher, stake KES 100 or more and switch on Use bonus on the bet slip. Full rules are in the " + T("bonus", "bonus terms") + "."],
          ["What is the Saturday bonus?", "<b>" + WK.pct + "%</b> on your first deposit of the Saturday (East Africa time), from KES " + k0(WK.min) + ", up to KES " + k0(WK.max) + ". It expires after " + WK.days + " days. Everyone also gets an inbox message about it every Saturday."],
          ["How do I use my bonus?", "Switch on <b>Use bonus</b> on a bet slip that meets the bonus rule. A bonus bet is paid fully from bonus. If it wins, you receive the winnings in cash. You can forfeit unused bonus at any time. We never remove your own deposit."],
          ["What is the multibet boost?", "Build a slip of 3 or more picks, each at odds of " + BO.minOdds.toFixed(2) + " or higher, and if the whole slip wins you get a boost on your winnings. The more qualifying picks, the bigger the boost."]]],
        ["Jackpots", [
          ["How do jackpots work?", "Pick the result of each listed match while the jackpot is open. The top prize is shown on the jackpot page. If several players get every pick right they share it equally."],
          ["How many entries can I place?", "Up to <b>" + LIM.jp.maxEntries + "</b> entries in one jackpot."]]],
        ["Crash game", [
          ["How do the crash games work?", "A multiplier climbs from 1.00x. Cash out before it crashes to win your stake times the multiplier. If it crashes first, the stake is lost. A round can end at any moment, so decide your cash-out target before you play."],
          ["What are the stake limits and where are they available?", "Stakes run from KES <b>" + limN(G.minStake) + "</b> to KES <b>" + limN(G.maxStake) + "</b> per round. Availability of instant-win games depends on your country."]]],
        ["Affiliates", [
          ["How do I invite a friend?", "Share your link or code from your account. When your friend makes a first deposit of KES " + limN(R.minDeposit) + " or more, you get a KES " + limN(R.reward) + " bonus, for up to " + R.max + " friends."],
          ["How do I become an affiliate?", "Open <b>Affiliates</b> from the menu and apply. We approve every affiliate. Revenue share starts at 25% and can grow to 45%, and earnings are paid every Tuesday into your player wallet. Read the " + T("affiliates", "affiliate terms") + "."]]],
        ["Safety", [
          ["How do I stay in control?", "You can self-exclude at any time under <b>Account &rsaquo; Settings</b>. Read our " + T("rg", "responsible gambling policy") + " for free help lines. 247Bet is for adults aged 18 and over."],
          ["How do I contact support?", "Open live chat from the menu and tap <b>Talk to a human</b>, or see our " + T("complaints", "complaints procedure") + " if something went wrong."]]]
      ];
      var h = '<div class="faq"><p class="upd">Quick answers. Numbers on this page come from the same settings the site uses.</p><input id="faqQ" class="faq-q" type="search" placeholder="Search questions" aria-label="Search questions" autocomplete="off">';
      h += '<h3 data-g="limits">Limits at a glance</h3>' + limTable();
      Q.forEach(function (g, gi) {
        h += '<h3 data-g="' + gi + '">' + g[0] + "</h3>" + g[1].map(function (x) { return '<details data-g="' + gi + '"><summary>' + x[0] + "</summary><div>" + x[1] + "</div></details>"; }).join("");
      });
      h += '<p class="faq-none" id="faqNone" hidden>No question matches. Try another word, or ask in live chat.</p></div>';
      return { title: "Frequently asked questions", html: h };
    },

    terms: function () {
      var op = LIC.operator ? esc(LIC.operator) : "the operator of 247Bet", reg = LIC.regulator ? esc(LIC.regulator) : "the regulator that licenses us";
      return { title: "Terms and conditions", html: [
        '<p class="upd">Please read these terms before you sign up. By creating an account or placing a bet you accept them.</p>',
        "<h3>1. About these terms</h3><p>247Bet is operated by " + op + " (\"we\", \"us\"). These terms form a binding agreement between you and us, together with our " + btnLink("bonus", "bonus terms") + ", " + btnLink("rg", "responsible gambling policy") + ", " + btnLink("privacy", "privacy notice") + " and " + btnLink("complaints", "complaints procedure") + ". If they conflict, the bonus terms apply to bonuses and these terms apply to everything else.</p>",
        "<h3>2. Eligibility and registration</h3><ul><li>You must be 18 or older and legally allowed to gamble where you live. Betting by anyone under 18 is an offence, and any bets and winnings of an underage account are void.</li><li>You may hold one account only, for yourself. Duplicate accounts, or accounts sharing a phone number or payment details, may be closed.</li><li>The information you give must be true and complete. We may ask for proof of identity, age or the source of your funds at any time, and may restrict the account until you provide it.</li></ul>",
        "<h3>3. Your account and security</h3><ul><li>Keep your password private. You are responsible for all activity on your account unless you tell us promptly that it has been compromised.</li><li>We may lock or suspend an account after repeated failed log-ins or if we suspect unauthorised use.</li><li>Accounts are personal and cannot be sold, transferred or lent to anyone else.</li></ul>",
        "<h3>4. Deposits and withdrawals</h3><ul><li>Deposits are made in Kenyan shillings by M-Pesa and are credited once the payment is confirmed. Charges made by your mobile provider are your responsibility.</li><li>Pay only from a number registered in your own name. Once a withdrawal is processed, the cash is sent to the M-Pesa number registered on your account. The limits in the table below apply.</li><li>Withdrawals are not available while a bonus is unfinished (see the bonus terms).</li><li>We may delay or refuse a payment, and hold funds, where we need to carry out checks or the law requires it.</li></ul>",
        limTable(),
        "<h3>5. Betting rules</h3><ul><li>A bet is accepted only when you confirm your slip and we show it in My bets. It is placed at the odds on the slip. If the odds change or a selection is withdrawn before you confirm, the slip is not accepted.</li><li>Each slip has a minimum stake of " + kes(LIM.bet.minStake) + " and a maximum of " + kes(LIM.bet.maxStake) + ". Winnings on a single bet are capped at " + kes(LIM.bet.maxPayout) + ".</li><li>Bets are settled on official results from our data sources. Unless stated otherwise, markets cover normal time only, plus stoppage time.</li><li>If a match is postponed, abandoned or not played within a reasonable time, bets on it are void and the stake is returned, unless the outcome is already certain.</li><li>We may correct or void a bet placed at obviously wrong odds, or after the outcome was known or an event had started.</li><li>Our records are final in a dispute unless shown to be wrong.</li></ul>",
        "<h3>6. Fair play and prohibited conduct</h3><p>You must not use more than one account, collude with others, use bots or automated tools, exploit errors, hedge or match bets to abuse offers, or use the service for money laundering or any unlawful purpose. We may void bets, withhold winnings, withdraw bonuses and close the account where this happens. We may report suspicious activity to the authorities as the law requires.</p>",
        "<h3>7. Responsible gambling</h3><p>You can self-exclude at any time under Account &rsaquo; Settings. We may also exclude or restrict an account where we think play may be harmful. Free help is listed in our " + btnLink("rg", "responsible gambling policy") + ".</p>",
        "<h3>8. Our responsibility</h3><p>We provide the service with reasonable care and do not guarantee it will always be available or error free. Bets affected by a technical fault, error or manifest mistake may be void. We are not liable for indirect or consequential loss, or for losses from your device, network or mobile provider. Nothing in these terms limits liability that cannot be limited by law, and your statutory rights are unaffected.</p>",
        "<h3>9. Suspension and closure</h3><p>You may close your account at any time by contacting us, and we will return any balance that belongs to you after checks. We may suspend or close an account for breach of these terms, for legal or regulatory reasons, or to protect other players. Funds obtained through breach or unlawful activity may be withheld.</p>",
        "<h3>10. Changes</h3><p>We may update these terms. Material changes are shown on the site before they apply, and continued use after that means you accept them.</p>",
        "<h3>11. Complaints and governing law</h3><p>If something goes wrong, follow our " + btnLink("complaints", "complaints procedure") + ". These terms are governed by the laws of Kenya, and the courts of Kenya have jurisdiction, subject to any right you have to go to " + reg + ".</p>",
        "<h3>12. Contact</h3><p>" + (MAIL ? "Write to us at " + mailLink("247Bet enquiry") + "." : "Contact details are shown on this site.") + "</p>"
      ].join("") };
    },

    privacy: function () {
      var op = LIC.operator ? esc(LIC.operator) : "the operator of 247Bet";
      return { title: "Privacy notice", html: [
        '<p class="upd">This notice explains how ' + op + ' (\"we\") handles your personal data under Kenya&rsquo;s Data Protection Act, 2019.</p>',
        "<h3>What we collect</h3><ul><li><b>Account details:</b> name, phone number, account number, currency and a password stored only in hashed form.</li><li><b>Activity:</b> bets, deposits, withdrawals, bonuses, messages and log-in times.</li><li><b>Device and technical data:</b> a device identifier, IP address and browser type, used for security and to stop duplicate accounts and bonus abuse.</li><li><b>Payment references:</b> M-Pesa receipts and amounts. We never see your M-Pesa PIN.</li></ul>",
        "<h3>Why we use it</h3><ul><li>To run your account and process bets and payments (contract).</li><li>To check age and identity, prevent fraud and money laundering, and meet legal duties (legal obligation).</li><li>To keep the service secure, fix problems and protect players (legitimate interests).</li><li>To contact you about your account, and about offers only where you have agreed.</li></ul>",
        "<h3>Who we share it with</h3><p>Only as needed: our payment provider and mobile money network to process payments, cloud hosting and infrastructure providers that run the service, professional advisers, and regulators, courts or law enforcement where the law requires. We do not sell your data. Our odds suppliers do not receive your personal data.</p>",
        "<h3>How long we keep it</h3><p>We keep your data while your account is open and afterwards for as long as the law requires for financial, anti-money-laundering and regulatory records. After that it is deleted or anonymised.</p>",
        "<h3>Your rights</h3><p>You may ask to see, correct or delete your data, object to or restrict its use, and withdraw consent you have given. Some data must be kept by law, and we will explain if so. Contact us" + (MAIL ? " at " + mailLink("Privacy request") : "") + ". If you are not satisfied, you may complain to the Office of the Data Protection Commissioner in Kenya.</p>",
        "<h3>Storage on your device and fonts</h3><p>We store your log-in session, a device identifier and any promo code on your device so the site works and stays secure. We do not use advertising cookies. Fonts are loaded from Google Fonts, which may receive your IP address.</p>",
        "<h3>Security and age</h3><p>We use access controls, hashing and encrypted connections, but no system is perfectly secure, so keep your password private. The service is for adults only, and we delete the data of anyone we find to be under 18.</p>"
      ].join("") };
    },

    protection: function () {
      return {
        title: "Player protection",
        html: [
          "<p>Player protection means looking after your money, your data and your wellbeing. This is what we do.</p>",
          '<div class="cards">',
          "<div><b>Your account</b><span>By signing up you confirm you are 18 or older, and we may ask for proof of age at any time. Repeated wrong passwords temporarily lock the account. Never share your password; we will never ask for it.</span></div>",
          "<div><b>Your money</b><span>Deposits are made with M-Pesa and credited only once the payment is confirmed. Withdrawals are sent to your registered M-Pesa number. Every deposit, bet, win and withdrawal appears in your account history. Bonus money cannot be withdrawn until its wagering requirement is completed.</span></div>",
          "<div><b>Fair betting</b><span>Bets are accepted only at the odds on your slip. If the odds change or a selection is withdrawn before you confirm, the bet is declined and you are asked to review your slip.</span></div>",
          "<div><b>Your wellbeing</b><span>Self-exclude from your account at any time. See our " + btnLink("rg", "responsible gambling policy") + ".</span></div>",
          "<div><b>Your data</b><span>We collect only what we need to run your account, check your age and process payments.</span></div></div>",
          "<h3>Spot something wrong?</h3>",
          "<p>If you see activity you do not recognise, change your password and contact us straight away" + (MAIL ? ": " + mailLink("Suspicious account activity") : "") + ". If you have a problem with a bet or a payment, follow our " + btnLink("complaints", "complaints procedure") + ".</p>"
        ].join("")
      };
    },

    complaints: function () {
      var reg = LIC.regulator ? esc(LIC.regulator) : "the regulator that licenses us";
      return {
        title: "Complaints & procedures",
        html: [
          "<p>We want to put things right. If you are unhappy with how a bet was settled, a payment, or how you were treated, follow these steps.</p>",
          '<div class="cards">',
          "<div><b>1. Contact support</b><span>Tell us what happened. We will acknowledge within 24 hours and aim to resolve it within 5 working days.</span></div>",
          "<div><b>2. Ask for a review</b><span>If you are not happy with the answer, ask for a review by our complaints manager within 14 days. You will get a written final decision, with reasons, within 14 days.</span></div>",
          "<div><b>3. Take it further</b><span>If it is still unresolved, you may refer your complaint to " + reg + ".</span></div></div>",
          "<h3>What to include</h3><ul>",
          "<li>The phone number on your account.</li>",
          "<li>The bet or transaction ID, plus the date, time and amount.</li>",
          "<li>What happened and what you expected to happen.</li>",
          "<li>Screenshots or M-Pesa messages, if you have them.</li></ul>",
          "<h3>Good to know</h3><ul>",
          "<li>Please raise a complaint within 90 days so the records are still available.</li>",
          "<li>Every complaint is logged and looked at by someone who was not involved in the original decision.</li>",
          "<li>Complaining never affects your account or your right to keep playing.</li></ul>",
          MAIL ? "<p><b>Contact:</b> " + mailLink("Complaint", MAIL) + "</p>" : "",
          "<p>Related: " + btnLink("protection", "Player protection") + " &middot; " + btnLink("rg", "Responsible gambling") + "</p>"
        ].join("")
      };
    },

    affiliates: function () {
      return {
        title: "Affiliates",
        html: [
          '<div class="aff-h"><span class="aff-eb">247Bet Partners &middot; Now open</span><div class="aff-big"><small>Earn up to</small><b>45%</b></div><p class="aff-sub">revenue share on every player you bring to 247Bet, for as long as they play.</p><div class="aff-chips"><span>Free to join</span><span>Paid every Tuesday</span><span>Players stay yours</span></div></div>',
          '<div class="aff-cta"><button type="button" class="ab ap" data-aff="apply"><b>Apply now</b><span>New here? Start your application</span></button><button type="button" class="ab db" data-aff="dash"><b>Open dashboard</b><span>Already an affiliate? See your stats</span></button></div>',
          "<p>For tipsters, content creators, community admins and website owners who want to earn by introducing adult players to 247Bet. Joining is free and every affiliate is approved by us.</p>",
          '<div class="cards">',
          "<div><b>25% to 45%</b><span>Revenue share that grows with your active players.</span></div>",
          "<div><b>Every Tuesday</b><span>Paid automatically into your 247Bet wallet.</span></div>",
          "<div><b>Players stay yours</b><span>Players who join with your link or code are attributed to you with no expiry date, while your account is in good standing.</span></div></div>",
          "<h3>How it works</h3>",
          '<div class="cards">',
          "<div><b>1. Apply</b><span>Register a player account, then tell us about your audience and sign the agreement. We review every application.</span></div>",
          "<div><b>2. Share</b><span>Use your link, promo code, QR code and banners, with a separate campaign link for each video, group or page.</span></div>",
          "<div><b>3. Bring players</b><span>Every player who signs up through your link or code is attributed to you.</span></div>",
          "<div><b>4. Get paid</b><span>Approved earnings are paid every Tuesday into your wallet, then withdrawn under the usual rules.</span></div></div>",
          "<h3>Your rate grows with your players</h3>" + affSummary(),
          "<h3>Work out what you could earn</h3>" + affCalc(),
          "<h3>Commission models</h3><ul>",
          "<li><b>Revenue share:</b> a percentage of net revenue from the players you refer.</li>",
          "<li><b>CPA:</b> a fixed fee for each qualifying new player, available on request.</li>",
          "<li><b>Hybrid:</b> a smaller CPA plus a revenue share, available on request.</li></ul>",
          "<h3>Questions and answers</h3>" + affFaq(),
          "<h3>Reporting you see</h3>",
          "<p>Clicks, sign-ups, first deposits, conversion rate, active players, earnings per click, net revenue and commission earned.</p>",
          "<h3>Rules for partners</h3><ul>",
          "<li>Promote only to adults aged 18 and over. Never target minors or people on a break.</li>",
          "<li>No misleading claims such as guaranteed wins or risk-free betting.</li>",
          "<li>Make it clear that content is advertising, and show 18+ and a responsible gambling message.</li>",
          "<li>No fake sign-ups or self-referrals. We may withhold commission for breaches.</li></ul>",
          "<h3>Full agreement</h3>" + affContract() + (MAIL ? "<p><b>Want to be first to know?</b> " + mailLink("Affiliate programme interest", "Email us") + " with your website or channel.</p>" : "<p>Log in, then apply from Account &rsaquo; Affiliate.</p>")
        ].join("")
      };
    }
  };

  /* FAQ search: filters the questions as the person types */
  document.addEventListener("input", function (e) {
    var el = e.target; if (!el || el.id !== "faqQ") return;
    var q = el.value.trim().toLowerCase(), root = $("#infoBody"), any = false, i;
    var ds = root.querySelectorAll(".faq details");
    for (i = 0; i < ds.length; i++) { var m = !q || ds[i].textContent.toLowerCase().indexOf(q) > -1; ds[i].hidden = !m; if (m) any = true; ds[i].open = !!q && m; }
    var hs = root.querySelectorAll(".faq h3[data-g]");
    for (i = 0; i < hs.length; i++) { var g = hs[i].getAttribute("data-g"); hs[i].hidden = g === "limits" ? !!q : !root.querySelector('.faq details[data-g="' + g + '"]:not([hidden])'); }
    var nn = $("#faqNone"); if (nn) nn.hidden = any || !q;
  });

  function openInfo(key) {
    var p = INFO[key]; if (!p) return;
    if (typeof NAV !== "undefined" && NAV) NAV.info = key;
    var pg = p();
    $("#infoTitle").textContent = pg.title;
    $("#infoBody").innerHTML = pg.html;
    $("#infoBody").scrollTop = 0;
    openDlg($("#infoDlg"));
  }
  renderLicence();

  /* ---------- how to use your bonus: one panel for every bonus, opened from anywhere a bonus is tapped ---------- */
  var HW_TYPES = { welcome: 1, free: 1, weekend: 1, referral: 1, share: 1, all: 1 };
  function howType(s) { s = String(s || "").toLowerCase(); return /saturday|weekend/.test(s) ? "weekend" : /free|registration/.test(s) ? "free" : /referral|invite/.test(s) ? "referral" : /share/.test(s) ? "share" : /welcome|200/.test(s) ? "welcome" : "all"; }
  function howHtml(t) {
    var W = PROMO.welcome, K = PROMO.weekend, F = PROMO.free || { amount: 50, hours: 24, slip: { matches: 5, odds: 1.5, stake: 50 } }, sl = W.slip, li = !!S.user, RW = LIM.ref ? LIM.ref.reward : 100, h = "";
    function row(a, b) { return "<tr><td>" + a + "</td><td>" + b + "</td></tr>"; }
    function rule(st) { return [row("Matches on the slip", "<b>" + sl.matches + " or more</b>"), row("Odds of every match", "<b>" + sl.odds.toFixed(2) + " or higher</b>"), row("Minimum stake", "<b>KES " + k0(st) + "</b>")].join(""); }
    function steps(st, all) {
      return '<ol class="hw-ol"><li>Open the matches and add <b>' + sl.matches + " or more selections</b>, every one at odds of <b>" + sl.odds.toFixed(2) + " or higher</b>.</li><li>Enter a stake of <b>at least KES " + k0(st) + "</b>" + (all ? " (the whole bonus in one slip)" : ", and no more than the bonus you have left") + ".</li><li>On the bet slip, switch on <b>Use bonus</b>. The slip is paid fully from your bonus balance and is never mixed with cash.</li><li>Place the bet.</li></ol>";
    }
    function result(lock) {
      return '<div class="hw-box"><b>If the slip wins:</b> only the <b>winnings</b> (payout minus the bonus stake) are paid into your cash balance, and the cash can be withdrawn. The bonus stake itself is not paid back.<br><b>If it loses:</b> that bonus stake is used up.</div>' + (lock ? '<div class="hw-box warn"><b>Withdrawals are locked</b> while this bonus balance remains. They open again once you have staked it, it has expired, or you forfeit it. Your own cash is never touched.</div>' : '<div class="hw-box"><b>Withdrawals are not locked</b> by this bonus.</div>');
    }
    var crumb = '<p class="m" style="font-size:calc(12px * var(--ts));color:var(--mute)">If you stake only part of the bonus, what is left must be zero or at least the minimum stake, so stake it all or leave enough for another slip.</p>';
    if (t === "welcome") h = "<h3>Welcome bonus (" + W.pct + "%)</h3><p><b>" + W.pct + "%</b> of your first deposit goes into your bonus balance (deposit from KES " + k0(W.min) + ", bonus up to KES " + k0(W.max) + "). It is play-only: it is not cash and cannot be withdrawn directly.</p><table class=\"hw-t\">" + row("Valid for", "<b>" + W.days + " days</b>") + rule(sl.stake) + row("Withdrawals", "Locked while bonus balance remains") + "</table><h3>How to use it</h3>" + steps(sl.stake) + crumb + result(true);
    else if (t === "free") h = "<h3>Free registration bonus (KES " + k0(F.amount) + ")</h3><p>Every new account gets <b>KES " + k0(F.amount) + "</b> with no deposit. It is play-only and lasts <b>" + F.hours + " hours</b>, so use it soon after you join.</p><table class=\"hw-t\">" + row("Valid for", "<b>" + F.hours + " hours</b>") + rule(F.slip.stake) + row("Withdrawals", "Never locked") + "</table><h3>How to use it</h3>" + steps(F.slip.stake, true) + result(false);
    else if (t === "weekend") h = "<h3>Saturday bonus (" + K.pct + "%)</h3><p><b>" + K.pct + "%</b> of the <b>first deposit you make on a Saturday</b> (East Africa time) goes into your bonus balance. Deposit from KES " + k0(K.min) + ", bonus up to KES " + k0(K.max) + ". It is play-only.</p><p style=\"font-size:calc(12px * var(--ts));color:var(--mute)\">A smaller deposit earlier in the day does not use up your chance: your first deposit of KES " + k0(K.min) + " or more that Saturday qualifies. If your very first deposit ever is on a Saturday, you get the " + W.pct + "% welcome bonus instead.</p><table class=\"hw-t\">" + row("Valid for", "<b>" + K.days + " days</b>") + rule(sl.stake) + row("Withdrawals", "Locked while bonus balance remains") + "</table><h3>How to use it</h3>" + steps(sl.stake) + crumb + result(true);
    else if (t === "referral") h = "<h3>Invite friends bonus (KES " + k0(RW) + ")</h3><p>When a friend you invited makes a first deposit, <b>KES " + k0(RW) + "</b> goes into your bonus balance. It is play-only.</p><table class=\"hw-t\">" + rule(sl.stake) + row("Withdrawals", "Locked while bonus balance remains") + "</table><h3>How to use it</h3>" + steps(sl.stake) + crumb + result(true);
    else if (t === "share") h = "<h3>Share bonus</h3><p>When a friend's bet from your shared slip wins, <b>5% of their winnings</b> goes into your bonus balance. It is play-only.</p><table class=\"hw-t\">" + rule(50) + row("Valid for", "<b>14 days</b> after the last credit") + row("Withdrawals", "Never locked") + "</table><h3>How to use it</h3>" + steps(50) + result(false);
    else h = "<p>Bonus money goes into your <b>bonus balance</b>. It is <b>play-only</b>: you cannot withdraw it directly. You turn it into cash by staking it on a qualifying slip. Tap a bonus below to see its own rules.</p><div class=\"hw-pick\"><button type=\"button\" data-hw=\"welcome\">Welcome " + W.pct + "%</button><button type=\"button\" data-hw=\"weekend\">Saturday " + K.pct + "%</button><button type=\"button\" data-hw=\"free\">Free KES " + k0(F.amount) + "</button><button type=\"button\" data-hw=\"referral\">Invite friends</button><button type=\"button\" data-hw=\"share\">Share bonus</button></div><h3>The same steps for every bonus</h3>" + steps(sl.stake) + "<table class=\"hw-t\"><tr><td><b>Bonus</b></td><td><b>Minimum stake &middot; valid for</b></td></tr>" + row("Welcome " + W.pct + "%", "KES " + k0(sl.stake) + " &middot; " + W.days + " days") + row("Saturday " + K.pct + "%", "KES " + k0(sl.stake) + " &middot; " + K.days + " days") + row("Free KES " + k0(F.amount), "KES " + k0(F.slip.stake) + " (all of it) &middot; " + F.hours + " hours") + row("Invite friends", "KES " + k0(sl.stake)) + row("Share bonus", "KES 50 &middot; 14 days") + "</table>" + result(true).replace("<b>Withdrawals are locked</b> while this bonus balance remains.", "<b>Withdrawals are locked</b> while you hold welcome, referral or Saturday bonus balance. The free registration and share bonuses never lock them.");
    var acts = "";
    if (t !== "all") acts += '<button type="button" class="btn ghost" data-hw="all">All bonuses</button>';
    if (li) acts += '<button type="button" class="btn ghost" data-hw="tab">Open my Bonuses</button><button type="button" class="btn" data-hw="dep">Deposit</button>';
    else acts += '<button type="button" class="btn" data-hw="join">Sign up</button><button type="button" class="btn ghost" data-hw="login">Log in</button>';
    return h + '<div class="hw-acts">' + acts + "</div>";
  }
  function openHow(t) {
    if (t === "slip") { var bp = (S.bonusParts || [])[0]; t = bp && HW_TYPES[bp.type] ? bp.type : "all"; }
    if (!HW_TYPES[t]) t = "all";
    $("#hwTitle").textContent = "How to use your bonus";
    $("#hwBody").innerHTML = howHtml(t); $("#hwBody").scrollTop = 0;
    var d = $("#hwDlg"); if (d.scrollTo) { try { d.scrollTo(0, 0); } catch (e) {} } openDlg(d);
  }

  /* ---------- jackpots ---------- */
  var JPA = {}, JPS = [], jpPick = {}, jpRid = "", jpSel = "", jpDc = 0;
  function openDlg(d) { if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else d.setAttribute("open", ""); }
  function when(ms) { return new Date(ms).toLocaleString("en-KE", { timeZone: C.TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
  function jpExpired() { closeDlg($("#jpDlg")); setSession("", null); openAuth("bet"); }
  var JPT = { MID: { name: "Midweek Millionaire", games: "Tue + Wed games", draft: "Sunday" }, WKD: { name: "Super Millionaire", games: "Sat + Sun games", draft: "Wednesday" } };
  function jpType(j) { return j.type || (j.size >= 14 ? "WKD" : "MID"); }
  function jpLatest(k) { for (var i = 0; i < JPS.length; i++) if (jpType(JPS[i]) === k) return JPS[i]; return null; }   // the list comes newest first
  function od(v) { return Number(v) > 0 ? Number(v).toFixed(2) : "-"; }
  function openJackpots() { jpSel = ""; jpPick = {}; jpDc = 0; jpRid = ""; loadJackpots(); }
  function loadJackpots() {
    var body = $("#jpBody"); $("#jpTitle").textContent = "Jackpots"; body.innerHTML = "<p><span class=skl></span><span class=skl2></span><span class=skl3></span></p>"; openDlg($("#jpDlg"));
    if (DEMO) { body.innerHTML = "<p>Set API_URL in the settings block to show jackpots.</p>"; return; }
    api({ action: "jackpots" }).then(function (r) { JPS = r.ok ? r.jackpots : []; JPA = r.ok && r.archive ? r.archive : {}; if (!jpSel) jpSel = jpDefault(); renderJpList(); })
      .catch(function () { body.innerHTML = "<p>Network problem. Try again.</p>"; });
  }
  /* the jackpot that opens first: the open one that closes soonest, else the latest Super, else Midweek */
  function jpDefault() {
    var best = "", bt = 0;
    ["MID", "WKD"].forEach(function (k) { var j = jpLatest(k); if (j && j.status === "open") { var c = Number(j.closes) || 0; if (!best || c < bt) { best = k; bt = c; } } });
    return best || (jpLatest("WKD") ? "WKD" : "MID");
  }
  function jpTabs() {
    return '<div class="jp-tabs" role="tablist" aria-label="Choose a jackpot">' + ["MID", "WKD"].map(function (k) {
      var j = jpLatest(k), T = JPT[k], on = jpSel === k;
      return '<button type="button" role="tab" class="jp-tab' + (on ? " on" : "") + '" data-jt="' + k + '" aria-selected="' + on + '"><b>' + esc(T.name) + "</b><small>" + (j ? j.size + " matches" + (j.status === "open" ? " &middot; Open" : "") : "Coming soon") + "</small></button>";
    }).join("") + "</div>";
  }
  function jpPrice(j, n) { return j.prices && j.prices[n] > 0 ? j.prices[n] : j.fee + n * (j.dblFee || 0); }
  function dblTable(j) {
    var h = '<div class="jp-pt" role="group" aria-label="Number of double chances">';
    for (var k = 0; k <= j.doubles; k++) h += '<button type="button" data-pn="' + k + '" aria-pressed="' + (k === jpDc) + '"' + (k === jpDc ? ' class="on"' : "") + ">" + (k === 0 ? "None" : k + (k === 1 ? " double" : " doubles")) + "<b>" + esc(money(jpPrice(j, k)).replace(".00", "")) + "</b></button>";
    return h + "</div>";
  }
  function jpHead(j) {
    return '<div class="jp-h"><b>' + esc(j.name) + '</b><span class="st st-' + (j.status === "open" ? "won" : "") + '">' + esc(j.awaiting ? "results in" : j.status) + "</span></div>" +
      '<div class="mt">' + j.size + " matches &middot; Entry " + esc(money(j.fee)) + "</div>" +
      (j.v2 ? '<div class="jp-pool">Top prize <b>' + esc(money(j.top).replace(".00", "")) + "</b></div>" + (j.status === "open" ? '<div class="mt">Get all ' + j.size + ' right to win it. It grows every week until someone does.</div>' : "")
        : '<div class="jp-pool">Prize pool <b>' + esc(money(j.pool)) + "</b></div>") +
      '<div class="mt">' + (j.status === "open" ? "Closes " : "Closed ") + when(j.closes) + "</div>";
  }
  /* every match shows league, kickoff date and time, and the 1 X 2 odds; the 1 X 2 boxes are the pick buttons while the jackpot is open */
  function jpDetail(j) {
    var open = j.status === "open", res = j.results || [];
    return '<div class="jp-intro"><h3>' + (open ? "Make your picks" : "Results") + "</h3><p>" + (open ? "Tap 1, X or 2 for every match. Get all " + j.size + " right to win the top prize." : "Winning results are highlighted.") + "</p></div>" +
      (open && j.doubles ? '<div class="jp-dc"><div class="jp-dch"><b>Double chances</b><span id="jpDbl"></span></div><p>Choose how many (0 to ' + j.doubles + "). A double covers two results: 1X, 12 or X2.</p>" + dblTable(j) + "</div>" : "") +
      (open ? '<div class="jp-qp"><button type="button" id="jpQuick" class="btn ghost">&#127922; Lucky Dip</button><button type="button" id="jpClear" class="btn ghost">Clear all</button></div><p class="jp-qh">Lucky Dip picks all ' + j.size + ' matches for you. Change any pick you like.</p>' : "") +
      (open && j.maxEntries ? '<p class="jp-lim">Limit per player: ' + j.maxEntries + " entries or " + esc(money(j.maxSpend).replace(".00", "")) + " in total for this jackpot.</p>" : "") +
      j.matches.map(function (m, i) {
        var odds = [m.h, m.d, m.a];
        var cells = ["1", "X", "2"].map(function (v, k) {
          return open ? '<button type="button" data-v="' + v + '" aria-pressed="false"><span>' + v + "</span><em>" + od(odds[k]) + "</em></button>"
            : '<div class="jo' + (res[i] === v || res[i] === "V" ? " hit" : "") + '"><span>' + v + "</span><em>" + od(odds[k]) + "</em></div>";
        }).join("");
        return '<div class="jm2"><div class="jm2-t"><span>' + esc(m.league || "") + "</span><span>" + when(m.t) + '</span></div><div class="jm2-n"><b class="jm2-no">' + (i + 1) + '</b>' + esc(m.home + " v " + m.away) + '</div><div class="j3 j3o" data-i="' + i + '">' + cells + "</div>" + (open && j.doubles ? '<div class="j3 j3d" data-i="' + i + '" aria-label="Double chance">' + ["1X", "12", "X2"].map(function (v) { return '<button type="button" data-v="' + v + '" aria-pressed="false">' + v + "</button>"; }).join("") + "</div>" : "") + "</div>";
      }).join("") +
      (open ? '<p id="jerr" class="aerr" role="alert"></p><button type="button" id="jpGo" class="btn lime wide" style="margin-top:8px"></button>'
        : '<div class="mt" style="margin-top:8px">' + (j.status === "settled" ? "Settled. Winning results are highlighted." : j.awaiting ? "Results are in. Prizes are being confirmed and will be paid to winners' wallets." : "Closed. Waiting for results.") + "</div>");
  }
  /* ---------- previous results: the last finished jackpot of each type ---------- */
  function archCard(a) {
    var paid = a.status === "settled", won = a.tiers && a.tiers[0] && a.tiers[0].winners > 0;
    var h = '<div class="ar"><div class="ar-h"><b>' + esc(a.name) + '</b><span class="st st-' + (paid ? "won" : "") + '">' + (paid ? "paid" : "results in") + "</span></div>" +
      '<div class="ar-top"><small>Top prize</small><b>' + esc(money(a.top).replace(".00", "")) + "</b>" + (a.tiers && a.v2 ? "<span>" + (won ? "Won by " + a.tiers[0].winners + (a.tiers[0].winners === 1 ? " player" : " players") : "Not won. It keeps growing.") + "</span>" : "") + "</div>" +
      a.matches.map(function (m, i) {
        return '<div class="ar-m"><span class="ar-n">' + (i + 1) + '</span><span class="ar-t">' + esc(m.home + " v " + m.away) + '</span><span class="ar-s">' + esc(m.score || "") + '</span><b class="ar-r">' + esc(m.result === "V" ? "V" : m.result || "-") + "</b></div>";
      }).join("");
    if (a.tiers && a.v2) h += '<div class="ar-tt">Winners and prizes</div>' + a.tiers.map(function (t) {
      return '<div class="ar-p"><span>' + t.correct + " correct</span><span>" + (t.winners ? t.winners + (t.winners === 1 ? " winner" : " winners") : "No winner") + "</span><b>" + (t.winners ? esc(money(t.each).replace(".00", "")) + " each" : "-") + "</b></div>";
    }).join("");
    else if (!paid) h += '<p class="mt" style="margin:8px 0 0">Results are in. Prizes are being confirmed.</p>';
    return h + "</div>";
  }
  function openJpArchive() {
    var body = $("#jpBody"), items = ["MID", "WKD"].map(function (k) { return JPA[k]; }).filter(Boolean);
    $("#jpTitle").textContent = "Previous results";
    body.innerHTML = '<button type="button" id="jpBackA" class="btn ghost">&larr; Back</button>' +
      (items.length ? items.map(archCard).join("") : '<p class="mt" style="margin-top:12px">No previous results yet. The last jackpot appears here once all of its matches are finished.</p>');
    $("#jpBackA").onclick = renderJpList;
  }
  function renderJpList() {
    var body = $("#jpBody"); $("#jpTitle").textContent = "Jackpots";
    if (!jpSel) jpSel = jpDefault();
    var k = jpSel, T = JPT[k], jj = jpLatest(k);
    var card = !jj ? '<div class="jpc empty"><div class="jp-h"><b>' + esc(T.name) + '</b></div><div class="mt">' + esc(T.games) + '</div><div class="jp-pool">Next draw coming soon</div><div class="mt">Posted around ' + esc(T.draft) + ".</div></div>"
      : '<div class="jpc open" data-jt="' + k + '">' + jpHead(jj) + jpDetail(jj) + "</div>";
    body.innerHTML = jpTabs() + '<div class="jpx one">' + card + '</div><button type="button" id="jpPrev" class="btn ghost wide" style="margin-top:10px">Previous results</button><button type="button" id="jpMine" class="btn ghost wide" style="margin-top:8px">My jackpot history</button>';
    $("#jpPrev").onclick = openJpArchive;
    $("#jpMine").onclick = function () { if (!S.user) { closeDlg($("#jpDlg")); openAuth("bet"); return; } closeDlg($("#jpDlg")); openBets("jps"); };
    $$(".jp-tab", body).forEach(function (x) {
      x.onclick = function () { var n = x.getAttribute("data-jt"); if (n === jpSel) return; jpSel = n; jpPick = {}; jpDc = 0; jpRid = ""; renderJpList(); body.scrollTop = 0; };
    });
    var j = jpLatest(jpSel);
    if (!j || j.status !== "open") return;
    function nDbl() { var c = 0; Object.keys(jpPick).forEach(function (k) { if (jpPick[k].length === 2) c++; }); return c; }
    function paint(i) { var v = jpPick[i] || ""; $$('[data-i="' + i + '"] button', body).forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-v") === v)); }); }
    function upd() {
      var nd = nDbl();
      $("#jpGo").textContent = "Enter " + money(jpPrice(j, nd)) + " (" + Object.keys(jpPick).length + "/" + j.size + ")";
      var d = $("#jpDbl"); if (d) d.textContent = nd + "/" + jpDc + " used";
      $$(".jp-pt [data-pn]", body).forEach(function (x) { var on = Number(x.getAttribute("data-pn")) === jpDc; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); });
      $$(".j3d button", body).forEach(function (b) { var i = b.parentNode.getAttribute("data-i"); b.disabled = nd >= jpDc && !(jpPick[i] && jpPick[i].length === 2); });
    }
    function setDc(n) {
      jpDc = n; var ks = Object.keys(jpPick).filter(function (k) { return jpPick[k].length === 2; }), dropped = 0;
      while (ks.length > n) { var k = ks.pop(); delete jpPick[k]; paint(k); dropped++; }
      $("#jerr").textContent = dropped ? dropped + (dropped > 1 ? " double picks were" : " double pick was") + " removed. Pick those matches again." : "";
      upd();
    }
    function setPick(i, v) {
      if (v.length === 2 && !(jpPick[i] && jpPick[i].length === 2) && nDbl() >= jpDc) { $("#jerr").textContent = jpDc ? "You chose " + jpDc + " double chance" + (jpDc > 1 ? "s" : "") + ". Raise the number above to use more." : "Choose how many double chances you want first."; return; }
      $("#jerr").textContent = ""; jpPick[i] = v; paint(i); upd();
    }
    $$(".jp-pt [data-pn]", body).forEach(function (b) { b.onclick = function () { setDc(Number(b.getAttribute("data-pn"))); }; });
    $$(".j3[data-i]", body).forEach(function (g) {
      g.onclick = function (e) { var b = e.target.closest ? e.target.closest("button") : null; if (b && !b.disabled) setPick(g.getAttribute("data-i"), b.getAttribute("data-v")); };
    });
    $("#jpQuick").onclick = function () {
      this.innerHTML = "&#128256; Shuffle again"; jpPick = {}; var dbls = {}, want = Math.min(jpDc, j.size);
      while (Object.keys(dbls).length < want) dbls[Math.floor(Math.random() * j.size)] = 1;
      for (var i = 0; i < j.size; i++) setPick(i, dbls[i] ? ["1X", "12", "X2"][Math.floor(Math.random() * 3)] : ["1", "X", "2"][Math.floor(Math.random() * 3)]);
    };
    $("#jpClear").onclick = function () { var old = Object.keys(jpPick); jpPick = {}; jpDc = 0; old.forEach(paint); $("#jerr").textContent = ""; upd(); };
    $("#jpGo").onclick = function () {
      var btn = this, err = $("#jerr");
      if (!S.user) { closeDlg($("#jpDlg")); openAuth("bet"); return; }
      if (Object.keys(jpPick).length < j.size) { err.textContent = "Pick all " + j.size + " matches."; return; }
      if (nDbl() !== jpDc) { err.textContent = "You chose " + jpDc + " double chance" + (jpDc === 1 ? "" : "s") + " but used " + nDbl() + ". Pick " + (jpDc - nDbl()) + " more, or change the number above."; return; }
      var picks = []; for (var i = 0; i < j.size; i++) picks.push(jpPick[i]);
      if ((Number(S.user.balance) || 0) < jpPrice(j, nDbl())) { closeDlg($("#jpDlg")); noFunds(); return; }
      btn.disabled = true; err.textContent = "";
      if (!jpRid) jpRid = "j" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      api({ action: "jpEnter", token: S.token, rid: jpRid, jp: j.id, picks: picks }).then(function (r) {
        btn.disabled = false;
        if (r.expired) { jpExpired(); return; }
        jpRid = "";
        if (!r.ok) { if (/not enough balance/i.test(r.error || "")) { closeDlg($("#jpDlg")); noFunds(); return; } err.textContent = r.error || "Could not enter."; return; }
        S.user.balance = r.balance; renderAcct(); toast("Entry placed. Good luck!"); jpPick = {}; jpDc = 0; loadJackpots();   // stays on the same jackpot, with fresh pool and entries
      }).catch(function () { btn.disabled = false; err.textContent = "Network problem. Tap Enter again; it will not double-charge."; });
    };
    upd();
  }
  function closeDlg(d) { if (typeof d.close === "function") d.close(); else d.removeAttribute("open"); }

  function refreshAll() { restoreSlip(); renderFilters(); renderKick(); renderList(); renderSlip(); renderSheet(); if (typeof NAV !== "undefined" && NAV && NAV.save) NAV.save(false); }

  /* ---------- events ---------- */
  document.addEventListener("click", function (e) {
    var t = e.target;
    function up(sel) { return t.closest ? t.closest(sel) : null; }
    var o = up(".odd"); if (o) { toggle(o.getAttribute("data-m"), o.getAttribute("data-mk"), o.getAttribute("data-l")); return; }
    var an = up("[data-ana]"); if (an) { toggleAna(an.getAttribute("data-ana")); return; }
    var mo = up("[data-more]"); if (mo) { openSheet(mo.getAttribute("data-more")); return; }
    var lg = up(".lg-h"); if (lg) { var n = lg.getAttribute("data-lg"); S.collapsed[n] = !S.collapsed[n]; renderList(); return; }
    var dy = up("[data-day]"); if (dy) { var nd = dy.getAttribute("data-day"); S.q = ""; var qi = $("#q"); if (qi) qi.value = ""; S.day = nd; S.shown = C.PAGE; refreshAll(); return; }
    var lc = up("[data-league]"); if (lc) { S.league = lc.getAttribute("data-league"); S.shown = C.PAGE; refreshAll(); return; }
    var gs = up("[data-mkt]"); if (gs && !up("[data-rm]")) { openSheet(gs.getAttribute("data-mkt")); return; }
    var rm = up("[data-rm]"); if (rm) { S.slip.delete(rm.getAttribute("data-rm")); renderSlip(); renderKick(); renderList(); renderSheet(); return; }
    var tb = up("[data-tab]"); if (tb) { S.sheetTab = tb.getAttribute("data-tab"); renderSheet(); return; }
    var qs = up("[data-stake]"); if (qs) { S.stake = qs.getAttribute("data-stake"); $("#stake").value = Number(S.stake).toLocaleString("en-KE"); store("q247.stake", S.stake); renderSlip(); return; }
    var af = up("[data-aff]"); if (af) { var di = up("dialog"); if (di) closeDlg(di); openAff(af.getAttribute("data-aff")); return; }
    var hg = up("[data-hw]");   /* buttons inside the bonus panel */
    if (hg) { var hk = hg.getAttribute("data-hw"); if (HW_TYPES[hk]) { openHow(hk); return; } closeDlg($("#hwDlg")); if (hk === "join") openAuth("join"); else if (hk === "login") openAuth("login"); else if (hk === "dep") openAuth("wallet"); else if (hk === "tab" && S.user) { acTab = "bonus"; acPar = "home"; renderAuth(); openDlg($("#authDlg")); } return; }
    var hh = up("[data-how]"); if (hh && !up(".delx,[data-del],[data-delall],#rfC,#rfL,input")) { openHow(hh.getAttribute("data-how")); return; }
    var inf = up("[data-info]"); if (inf) { openInfo(inf.getAttribute("data-info")); return; }
    var op = up("[data-open]"); if (op) { var w = op.getAttribute("data-open"); if (w === "jackpots") openJackpots(); else if (w === "predictor") openPredictor(); else if (w === "share") openShareEarn(); else if (w === "game" || w === "instant") openInstant(); else openBets(); return; }
    var so = up("[data-soon]"); if (so) { toast(so.getAttribute("data-soon") + " is coming soon."); return; }
    var au = up("[data-auth]"); if (au) { openAuth(au.getAttribute("data-auth")); return; }
    if (up("[data-close]")) { var dd = up("dialog"); if (dd) closeDlg(dd); return; }
    if (t.tagName === "DIALOG") { closeDlg(t); return; }
  });



  /* ---------- Instant Wins lobby: every title is locked for now ---------- */
  var IW_CATS = ["All", "Crash", "Instant", "Spinners", "Slots"];
  var IW_G = {
    rocket: '<path d="M12 3c3 2 5 5.5 5 9l-2.5 3h-5L7 12c0-3.5 2-7 5-9z"/><circle cx="12" cy="10" r="1.6"/><path d="M9.5 15 8 20l4-2 4 2-1.5-5"/>',
    chart: '<path d="M3 18l6-6 4 3 8-9"/><path d="M15 6h6v6"/>',
    balloon: '<ellipse cx="12" cy="9" rx="5.5" ry="6.5"/><path d="M12 15.5l-1.6 2.6h3.2zM12 18c0 2-1 3-2.4 3.4"/>',
    sevens: '<rect x="3" y="6" width="18" height="12" rx="3"/><text x="12" y="15" text-anchor="middle">777</text>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r=".9"/><circle cx="15" cy="9" r=".9"/><circle cx="12" cy="12" r=".9"/><circle cx="9" cy="15" r=".9"/><circle cx="15" cy="15" r=".9"/>',
    wheel: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2"/><path d="M12 3.5V10M12 14v6.5M3.5 12H10M14 12h6.5M6 6l4.6 4.6M13.4 13.4 18 18M18 6l-4.6 4.6M10.6 13.4 6 18"/>',
    coin: '<circle cx="12" cy="12" r="8.5"/><path d="M12 6.5v11M9.5 9.4c0-1 1-1.6 2.5-1.6s2.5.7 2.5 1.7-1 1.5-2.5 1.9-2.5.9-2.5 1.9 1 1.7 2.5 1.7 2.5-.6 2.5-1.6"/>',
    gem: '<path d="M6 4h12l3 5-9 11L3 9z"/><path d="M3 9h18M9 4 7 9l5 11 5-11-2-5"/>',
    ball: '<circle cx="12" cy="12" r="8.5"/><path d="m12 7.5 3.6 2.6-1.4 4.2H9.8L8.4 10.1z"/>',
    fruit: '<circle cx="8.5" cy="16" r="3.5"/><circle cx="16" cy="15" r="3.5"/><path d="M8.5 12.5C9 8 12 5 17 4M16 11.5C16 8 15.5 6 17 4"/>',
    crown: '<path d="M4 18h16M4 18 3 8l5 4 4-7 4 7 5-4-1 10z"/>',
    plinko: '<circle cx="12" cy="5" r="1"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><circle cx="6" cy="15" r="1"/><circle cx="12" cy="15" r="1"/><circle cx="18" cy="15" r="1"/><path d="M4 20h16"/>',
    tower: '<path d="M7 21V10l5-6 5 6v11zM7 15h10M12 21v-5"/>',
    bolt: '<path d="M13 3 5.5 13.2h5.3L10 21l8-10.4h-5.4z"/>',
    star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"/>'
  };
  var IW_COL = [["#5b1a8f", "#c02f9b"], ["#0a4d8c", "#17a2d8"], ["#8a1b1b", "#e5532e"], ["#0d5c3a", "#37c26b"], ["#7a4b00", "#f1a81c"], ["#2c2f8f", "#6c74f0"], ["#00606b", "#26c6c6"], ["#6b1240", "#e0457b"]];
  /* [name, category, glyph]. Original titles, shown as locked tiles */
  var IW_LIST = [
    ["Save My Girl", "Crash", "balloon", "247Bet Original"], ["Rocket Rush", "Crash", "rocket"], ["Sky Climber", "Crash", "chart"], ["Turbo Crash", "Crash", "bolt"], ["Gold Rush Crash", "Crash", "gem"], ["Moon Dash", "Crash", "star"],
    ["Balloon Blast", "Instant", "balloon"], ["Lucky Sevens", "Instant", "sevens"], ["Dice Duel", "Instant", "dice"], ["Coin Flip", "Instant", "coin"], ["Plinko Drop", "Instant", "plinko"], ["Gem Hunter", "Instant", "gem"], ["Penalty Shootout", "Instant", "ball"], ["Tower Climb", "Instant", "tower"],
    ["Lucky Wheel", "Spinners", "wheel"], ["Mega Wheel", "Spinners", "wheel"], ["Fruit Spinner", "Spinners", "fruit"], ["Gold Cup Spinner", "Spinners", "crown"], ["Safari Spinner", "Spinners", "star"], ["Beach Spinner", "Spinners", "coin"],
    ["Golden Pharaoh", "Slots", "crown"], ["Neon Fruits", "Slots", "fruit"], ["Dragon Fortune", "Slots", "gem"], ["Wild Safari", "Slots", "star"], ["Jackpot Express", "Slots", "sevens"], ["Treasure Cove", "Slots", "coin"]
  ];
  var iwCat = "All", iwTm = 0;
  function iwTile(g, i) {
    var c = IW_COL[i % IW_COL.length];
    return '<button type="button" class="iw-t" data-iw="' + esc(g[0]) + '" aria-label="' + esc(g[0]) + ', locked, not available in your country"><span class="iw-art" style="--a:' + c[0] + ';--b:' + c[1] + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + IW_G[g[2]] + '</svg><i class="iw-lock" aria-hidden="true">' + LOCKSVG + '</i><span class="iw-tag">' + esc(g[1]) + '</span></span><span class="iw-n">' + esc(g[0]) + '</span><span class="iw-p">' + esc(g[3] || "247Bet Games") + "</span></button>";
  }
  function renderInstant() {
    $("#iwChips").innerHTML = IW_CATS.map(function (c) { return '<button type="button" role="tab" data-iwc="' + c + '" aria-selected="' + (c === iwCat) + '" class="' + (c === iwCat ? "on" : "") + '">' + c + "</button>"; }).join("");
    var list = IW_LIST.map(function (g, i) { return [g, i]; }).filter(function (x) { return iwCat === "All" || x[0][1] === iwCat; });
    $("#iwBody").innerHTML = '<p class="iw-cnt">' + list.length + " games</p><div class=\"iw-grid\">" + list.map(function (x) { return iwTile(x[0], x[1]); }).join("") + "</div>" +
      '<p class="iw-note">18+ only. Play responsibly.</p>' +
      '<div id="iwMsg" class="iw-msg" role="status" hidden></div>';
  }
  function iwLock(name) {
    var box = $("#iwMsg"); if (!box) return;
    box.innerHTML = "<i>" + LOCKSVG + "</i><div><b>" + esc(name) + " is locked</b><small>Currently not available in your country. You can still bet on matches and play the jackpots.</small></div>";
    box.hidden = false; clearTimeout(iwTm); iwTm = setTimeout(function () { box.hidden = true; }, 6000);
  }
  function openInstant(name) {
    iwCat = "All"; renderInstant(); openDlg($("#iwDlg")); $("#iwBody").scrollTop = 0;
    if (name) iwLock(name);
  }
  $("#iwDlg").addEventListener("click", function (e) {
    var ch = e.target.closest("[data-iwc]"); if (ch) { iwCat = ch.getAttribute("data-iwc"); renderInstant(); return; }
    var t = e.target.closest("[data-iw]"); if (!t) return;
    t.classList.remove("shake"); void t.offsetWidth; t.classList.add("shake"); iwLock(t.getAttribute("data-iw"));
  });
  $("#iwDlg").addEventListener("close", function () { clearTimeout(iwTm); });

  /* ---------- Save My Girl (shared rounds, server-run) ---------- */
  var G = { r: null, prev: null, off: 0, raf: 0, poll: 0, mine: [], pts: [], ptsR: "", rate: 0.1, busy: {}, rid: {}, seen: {}, sig: "", px: 70, py: 218, open: false, fell: 0, t0: 0, ready: 0 };
  function gmFmt(x) { return (Math.floor(x * 100 + 1e-9) / 100).toFixed(2) + "x"; }
  function gmCls(x) { return x >= 10 ? "c3" : x >= 2 ? "c2" : "c1"; }
  function gmN2(v) { return Number(v).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function gmNow() { return Date.now() + G.off; }
  function gmPhase() { var r = G.r; if (!r) return "none"; if (r.phase === "paused") return "paused"; return gmNow() < r.flyAt ? "betting" : "flying"; }
  function gmMult() { var r = G.r; return r ? Math.max(1, Math.exp(G.rate * Math.max(0, gmNow() - r.flyAt) / 1000)) : 1; }
  function gmBet(s, round) { for (var i = G.mine.length - 1; i >= 0; i--) if (G.mine[i].slot === s && G.mine[i].round === round) return G.mine[i]; return null; }
  function gmPanel(s) { return $('#gameDlg .gm-p[data-slot="' + s + '"]'); }
  function gmMsg(s, t) { gmPanel(s).querySelector(".gm-msg").textContent = t || ""; }
  function gmBal() { var e = $("#gmBal"); if (e && S.user) e.textContent = money(S.user.balance); }
  var gmRA = renderAcct; renderAcct = function () { gmRA.apply(this, arguments); gmBal(); };
  function gmDraw(m, state) {
    var r = G.r, t = r ? Math.max(0, (gmNow() - r.flyAt) / 1000) : 0, px = 70 + Math.min(250, t * 14), py = 218 - Math.min(55, Math.log(m) * 26), st = $("#gmGirl").style, bu = $("#gmBurst");
    if (state === "fly") { G.px = px; G.py = py; if (!G.pts.length || t - G.pts[G.pts.length - 1][2] > 0.12) G.pts.push([px, py, t]); }
    if (state === "crash") {
      if (!G.fell) { G.fell = 1; st.transition = "transform .9s cubic-bezier(.4,0,1,1)"; st.transform = "translate(" + G.px + "px,285px) rotate(28deg)"; bu.setAttribute("transform", "translate(" + (G.px + 14) + " " + (G.py - 124) + ")"); bu.style.display = "block"; bu.classList.remove("on"); void bu.getBoundingClientRect(); bu.classList.add("on"); }
    } else { G.fell = 0; bu.style.display = "none"; st.transition = "none"; st.transform = "translate(" + (state === "idle" ? 70 : px) + "px," + (state === "idle" ? 218 : py) + "px)"; }
    $("#gmBalloon").style.display = state === "crash" ? "none" : "";
    var p = G.pts.length ? G.pts.map(function (q) { return q[0].toFixed(1) + " " + q[1].toFixed(1); }).join(" L") : "", last = G.pts.length ? G.pts[G.pts.length - 1][0].toFixed(1) : 0, show = p && state !== "idle";
    $("#gmCurve").setAttribute("d", show ? "M" + p : ""); $("#gmFill").setAttribute("d", show ? "M" + p + " L" + last + " 252 L" + G.pts[0][0].toFixed(1) + " 252Z" : "");
  }
  function gmFrame() {
    var r = G.r; if (!r || !G.open) { G.raf = 0; return; }
    var ph = gmPhase(), now = gmNow(), x = $("#gmX"), sub = $("#gmSub"), bar = $("#gmBar");
    if (ph === "flying" && G.ptsR !== r.id) { G.pts = []; G.ptsR = r.id; G.px = 70; G.py = 218; }
    if (ph === "betting") {
      if (G.prev && now < r.bettingAt) { sub.textContent = "BALLOON POPPED!"; x.textContent = gmFmt(G.prev.crash); x.className = "gm-x pop"; bar.style.width = "0"; gmDraw(1, "crash"); }
      else { sub.textContent = "NEXT ROUND"; x.textContent = Math.max(0, Math.ceil((r.flyAt - now) / 1000)) + "s"; x.className = "gm-x wait"; bar.style.width = Math.max(0, Math.min(100, (r.flyAt - now) / (r.flyAt - r.bettingAt) * 100)) + "%"; gmDraw(1, "idle"); }
    } else if (ph === "flying") { var m = gmMult(); sub.textContent = ""; x.textContent = gmFmt(m); x.className = "gm-x " + gmCls(m); bar.style.width = "0"; gmDraw(m, "fly"); }
    else { sub.textContent = "GAME PAUSED"; x.textContent = r.crash ? gmFmt(r.crash) : "--"; x.className = "gm-x pop"; bar.style.width = "0"; gmDraw(1, "crash"); }
    gmBtns(ph); G.raf = requestAnimationFrame(gmFrame);
  }
  function gmBtns(ph) {
    ["A", "B"].forEach(function (s) {
      var p = gmPanel(s), b = p.querySelector(".gb"), bet = G.r ? gmBet(s, G.r.id) : null, dis = !!G.busy[s], txt, cls = "";
      if (ph === "betting" && bet && bet.status === "open") { txt = "Cancel\n" + gmN2(bet.stake) + " KES"; cls = "cancel"; }
      else if (ph === "betting" && !bet) { txt = "Bet\n" + gmN2(parseFloat(p.querySelector(".gs").value.replace(/,/g, "")) || 0) + " KES"; }
      else if (ph === "flying" && bet && bet.status === "open") { txt = "Cash out\n" + gmN2(Math.floor(bet.stake * gmMult() * 100 + 1e-9) / 100) + " KES"; cls = "cash"; }
      else if (bet && bet.status === "won") { txt = "Saved!\n+" + gmN2(bet.payout) + " KES"; dis = true; cls = "won"; }
      else if (bet && bet.status === "lost") { txt = "Popped\n" + (G.prev ? gmFmt(G.prev.crash) : ""); dis = true; cls = "lost"; }
      else { txt = ph === "flying" ? "Waiting\nnext round" : "Wait"; dis = true; }
      if (b.textContent !== txt) b.textContent = txt; b.disabled = dis; b.className = "btn wide gb " + cls;
    });
  }
  function gmAv(w) { return '<span class="av">' + esc(String(w).charAt(0).toUpperCase()) + "</span>"; }
  function gmTable(a) {
    return '<div class="gm-r gm-rh"><span>Player</span><span>Bet KES</span><span>X</span><span>Win KES</span></div>' + (a.length ? a.map(function (x) { return '<div class="gm-r ' + x.st + '"><span>' + gmAv(x.who) + esc(x.who) + " " + x.slot + "</span><span>" + gmN2(x.stake) + '</span><span class="' + (x.st === "won" ? gmCls(x.x) : "") + '">' + (x.st === "won" ? gmFmt(x.x) : "") + "</span><span>" + (x.st === "won" ? gmN2(x.pay) : x.st === "lost" ? "0.00" : "") + "</span></div>"; }).join("") : '<p class="m">No bets yet.</p>');
  }
  function gmTop(a) {
    return a.length ? a.map(function (x) { return '<div class="gm-tc">' + gmAv(x.who) + "<div><b>" + esc(x.who) + "</b><small>" + new Date(x.at).toLocaleDateString("en-KE") + '</small></div><div class="gm-tm"><small>Bet</small> ' + gmN2(x.stake) + "<br><small>Win</small> " + gmN2(x.pay) + '</div><span class="gm-xc ' + gmCls(x.x) + '">' + gmFmt(x.x) + "</span></div>"; }).join("") : '<p class="m">Top cash-outs appear here after rounds are played.</p>';
  }
  function gmMy() {
    if (!S.token) return;
    api({ action: "myGames", token: S.token }).then(function (r) {
      if (!r.ok) return;
      $("#gmMine").innerHTML = r.rounds.length ? r.rounds.map(function (x) {
        return '<div class="gm-gh"><span>Round ' + esc(x.round.slice(1)) + " <small>" + new Date(x.at).toLocaleString("en-KE", { dateStyle: "short", timeStyle: "short" }) + "</small></span><span>" + (x.crash ? "Popped at " + gmFmt(x.crash) : "In play") + "</span></div>" +
          x.bets.map(function (y) { return '<div class="gm-r ' + y.status + '"><span>Bet ' + y.slot + (y.auto ? " (auto " + gmFmt(y.auto) + ")" : "") + "</span><span>" + gmN2(y.stake) + "</span><span>" + (y.status === "won" ? gmFmt(y.cashAt) : y.status === "lost" ? "lost" : "...") + "</span><span>" + (y.status === "won" ? gmN2(y.payout) : "") + "</span></div>"; }).join("");
      }).join("") : '<p class="m">Your bets appear here. The latest 50 rounds are kept.</p>';
    }).catch(function () {});
  }
  function gmRender(r) {
    var chips = r.recent.map(function (x) { return '<span class="' + gmCls(x) + '">' + gmFmt(x) + "</span>"; }).join("");
    $("#gmRecent").innerHTML = chips; $("#gmHistAll").innerHTML = chips || '<p class="m">No rounds yet.</p>';
    $("#gmAll").innerHTML = '<div class="gm-cnt">All bets <b>' + r.bets.length + "</b></div>" + gmTable(r.bets);
    $("#gmPrev").innerHTML = (r.prev ? '<div class="gm-res">Round result <b class="' + gmCls(r.prev.crash) + '">' + gmFmt(r.prev.crash) + "</b></div>" : "") + gmTable(r.pbets);
    $("#gmTop").innerHTML = '<div class="gm-cnt">Highest cash-outs <b>' + (r.top || []).length + "</b></div>" + gmTop(r.top || []);
    if (!$("#gmMine").hidden) gmMy();
    var tk = $("#gmTick"), w = r.wins || []; tk.hidden = !w.length;
    tk.innerHTML = w.length ? '<div class="gm-tr">' + w.concat(w).map(function (x) { return "<span><b>" + esc(x.who) + "</b> cashed out at " + gmFmt(x.x) + " and won <b>" + money(x.pay) + "</b></span>"; }).join("") + "</div>" : "";
    $("#gmFair").innerHTML = "Round hash: <code>" + r.round.hash.slice(0, 20) + "...</code>" + (r.prev ? "<br>Last round seed: <code>" + r.prev.seed + "</code><br>Last round hash: <code>" + r.prev.hash + "</code>" : "") + "<br>The seed is revealed after each round. SHA-256 of the seed must equal the hash shown before the round.";
  }
  function gmReady() {
    if (G.ready) return; G.ready = 1;
    setTimeout(function () { var l = $("#gmLoad"); l.classList.add("out"); setTimeout(function () { l.hidden = true; }, 500); }, Math.max(0, 350 - (Date.now() - G.t0)));
  }
  function gmApply(r) {
    if (r.expired) { gmStop(); closeDlg($("#gameDlg")); setSession("", null); openAuth("bet"); return; }
    if (!r.ok) return;
    G.off = r.serverNow - Date.now(); G.r = r.round; G.prev = r.prev || (r.round.phase === "paused" ? { crash: r.round.crash } : null); G.rate = r.round.rate || G.rate;
    if (r.mine) { r.mine.forEach(function (x) { if (x.status === "won" && !G.seen[x.id]) { G.seen[x.id] = 1; if (G.sync) toast("Saved! " + gmFmt(x.cashAt) + " won " + money(x.payout)); } else if (x.status !== "open") G.seen[x.id] = 1; }); G.mine = r.mine; G.sync = 1; }
    if (r.balance !== undefined && S.user) { S.user.balance = r.balance; renderAcct(); }
    var sig = JSON.stringify([(r.wins || []).length, (r.top || []).length, r.round.id, r.recent[0], r.bets.length, r.pbets.length, G.mine.map(function (x) { return x.id + x.status; })]);
    if (sig !== G.sig) { G.sig = sig; gmRender(r); }
    gmReady();
  }
  function gmStop() { cancelAnimationFrame(G.raf); clearTimeout(G.poll); G.raf = 0; G.poll = 0; }
  function gmPoll() {
    clearTimeout(G.poll); if (!G.open) return;
    if (G.inflight) { G.again = 1; return; }   // one poll at a time: piling requests on a busy server makes it slower for everybody
    G.inflight = 1; G.again = 0;
    var t0 = Date.now();
    api({ action: "gameRound", token: S.token }).then(function (r) { G.fails = 0; gmApply(r); }).catch(function () { G.fails = Math.min((G.fails || 0) + 1, 4); $("#gmSub").textContent = "Reconnecting..."; }).then(function () {
      G.inflight = 0; if (!G.open) return; if (!G.raf) G.raf = requestAnimationFrame(gmFrame);
      var base = document.hidden ? 5000 : gmPhase() === "flying" ? 700 : 1200, slow = Date.now() - t0 > 2500 ? 1000 : 0;
      G.poll = setTimeout(gmPoll, G.again ? 150 : base + slow + (G.fails || 0) * 1500 + Math.floor(Math.random() * 250));
    });
  }
  function openGame() { openInstant("Save My Girl"); }      /* locked: Save My Girl is not available in your country. The live code below is kept for when it is switched back on */
  function openGameLive() {
    if (DEMO) { toast("Set API_URL to play."); return; }
    if (!S.user) { openAuth("bet"); return; }
    G.open = true; G.sig = ""; G.sync = 0; G.r = null; G.ready = 0; G.t0 = Date.now(); gmBal();
    var l = $("#gmLoad"); l.hidden = false; l.classList.remove("out"); $("#gmLoadMsg").textContent = "Initializing";
    setTimeout(function () { if (!G.ready) $("#gmLoadMsg").textContent = "Still connecting"; }, 7000);
    openDlg($("#gameDlg")); gmMsg("A", ""); gmMsg("B", ""); gmPoll();
  }
  function gmAct(s) {
    var p = gmPanel(s), ph = gmPhase(), bet = G.r ? gmBet(s, G.r.id) : null; if (G.busy[s] || !G.r) return;
    var done = function (r) {
      G.busy[s] = 0; if (r.expired) { gmApply(r); return; }
      if (!r.ok) { gmMsg(s, r.error || "Something went wrong."); return; }
      if (r.balance !== undefined) { S.user.balance = r.balance; renderAcct(); }
      gmPoll();
    }, fail = function () { G.busy[s] = 0; gmMsg(s, "Network problem. Tap again; it will not double-charge."); };
    if (ph === "flying" && bet && bet.status === "open") { G.busy[s] = 1; api({ action: "gameCash", token: S.token, slot: s, round: G.r.id }).then(done, fail); return; }
    if (ph === "betting" && bet && bet.status === "open") { G.busy[s] = 1; api({ action: "gameCancel", token: S.token, slot: s }).then(done, fail); return; }
    if (ph !== "betting") return;
    var stake = parseFloat(p.querySelector(".gs").value.replace(/,/g, "")), av = p.querySelector(".ga").value, auto = parseFloat(av);
    if (!(stake >= 10)) { gmMsg(s, "Minimum stake is KES 10."); return; }
    if (stake > 150000) { gmMsg(s, "Maximum stake is KES 150,000."); return; }
    if (av && !(auto >= 1.1)) { gmMsg(s, "Auto cash-out must be 1.10x or more."); return; }
    gmMsg(s, ""); G.busy[s] = 1;
    if (!G.rid[s]) G.rid[s] = "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    api({ action: "gameBet", token: S.token, slot: s, rid: G.rid[s], stake: stake, auto: av ? auto : 0 }).then(function (r) {
      if (r.ok) { G.rid[s] = ""; if (!r.duplicate) G.mine.push({ id: "t" + Date.now(), round: r.round, slot: s, stake: stake, auto: auto || 0, status: "open" }); }
      done(r);
    }, fail);
  }
  $("#gameDlg").addEventListener("click", function (e) {
    var t = e.target, p = t.closest && t.closest(".gm-p"), tab = t.closest && t.closest("[data-gmtab]");
    if (t.closest && t.closest("#gmHistBtn")) { var hp = $("#gmHistPanel"), hb = $("#gmHistBtn"); hp.hidden = !hp.hidden; hb.setAttribute("aria-expanded", String(!hp.hidden)); return; }
    if (tab) { var id = tab.getAttribute("data-gmtab"); $$("#gameDlg [data-gmtab]").forEach(function (b) { b.classList.toggle("on", b === tab); }); $$("#gameDlg .gm-list").forEach(function (l) { l.hidden = l.id !== id; }); if (id === "gmMine") gmMy(); return; }
    if (!p) return;
    if (t.classList.contains("gb")) { gmAct(p.getAttribute("data-slot")); return; }
    var i = p.querySelector(".gs"), v = parseFloat(i.value.replace(/,/g, "")) || 0;
    if (t.hasAttribute("data-gs")) i.value = t.getAttribute("data-gs");
    else if (t.getAttribute("data-gm") === "m") i.value = Math.max(10, v - 10);
    else if (t.getAttribute("data-gm") === "p") i.value = Math.min(150000, v + 10);
  });
  $("#gameDlg").addEventListener("close", function () { G.open = false; gmStop(); });
  document.addEventListener("visibilitychange", function () { if (G.open && !document.hidden) gmPoll(); });


  /* ---------- Affiliate programme ---------- */
  /* ---------- 247BET AFFILIATE PROGRAM: contract text (version v1.2), used in the application form and the Affiliates page ---------- */
  var AFF_VER = "v1.4";
  /* ---- Affiliate Pack 1: earnings calculator, FAQ and tier progress bar (rules mirror the contract, section 5 and 6) ---- */
  function affCalcVals(p, n) {
    p = Math.max(0, Math.min(100000, Math.floor(Number(p) || 0))); n = Math.max(0, Math.min(10000000, Number(n) || 0));
    var rate = p >= 25 ? 45 : p >= 10 ? 35 : 25, min = rate >= 45 ? 3500 : rate >= 35 ? 2500 : 1500, gate = rate >= 45 ? 10 : rate >= 35 ? 6 : 3;
    var month = p * n * rate / 100, week = month * 7 / 30, note = "";
    if (p === 0 || n === 0) note = "Enter the number of players and their average net revenue to see an estimate.";
    else {
      note = week < min ? "At this level the weekly estimate is below the weekly minimum of KES " + k0(min) + ", so it is held and rolls over until the total passes it." : "At this level the weekly estimate is above the weekly minimum of KES " + k0(min) + ".";
      note += " You also need at least " + gate + " referred players who staked in the last 7 days.";
    }
    return { rate: rate, min: min, month: month, week: week, note: note };
  }
  function affCalc() {
    var v = affCalcVals(10, 1000);
    return "<div class='afc'><b>Earnings calculator</b>" +
      "<label>Active players you expect to have (played in the last 30 days)<input class='afc-i' data-c='p' type='number' inputmode='numeric' min='0' max='100000' value='10'></label>" +
      "<label>Average net revenue per active player per month (KES)<input class='afc-i' data-c='n' type='number' inputmode='numeric' min='0' value='1000'></label>" +
      "<div class='afc-o'><div><b data-o='rate'>" + v.rate + "%</b><span>Your rate</span></div><div><b data-o='week'>KES " + k0(v.week) + "</b><span>About per week</span></div><div><b data-o='month'>KES " + k0(v.month) + "</b><span>About per month</span></div><div><b data-o='min'>KES " + k0(v.min) + "</b><span>Weekly minimum payout</span></div></div>" +
      "<small data-o='note'>" + esc(v.note) + "</small>" +
      "<small>An example only. Net revenue is stakes lost minus winnings minus bonus money released. It can be low or negative in a month, and then nothing is paid until it recovers. This is not a promise of income.</small></div>";
  }
  document.addEventListener("input", function (e) {
    var el = e.target; if (!el || !el.classList || !el.classList.contains("afc-i")) return;
    var box = el.closest(".afc"); if (!box) return;
    var pi = box.querySelector("[data-c='p']"), ni = box.querySelector("[data-c='n']"), v = affCalcVals(pi.value, ni.value);
    var set = function (k, t) { var o = box.querySelector("[data-o='" + k + "']"); if (o) o.textContent = t; };
    set("rate", v.rate + "%"); set("week", "KES " + k0(v.week)); set("month", "KES " + k0(v.month)); set("min", "KES " + k0(v.min)); set("note", v.note);
  });
  function affFaq() {
    var Q = [
      ["What is the 247Bet affiliate programme?", "You promote 247Bet to adults and earn a share of the net revenue of the players who sign up through your link or code. It is free to join and every application is reviewed by us."],
      ["How do I become an affiliate?", "Register a 247Bet player account first, because your earnings are paid into it. Then open <b>Affiliates</b> from the menu, read the agreement, fill in the form and sign. We review every application and tell you the result in your Inbox."],
      ["Do I need a website?", "No. Many affiliates use WhatsApp groups, Telegram, Facebook, Instagram, TikTok, YouTube, X or a tipster community. You tell us your main channel when you apply."],
      ["How much can I earn?", "Revenue share starts at <b>25%</b> and grows to <b>35%</b> with 10 active players and <b>45%</b> with 25 or more (active means the player staked in the last 30 days). You also earn 5% of the commission of affiliates you recruit. A fixed fee per depositing player (CPA), or a mix of both, is available on request."],
      ["What is net revenue?", "Stakes lost, minus winnings, minus bonus money released, from the players you refer. It is counted cumulatively, so if players win more than they lose in a month, the shortfall carries forward and nothing is paid until it recovers."],
      ["When and how do I get paid?", "Every Tuesday between 13:00 and 14:00 East Africa time, automatically, into your 247Bet wallet, after we approve your earnings on Monday or Tuesday morning. The weekly minimum is KES 1,500 at 25%, KES 2,500 at 35% and KES 3,500 at 45%, with at least 3, 6 and 10 referred players who staked in the last 7 days. Smaller amounts roll over to the next Tuesday. From your wallet you withdraw under the usual withdrawal rules."],
      ["Do the players I bring stay assigned to me?", "Yes. Players who register with your link or approved code are attributed to you with no expiry date, for as long as your affiliate account stays active and in good standing. Players who share a device with you never count."],
      ["How can I promote 247Bet?", "Use your personal link, your promo code, campaign links (one for each video, group or page, each with its own results), the QR code, ready-made messages and banners in the Tools tab, and slip sharing where it is available to you. Always show 18+ and a responsible gambling message."],
      ["Can I see my results?", "Yes. Your dashboard shows clicks, sign-ups, depositors, active players, conversion, earnings per click, net revenue, earnings and payouts, plus a funnel from clicks to sign-ups to depositors for today, 7 days or 30 days, your players with a date filter and CSV download, results for each campaign with your best one highlighted, and a monthly statement you can download."],
      ["What is not allowed?", "Promoting to anyone under 18, guaranteed-win or risk-free claims, fake sign-ups, self-referrals, duplicate accounts and accounts on your own device. Breaches can lead to withheld commission or suspension. Read the full agreement below."]
    ];
    return "<div class='faq'>" + Q.map(function (x) { return "<details><summary>" + x[0] + "</summary><div>" + x[1] + "</div></details>"; }).join("") + "</div>";
  }
  function affProg(r, st) {
    var a = Number(st.active) || 0;
    if (!r.nextTier) return "<div class='aff-pgw'><b>You are on the top rate of " + r.maxRate + "%</b><small>You have " + a + " active player" + (a === 1 ? "" : "s") + " (played in the last 30 days). Keep them active to stay on this rate.</small></div>";
    var T = Number(r.nextTier.active) || 1, pct = Math.max(0, Math.min(100, Math.round(a / T * 100)));
    var msg = a >= T ? "You have " + a + " active players, enough for " + r.nextTier.rate + "%. Rates are reviewed weekly, so your rate moves up at the next review." : a + " of " + T + " active players. " + (T - a) + " more to reach " + r.nextTier.rate + "%.";
    return "<div class='aff-pgw'><b>Next rate: " + r.nextTier.rate + "%</b><div class='aff-pg' role='progressbar' aria-valuemin='0' aria-valuemax='100' aria-valuenow='" + pct + "' aria-label='Progress to the next rate'><i style='width:" + pct + "%'></i></div><small>" + msg + "</small></div>";
  }
  function affSummary() {
    return '<div class="ct-sum"><b>In short</b><ul><li>Revenue share starts at <b>25%</b> and grows with time and active players up to a maximum of <b>45%</b>.</li><li>You need a 247Bet <b>player account</b>. All earnings are paid <b>automatically every Tuesday (13:00 to 14:00 East Africa time)</b> into that wallet.</li><li>Minimum weekly payout is <b>KES 1,500</b> at 25%, <b>KES 2,500</b> at 35% and <b>KES 3,500</b> at 45%, and you need <b>3 / 6 / 10</b> referred players who staked in the last 7 days. There is no weekly cap. Held amounts roll over to the next Tuesday.</li><li>Every application is reviewed by us before you earn.</li></ul></div>' +
      '<div class="ct-tier"><div><b>25%</b>0 to 9 active</div><div><b>35%</b>10 to 24</div><div><b>45%</b>25 or more</div></div>';
  }
  function affContract() {
    return '<div class="ct-box" tabindex="0"><h4>247BET AFFILIATE PROGRAM: TERMS AND AGREEMENT (' + AFF_VER + ')</h4>' +
      '<h4>1. The programme</h4>You (the "Affiliate") promote 247Bet to adults and earn commission on qualifying players who sign up through your link or code. By signing you accept these terms.' +
      '<h4>2. Eligibility and player account</h4>You must be 18 or older and hold a 247Bet player account. Your player account is where your earnings are paid, so an affiliate without a player account cannot be approved.' +
      '<h4>3. Review and approval</h4>Every application is reviewed. We may approve, reject or suspend any affiliate. On approval we set your starting rate and tell you in your Inbox.' +
      '<h4>4. Commission</h4>Revenue share is a percentage of the net revenue of players you refer (stakes lost, minus winnings, minus bonus money released). It is calculated on cumulative net revenue, so a negative month carries forward and nothing is paid until it recovers. Where agreed, a CPA (a fixed fee per depositing player) applies, and you earn 5% of the commission of affiliates you recruit. Players sharing a device with you never count.' +
      '<h4>5. Revenue share rate</h4>The minimum rate is 25%. It grows with time and performance up to a maximum of 45%: 25% with 0 to 9 active players (played in the last 30 days), 35% with 10 to 24 and 45% with 25 or more. Rates are reviewed weekly and only move up while you remain in good standing. No rate above 45% applies. A new rate applies to net revenue made from the day it starts; what you earned at the earlier rate is kept.' +
      '<h4>6. Payment</h4>All earnings are paid automatically every Tuesday, between 13:00 and 14:00 East Africa time, straight into your 247Bet player wallet. Earnings are reviewed and approved by us on Monday or Tuesday morning before they are credited; only approved earnings are paid, and anything not approved rolls over to the next Tuesday. Nothing is paid by M-Pesa directly and there is no payout request. The minimum weekly payout is KES 1,500 at the 25% rate, KES 2,500 at 35% and KES 3,500 at 45%, and at least 3, 6 and 10 respectively of your referred players must have staked in the last 7 days; there is no weekly cap, and any amount held back rolls over to the next Tuesday. Each payout is recorded once in your wallet history and Inbox. Once paid, earnings are normal wallet money and the usual wallet and withdrawal rules and fees apply.' +
      '<h4>7. Prohibited conduct</h4>No promotion to anyone under 18. No guaranteed-win or risk-free claims. No fake sign-ups, self-referrals, duplicate accounts, bots, incentivised sign-ups or accounts on the same device as yours. Advertising must be clearly marked, show 18+ and a responsible gambling message. Breaches can lead to withheld commission, suspension and removal. Commission earned through fraud, fake or reversed deposits, chargebacks or any breach can be reclaimed by deducting it from your earnings.' +
      '<h4>8. Termination</h4>Either side may end this agreement at any time. We may suspend or terminate immediately for a breach. Earnings already earned in good standing and above the minimum are paid on the next Tuesday run; commission linked to a breach may be withheld. If none of your referred players has been active for 90 days we may suspend or end this agreement.' +
      '<h4>9. Tax</h4>You are responsible for any tax due on your earnings.' +
      '<h4>10. Data</h4>We use the details you provide to review your application, run the programme and pay you. Your signature, the time and the contract version are stored with your application.' +
      '<h4>11. Changes</h4>We may update these terms. The version you signed is stored; material changes will be shown in your Inbox.' +
      '<h4>12. Promo codes</h4>You may propose a promo code of 3 to 12 letters or numbers. 247BET approves, changes or refuses any code, and codes remain the property of 247BET. A code must not mislead, imitate another brand or contain offensive words. Players who register with your approved code or link are attributed to you.' +
      '<h4>13. General</h4>247BET AFFILIATE PROGRAM. All rights reserved. This agreement does not make you an employee, partner or agent of 247Bet.</div>';
  }
  var affMode = "", affAfterLogin = "";
  /* mode: "apply" (Apply now button) or "dash" (Open dashboard button). Either way the account is checked first:
     a registered affiliate gets the dashboard, anyone else gets the application form opened straight away. */
  function openAff(mode) {
    affMode = (mode === "apply" || mode === "dash") ? mode : "";
    if (DEMO) { toast("Set API_URL to use the affiliate programme."); return; }
    if (!S.user) {
      affAfterLogin = affMode || "dash";
      openAuth("bet"); authNote = affMode === "apply" ? "Log in to apply as an affiliate." : "Log in to open your affiliate dashboard."; renderAuth();
      return;
    }
    var body = $("#affBody"); $("#affTitle").textContent = "Affiliate programme";
    body.innerHTML = "<p><span class=skl></span><span class=skl2></span><span class=skl3></span></p>"; openDlg($("#affDlg"));
    api({ action: "affInfo", token: S.token }).then(function (r) {
      if (r.expired) { closeDlg($("#affDlg")); setSession("", null); affAfterLogin = affMode || "dash"; openAuth("bet"); return; }
      if (!r.ok) { body.innerHTML = "<p>" + esc(r.error || "Could not load.") + "</p>"; return; }
      renderAff(r);
    }).catch(function () { body.innerHTML = "<p>Network problem. Try again.</p>"; });
  }
  function renderAff(r) {
    var b = $("#affBody"), mode = affMode, aNote = "", tt = $("#affTitle");
    affMode = "";
    if (r.status === "none" || r.status === "rejected") {
      tt.textContent = "Apply as an affiliate";
      var chk = function (id, t) { return '<label class="chk"><input id="' + id + '" type="checkbox"><span>' + t + '</span></label>'; };
      var goNote = (mode === "dash" && r.status === "none") ? '<p class="bn-note"><b>No affiliate account found.</b> This 247Bet account is not registered as an affiliate yet, so the application is open below. Fill it in and sign to get started.</p>' : "";
      b.innerHTML = (r.status === "rejected" ? '<p class="bn-note"><b>Your earlier application was not approved.</b> You can apply again below; your new application replaces the old one.</p>' : "") + "<p>Earn by introducing adult players to 247Bet. Read the agreement, fill in the form and sign. We review every application.</p>" + affSummary() + affCalc() +
        '<div id="affGo">' + goNote + '</div><form id="affForm" class="af" novalidate><b>Agreement</b>' + affContract() +
        '<b style="margin-top:6px">Your details</b>' +
        '<label>Full name<input id="afFn" type="text" maxlength="80" value="' + esc(r.name || "") + '" autocomplete="name"></label>' +
        '<label>Phone number<input id="afPh" type="text" readonly value="' + esc(r.phone || "") + '"></label>' +
        '<label>247Bet account number<input id="afAc" type="text" readonly value="' + esc(r.acct || "") + '"></label>' +
        '<label>Website or social page (optional)<input id="afW" type="text" maxlength="120" placeholder="https://"></label>' +
        '<label>Your channel or audience<textarea id="afN" maxlength="160" placeholder="Where will you promote 247Bet?"></textarea></label>' +
        '<label>Estimated audience size<input id="afS" type="number" inputmode="numeric" min="0" placeholder="e.g. 5000"></label>' +
        '<label>Main traffic source<select id="afT2"><option value="">Choose...</option><option>WhatsApp groups</option><option>Telegram</option><option>Facebook</option><option>Instagram</option><option>TikTok</option><option>YouTube</option><option>X (Twitter)</option><option>Website or blog</option><option>Tipster community</option><option>Other</option></select></label>' +
         '<label>Country<select id="afCo"><option value="">Choose...</option><option>Kenya</option><option>Uganda</option><option>Tanzania</option><option>Rwanda</option><option>Nigeria</option><option>Ghana</option><option>South Africa</option><option>Ethiopia</option><option>Egypt</option><option>Zambia</option><option>United Kingdom</option><option>Ireland</option><option>Other</option></select></label>' +
         '<label>Proposed promo code (optional, 3 to 12 letters or numbers)<input id="afPc" type="text" maxlength="12" autocapitalize="characters" placeholder="e.g. ' + esc((r.code || "MYCODE")) + '"></label>' +
        '<label>Recruiter code (optional)<input id="afR" type="text" maxlength="12" autocapitalize="characters"></label>' +
        '<b style="margin-top:6px">Declarations</b>' +
        chk("afD1", "I am 18 years or older.") + chk("afD2", "I will promote 247Bet to adults only.") + chk("afD3", "I will make no guaranteed-win or risk-free claims.") + chk("afD4", "I will use no fake sign-ups or self-referrals.") +
        chk("afD5", "I accept the 247BET Affiliate Program terms (" + AFF_VER + ").") + chk("afD6", "I understand all affiliate earnings are paid automatically every Tuesday into my 247Bet player wallet, so a player account is required.") +
        '<label>Sign by typing your full name<input id="afSg" type="text" maxlength="80" autocomplete="off" placeholder="Type your full name"></label>' +
        '<p id="afE" class="aerr" role="alert"></p><button type="submit" class="btn lime wide">Sign and submit application</button></form>';
      if (mode) setTimeout(function () { var g = $("#affGo"); try { if (g) g.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) { if (g) g.scrollIntoView(); } }, 80);
      $("#affForm").onsubmit = function (e) {
        e.preventDefault(); var btn = $("#affForm button[type=submit]"); btn.disabled = true; $("#afE").textContent = "";
        var T = function (id) { return $("#" + id).checked; };
        var form = { fullName: $("#afFn").value, website: $("#afW").value, channel: $("#afN").value, audience: $("#afS").value, source: $("#afT2").value, recruiter: $("#afR").value, promo: $("#afPc").value, signature: $("#afSg").value,
          over18: T("afD1"), adult: T("afD2"), noclaims: T("afD3"), noself: T("afD4"), terms: T("afD5"), tuesday: T("afD6"),
          country: $("#afCo").value, ver: AFF_VER, text: ($("#affForm .ct-box") || {}).innerText || "", dev: (function () { try { return devId(); } catch (e) { return ""; } })(), ua: (navigator.userAgent || "").slice(0, 200), tz: (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; } })() };
        if (!form.country) { btn.disabled = false; $("#afE").textContent = "Choose your country."; return; }
        api({ action: "affApply", token: S.token, form: form }).then(function (x) {
          btn.disabled = false; if (x.expired) { closeDlg($("#affDlg")); setSession("", null); openAuth("bet"); return; }
          if (!x.ok) { $("#afE").textContent = x.error || "Could not apply."; return; }
          toast("Application sent."); openAff();
        }).catch(function () { btn.disabled = false; $("#afE").textContent = "Network problem. Try again."; });
      };
      return;
    }
    tt.textContent = r.status === "pending" ? "Application received" : "Affiliate dashboard";
    if (mode === "apply" && r.status === "approved") aNote = '<p class="bn-note"><b>You are already an approved affiliate.</b> Here is your dashboard.</p>';
    if (r.status === "pending") { b.innerHTML = '<p class="bn-note"><b>Application received.</b> We are reviewing it and will set your starting rate (25% to begin, growing up to 45%). You will get a message in your Inbox.</p>'; return; }
    var st = r.stats, link = location.origin + location.pathname.replace(/index\.html$/, "") + "?ref=" + r.code;
    var terms = [r.rate ? r.rate + "% revenue share" : "", r.cpa ? "KES " + k0(r.cpa) + " per depositing player" : ""].filter(Boolean).join(" + ");
    b.innerHTML = aNote + (r.status === "suspended" ? '<p class="bn-note"><b>Your affiliate account is suspended.</b> Contact support.</p>' : "") +
      '<p class="mt">Your terms: <b>' + esc(terms) + "</b>" + (r.override ? " &middot; plus " + r.override + "% of the affiliates you recruit" : "") + "</p>" +
      '<p class="mt" style="margin-top:8px">Your link</p><div class="aff-l"><input id="afL" readonly value="' + esc(link) + '"><button type="button" id="afC" class="btn ghost">Copy</button></div>' +
      '<p class="mt" style="margin-top:4px">Recruiter code for new affiliates: <b>' + esc(r.code) + "</b></p>" +
      '<div class="aff-k">' + [["Clicks", st.clicks], ["Registrations", st.registrations], ["Depositors", st.depositors], ["Active players (30d)", st.active], ["Conversion", st.conversion + "%"], ["Earnings per click", money(st.epc)],
        ["Net revenue", money(st.netRevenue)], ["Earned", money(st.earned)], ["Paid out", money(st.paid)], ["Available", money(st.available)]].map(function (x) { return "<div><b>" + esc(x[1]) + "</b><span>" + x[0] + "</span></div>"; }).join("") + "</div>" +
      (r.status === "approved" ? affProg(r, st) : "") + '<p class="mt">Revenue share is paid on cumulative net revenue (losses carry forward). Players sharing your device never count. Rate range: 25% to 45%. A higher rate applies to revenue from the day it starts; earlier earnings are kept.</p>' +
      '<div class="aff-t" id="afT"><button type="button" data-at="trends">Trends</button><button type="button" data-at="players">Players</button><button type="button" data-at="payouts">Payouts</button><button type="button" data-at="team">Team</button><button type="button" data-at="share">Share</button><button type="button" data-at="tools">Tools</button><button type="button" data-at="slips">Slip sharing</button><button type="button" data-at="camps">Campaigns</button><button type="button" data-at="stmt">Statement</button></div><div id="afX"></div>' +
      (r.status === "approved" ? '<p class="bn-note"><b>Paid every Tuesday</b> (13:00 to 14:00 East Africa time) into your 247Bet wallet, after we approve your earnings (Monday or Tuesday morning). Minimum KES ' + k0(r.min) + '; smaller amounts roll over.' + "" + '</p>' : "");
    $("#afC").onclick = function () { var i = $("#afL"); i.select(); try { navigator.clipboard.writeText(i.value); toast("Link copied."); } catch (e) { document.execCommand("copy"); toast("Link copied."); } };
    var AD = null, afRange = 7;
    /* Players tab: filter by the date a player joined, and download the same list as a CSV */
    function afPlayers(x) {
      var P = AD.players || [], tz = C.TZ || "Africa/Nairobi";
      var ymd = function (t) { var d = new Date(t); return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA", { timeZone: tz }); };
      var dshort = function (t) { var d = new Date(t); return isNaN(d.getTime()) ? "-" : d.toLocaleDateString("en-KE"); };
      x.innerHTML = '<div class="aff-flt"><label>Joined from<br><input id="plF" type="date"></label><label>to<br><input id="plT" type="date"></label><button type="button" class="btn ghost" id="plD">Download CSV</button></div><div id="plS" class="mt"></div><div id="plL"></div>' +
        (P.length >= 200 ? '<p class="mt">Showing your latest 200 players.</p>' : "");
      function cur() {
        var f = $("#plF").value, t = $("#plT").value;
        return P.filter(function (p) { var d = ymd(p.joined); return (!f || d >= f) && (!t || d <= t); });
      }
      function draw() {
        var L = cur(), com = 0, dp = 0, ac = 0;
        L.forEach(function (p) { com += Number(p.commission) || 0; if (p.deposited) dp++; if (p.active) ac++; });
        $("#plS").innerHTML = L.length ? "<b>" + k0(L.length) + "</b> player" + (L.length === 1 ? "" : "s") + " &middot; " + k0(dp) + " deposited &middot; " + k0(ac) + " active &middot; commission " + esc(money(com)) : "";
        $("#plL").innerHTML = L.length ? L.map(function (p) {
          return '<div class="ac-row"><div>' + esc(p.who) + "<small>" + esc(dshort(p.joined)) + " &middot; " + (p.deposited ? "Deposited" + (p.dep > 0 ? " " + esc(money(p.dep)) : "") : "No deposit yet") + (p.active ? " &middot; Active" : "") + (p.last ? " &middot; Last played " + esc(dshort(p.last)) : "") + (p.counted ? "" : " &middot; Not counted") + '</small></div><b class="ac-up">' + esc(money(p.commission)) + "</b></div>";
        }).join("") : '<p class="mt">' + (P.length ? "No players joined in this period." : "No referred players yet. Share your link to get started.") + "</p>";
      }
      $("#plF").onchange = draw; $("#plT").onchange = draw; draw();
      $("#plD").onclick = function () {
        var L = cur(); if (!L.length) { toast("No players in this period."); return; }
        var q = function (v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        var head = ["Player", "Joined", "Deposited", "Total deposits (KES)", "Active (last 30 days)", "Last played", "Net revenue (KES)", "Your commission (KES)", "Counted"];
        var rows = L.map(function (p) { return [p.who, ymd(p.joined), p.deposited ? "Yes" : "No", p.dep || 0, p.active ? "Yes" : "No", p.last ? ymd(p.last) : "", p.net, p.commission, p.counted ? "Yes" : "No"]; });
        var csv = [head].concat(rows).map(function (r) { return r.map(q).join(","); }).join("\r\n");
        var a = document.createElement("a"), f = $("#plF").value, t = $("#plT").value;
        a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" }));
        a.download = "247bet-players-" + r.code + (f || t ? "-" + (f || "start") + "-to-" + (t || "now") : "") + ".csv";
        document.body.appendChild(a); a.click(); a.remove();
      };
    }
    function afShow(k) {
      var x = $("#afX"); if (!x) return;
      $$("#afT button").forEach(function (q) { q.setAttribute("aria-pressed", String(q.getAttribute("data-at") === k)); });
      if (k === "trends") {
        if (!AD) { x.innerHTML = "<p><span class=skl></span><span class=skl2></span><span class=skl3></span></p>"; acCall({ action: "affDetail", token: S.token }, function (d) { AD = d; afShow(k); }); return; }
        var sr = AD.series, sm = function (f) { return Math.round(sr.reduce(function (a, p) { return a + p[f]; }, 0) * 100) / 100; };
        var ch = function (f, col) { var W = 320, H = 90, mx = Math.max.apply(null, sr.map(function (p) { return Math.abs(p[f]); }).concat([1])), bw = W / sr.length; return '<svg viewBox="0 0 ' + W + " " + (H + 16) + '" style="width:100%;height:auto">' + sr.map(function (p, i) { var h = Math.max(1, Math.abs(p[f]) / mx * H); return '<rect x="' + (i * bw + 1) + '" y="' + (H - h) + '" width="' + (bw - 2) + '" height="' + h + '" rx="1.5" fill="' + (p[f] < 0 ? "#ff6b6b" : col) + '"><title>' + p.d + ": " + p[f] + "</title></rect>"; }).join("") + '<text x="0" y="' + (H + 12) + '" fill="#8aa0bf" font-size="9">' + sr[0].d.slice(5) + '</text><text x="' + W + '" y="' + (H + 12) + '" text-anchor="end" fill="#8aa0bf" font-size="9">' + sr[sr.length - 1].d.slice(5) + "</text></svg>"; };
        var days = sr.slice(-afRange), sumD = function (f) { return Math.round(days.reduce(function (t, p) { return t + p[f]; }, 0) * 100) / 100; };
        var cd = AD.clicksDay || {}, since = AD.clicksSince || "", cl = days.reduce(function (t, p) { return t + (cd[p.d] || 0); }, 0);
        var partial = !since || days[0].d < since;   // some days in this period were before per-day click counting started
        var regs = sumD("regs"), deps = sumD("deps"), earned = sumD("earned");
        var pc = function (n, d) { return d > 0 ? Math.round(n / d * 1000) / 10 + "%" : "-"; };
        x.innerHTML = '<div class="aff-rg" id="afRg">' + [[1, "Today"], [7, "7 days"], [30, "30 days"]].map(function (z) { return '<button type="button" data-rg="' + z[0] + '" aria-pressed="' + (z[0] === afRange) + '">' + z[1] + "</button>"; }).join("") + "</div>" +
          '<div class="aff-fn"><div><b>' + k0(cl) + "</b><span>Clicks</span></div><i>" + (partial ? "-" : pc(regs, cl)) + "</i><div><b>" + k0(regs) + "</b><span>Sign-ups</span></div><i>" + pc(deps, regs) + "</i><div><b>" + k0(deps) + "</b><span>Depositors</span></div></div>" +
          '<div class="aff-k"><div><b>' + esc(money(earned)) + "</b><span>Earned</span></div><div><b>" + (partial || !cl ? "-" : esc(money(earned / cl))) + "</b><span>Earnings per click</span></div><div><b>" + esc(money(sr[sr.length - 1].cum)) + "</b><span>Total earned</span></div><div><b>" + (partial ? "-" : pc(deps, cl)) + "</b><span>Clicks to depositors</span></div></div>" +
          '<p class="mt">Sign-ups and depositors are players who joined or made their first deposit in this period. The percentages show how many clicks became sign-ups, and how many sign-ups became depositors.' + (partial ? " " + (since ? "Daily click counts started on " + esc(since) + ", so click-based figures appear once the whole period is covered." : "Daily click counts start with the next visit to your link.") : "") + "</p>" +
          '<p class="mt">Earnings per day (last 30 days)</p>' + ch("earned", "#4ff32c") + '<p class="mt">Referred players per day</p>' + ch("regs", "#6fb2ff");
        $$("#afRg button").forEach(function (q) { q.onclick = function () { afRange = Number(q.getAttribute("data-rg")); afShow("trends"); }; });
        return;
      }
      if (k === "share") { var tx = "Join me on 247Bet. Sign up with my link and get your welcome bonus: " + link; x.innerHTML = '<p class="mt">Share your link</p><div class="aff-sh"><a class="btn ghost" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(tx) + '">WhatsApp</a><a class="btn ghost" target="_blank" rel="noopener" href="https://t.me/share/url?url=' + encodeURIComponent(link) + "&text=" + encodeURIComponent("Join me on 247Bet") + '">Telegram</a><button type="button" class="btn ghost" id="afCc">Copy code ' + esc(r.code) + "</button></div>"; $("#afCc").onclick = function () { try { navigator.clipboard.writeText(r.code); } catch (e) {} toast("Code copied."); }; return; }
      if (k === "tools") {
        var tcode = r.code, mk = function (c) { return link + (c ? "&c=" + c : ""); };
        var TX = [
          "Want a simple way to bet on football? Join me on 247Bet with my link: ",
          "Free to join, quick M-Pesa deposits, daily odds. Sign up here and use my code " + tcode + ": ",
          "18+ only. Bet responsibly. Join 247Bet here: "
        ];
        x.innerHTML = '<p class="mt">Your link and QR code</p><div class="aff-sh"><input id="tlC" type="text" maxlength="20" placeholder="Campaign name (optional), e.g. tiktok-may" autocapitalize="none"><button type="button" class="btn ghost" id="tlB">Update</button></div>' +
          '<div class="aff-l"><input id="tlL" readonly value="' + esc(mk("")) + '"><button type="button" id="tlCp" class="btn ghost">Copy</button></div>' +
          '<div style="text-align:center;margin:10px 0"><img id="tlQ" alt="QR code for your link" width="180" height="180" style="background:#fff;padding:8px;border-radius:10px"><p class="mt"><a id="tlQd" class="btn ghost" download="247bet-qr-' + esc(tcode) + '.png" target="_blank" rel="noopener">Open QR to save</a></p></div>' +
          '<p class="mt">Ready-made messages (tap to copy with your link)</p>' + TX.map(function (t, i) { return '<button type="button" class="btn ghost wide" data-tx="' + i + '" style="text-align:left;white-space:normal;margin-bottom:6px">' + esc(t) + "</button>"; }).join("") +
          '<p class="mt">Banners with your code</p><div class="aff-sh"><button type="button" class="btn ghost" data-bn="sq">Square 1080x1080</button><button type="button" class="btn ghost" data-bn="wd">Wide 1200x628</button><button type="button" class="btn ghost" data-bn="st">Story 1080x1920</button></div>' +
          '<p class="shr-note">Always show 18+ and a responsible gambling message, and never promise guaranteed wins. Breaking the programme rules can end your account.</p>';
        var cur = function () { var c = $("#tlC").value.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 20); return mk(c); };
        var upd = function () { var u = cur(); $("#tlL").value = u; var q = "https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=0&data=" + encodeURIComponent(u); $("#tlQ").src = q; $("#tlQd").href = q; };
        upd(); $("#tlB").onclick = upd; $("#tlC").oninput = upd;
        var cp = function (t) { try { navigator.clipboard.writeText(t); toast("Copied."); } catch (e) { toast("Select and copy the text."); } };
        $("#tlCp").onclick = function () { cp($("#tlL").value); };
        $$("#afX [data-tx]").forEach(function (b) { b.onclick = function () { cp(TX[Number(b.getAttribute("data-tx"))] + cur()); }; });
        $$("#afX [data-bn]").forEach(function (b) { b.onclick = function () {
          var kind = b.getAttribute("data-bn"), W = kind === "wd" ? 1200 : 1080, H = kind === "sq" ? 1080 : kind === "wd" ? 628 : 1920, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
          var g = cv.getContext("2d"), gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "#0b1a2e"); gr.addColorStop(1, "#04070d"); g.fillStyle = gr; g.fillRect(0, 0, W, H);
          g.fillStyle = "#4ff32c"; g.fillRect(0, 0, W, Math.round(H * 0.018));
          g.textAlign = "center"; var u = Math.min(W, H) / 1080, cy = H / 2 - 40 * u;
          g.fillStyle = "#ffffff"; g.font = "800 " + Math.round(150 * u) + "px Arial, sans-serif"; g.fillText("247", W / 2 - 150 * u, cy - 60 * u); g.fillStyle = "#4ff32c"; g.fillText("Bet", W / 2 + 190 * u, cy - 60 * u);
          g.fillStyle = "#ffffff"; g.font = "700 " + Math.round(64 * u) + "px Arial, sans-serif"; g.fillText("Join today", W / 2, cy + 50 * u);
          g.fillStyle = "#9fb3c8"; g.font = "600 " + Math.round(40 * u) + "px Arial, sans-serif"; g.fillText("Sign up with my code", W / 2, cy + 130 * u);
          g.fillStyle = "#4ff32c"; var bw = 520 * u, bh = 120 * u; g.fillRect(W / 2 - bw / 2, cy + 160 * u, bw, bh); g.fillStyle = "#04120a"; g.font = "800 " + Math.round(74 * u) + "px Arial, sans-serif"; g.fillText(tcode, W / 2, cy + 160 * u + bh * 0.7);
          g.fillStyle = "#9fb3c8"; g.font = "600 " + Math.round(30 * u) + "px Arial, sans-serif"; g.fillText(location.host + location.pathname.replace(/index\.html$/, "").replace(/\/$/, ""), W / 2, cy + 160 * u + bh + 60 * u);
          g.fillStyle = "#ffffff"; g.font = "600 " + Math.round(28 * u) + "px Arial, sans-serif"; g.fillText("18+ only. Bet responsibly. Gambling can be addictive.", W / 2, H - 50 * u);
          var a = document.createElement("a"); a.href = cv.toDataURL("image/png"); a.download = "247bet-banner-" + kind + "-" + tcode + ".png"; document.body.appendChild(a); a.click(); a.remove();
        }; });
        return;
      }
      if (k === "slips") {
        var sg = r.share; if (!sg) { x.innerHTML = '<p class="mt">Slip sharing is not available for this account.</p>'; return; }
        var pc = Math.min(100, Math.round(sg.active / sg.need * 100)), aw = sg.award;
        x.innerHTML = '<p class="mt">Slip sharing</p><div class="shr-card"><div class="shr-lock">' + LOCK_IC + "<span>" + (sg.blocked ? "Switched off" : sg.on ? "Unlocked" : "Locked") + "</span></div>" +
          (sg.blocked ? '<p class="shr-note">Slip sharing is switched off for your account. Contact support.</p>' :
          sg.on ? '<p class="shr-note">Add matches to your betslip and tap <b>Share</b>. Maximum stake <b>' + esc(kes0(sg.cap)) + "</b> per slip, up to " + sg.perDay + " links a day. Friends see only the stake and total odds until they place the bet. You keep access while you have " + sg.keep + " or more active players. If you stay below " + sg.keep + " for two Tuesdays in a row it switches off.</p>" :
          '<div class="shr-bar"><i style="width:' + pc + '%"></i></div><p class="shr-note"><b>' + sg.active + " of " + sg.need + "</b> active players. Slip sharing unlocks at " + sg.need + ".</p>") + "</div>" +
          '<p class="mt">Slip Star award, ' + esc(aw.month) + '</p><div class="shr-card">' + shRow("Qualified players this month", String(aw.count)) + shRow("Earned so far", money(aw.earned), true) + "</div>" +
          '<p class="shr-note">Every ' + aw.every + " new players who join through your link, deposit and bet on one of your shared slips earn you " + esc(kes0(aw.kes)) + " (up to " + esc(kes0(aw.max)) + ' a month). It is added to your earnings and paid with your Tuesday payout.</p><div id="afSl" class="shr-mine"></div>';
        api({ action: "slipMine", token: S.token }).then(function (m) {
          var bx = $("#afSl"); if (!bx || !m.ok || !m.list.length) return;
          bx.innerHTML = "<h3>Your recent links</h3>" + m.list.map(function (z) { return '<div class="shr-mr"><span><b>' + esc(z.code) + "</b>" + (z.camp ? " \u2022 " + esc(z.camp) : "") + (z.from ? " \u2022 from 247BET" : "") + " \u2022 " + esc(kes0(z.stake)) + "</span><span>" + z.opens + " opened \u2022 " + z.bets + " bet" + (z.bets === 1 ? "" : "s") + " \u2022 " + (z.expires > Date.now() ? leftFmt(z.expires) + " left" : "expired") + "</span></div>"; }).join("");
        }).catch(function () {});
        return;
      }
      if (k === "stmt") {
        var mo = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 7);
        x.innerHTML = '<p class="mt">Monthly statement</p><div class="aff-sh"><input id="stM" type="month" value="' + mo + '"><button type="button" class="btn ghost" id="stB">Download CSV</button></div><p class="mt">Shows that month\'s sign-ups, depositors, payouts and your balance. Opens in Excel or Google Sheets.</p>';
        $("#stB").onclick = function () {
          acCall({ action: "affStatement", token: S.token, month: $("#stM").value }, function (d) {
            var q = function (v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
            var csv = [d.headers].concat(d.rows).map(function (r) { return r.map(q).join(","); }).join("\r\n");
            var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" })); a.download = "247bet-statement-" + d.code + "-" + d.ym + ".csv"; document.body.appendChild(a); a.click(); a.remove();
          });
        };
        return;
      }
      if (k === "camps") {
        if (!AD) { x.innerHTML = "<p><span class=skl></span><span class=skl2></span><span class=skl3></span></p>"; acCall({ action: "affDetail", token: S.token }, function (d) { AD = d; afShow(k); }); return; }
        var cs = AD.campaigns || [], best = cs.filter(function (c) { return c.regs > 0 && c.c !== "(no campaign)"; }).sort(function (u, v) { return v.deps - u.deps || v.regs - u.regs; })[0];
        x.innerHTML = '<p class="mt">Make a campaign link</p><div class="aff-sh"><input id="cpN" type="text" maxlength="20" placeholder="e.g. tiktok-may" autocapitalize="none"><button type="button" class="btn ghost" id="cpB">Copy link</button></div><p class="mt" id="cpL"></p>' + (best ? '<div class="aff-best">Best campaign so far: <b>' + esc(best.c) + "</b> with " + k0(best.regs) + " sign-up" + (best.regs === 1 ? "" : "s") + " and " + k0(best.deps) + " depositor" + (best.deps === 1 ? "" : "s") + (best.clicks ? " (" + (Math.round(best.regs / best.clicks * 1000) / 10) + "% of its visits signed up)" : "") + ". Use that place again, and copy what worked there.</div>" : "") +
          (cs.length ? cs.map(function (c) { return '<div class="ac-row"><div>' + esc(c.c) + "<small>" + k0(c.clicks) + " visits &middot; " + k0(c.regs) + " sign-ups &middot; " + k0(c.deps) + " depositors &middot; net " + esc(money(c.net)) + "</small></div></div>"; }).join("") : '<p class="mt">No campaign results yet. Make a link above and use it in one place only (one video, one group). Its results show here.</p>');
        $("#cpB").onclick = function () { var c = $("#cpN").value.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 20); if (!c) { toast("Type a campaign name first."); return; } var u = link + "&c=" + c; $("#cpL").textContent = u; try { navigator.clipboard.writeText(u); toast("Link copied."); } catch (e) { toast("Copy the link shown."); } };
        return;
      }
      if (!AD) { x.innerHTML = "<p><span class=skl></span><span class=skl2></span><span class=skl3></span></p>"; acCall({ action: "affDetail", token: S.token }, function (d) { AD = d; afShow(k); }); return; }
      if (k === "players") { afPlayers(x); return; }
      var rows = k === "players" ? AD.players.map(function (p) { return '<div class="ac-row"><div>' + esc(p.who) + "<small>" + esc(new Date(p.joined).toLocaleDateString("en-KE")) + " &middot; " + (p.deposited ? "Deposited" : "No deposit yet") + (p.active ? " &middot; Active" : "") + (p.counted ? "" : " &middot; Not counted") + '</small></div><b class="ac-up">' + esc(money(p.commission)) + "</b></div>"; })
        : k === "payouts" ? AD.payouts.map(function (p) { return '<div class="ac-row"><div>' + esc(money(p.amount)) + "<small>" + esc(new Date(p.t).toLocaleDateString("en-KE")) + " &middot; " + esc(p.status) + (p.note ? " &middot; " + esc(p.note) : "") + "</small></div></div>"; })
        : AD.team.map(function (p) { return '<div class="ac-row"><div>' + esc(p.code) + "<small>" + esc(p.status) + '</small></div><b class="ac-up">' + esc(money(p.earned)) + "</b></div>"; });
      x.innerHTML = rows.length ? rows.join("") : '<p class="mt">' + (k === "players" ? "No referred players yet. Share your link to get started." : k === "payouts" ? "No payouts yet. The first one is paid on a Tuesday once your earnings reach your tier minimum (KES 1,500, 2,500 or 3,500)." : "You have not recruited any affiliates yet.") + "</p>";
    }
    $$("#afT button").forEach(function (q) { q.onclick = function () { afShow(q.getAttribute("data-at")); }; });
    afShow("trends");
  }
  try { var rf = new URLSearchParams(location.search).get("ref"); if (rf && !DEMO && !sessionStorage.getItem("q247.clk")) { sessionStorage.setItem("q247.clk", "1"); fetch(C.API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "affClick", code: rf, vid: (function () { try { var v = localStorage.getItem("q247.vid"); if (!v) { v = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); localStorage.setItem("q247.vid", v); } return v; } catch (e) { return ""; } })(), camp: new URLSearchParams(location.search).get("c") || "" }) }).catch(function () {}); } } catch (e) {}

  (function () { var t0 = 0, n = 0; setInterval(function () { if (!S.token) { t0 = 0; n = 0; return; } if (!t0) t0 = Date.now(); if (Date.now() - t0 >= (n + 1) * 3600000) { n++; toast("Reality check: you have been playing for " + n + " hour" + (n > 1 ? "s" : "") + ". Take a break if you need one. You can set a self-exclusion break in your account."); } }, 60000); })();
  loadPromo();
  $("#q").addEventListener("input", (function () {
    var timer;
    return function (e) { var v = e.target.value; clearTimeout(timer); timer = setTimeout(function () { S.q = low(v.trim()); S.shown = C.PAGE; renderFilters(); renderList(); }, 120); };
  })());
  $("#qx").addEventListener("click", function () { S.q = ""; var qi = $("#q"); qi.value = ""; S.shown = C.PAGE; refreshAll(); qi.focus(); });
  (function () { var mq = window.matchMedia("(max-width:420px)"), set = function () { $("#q").placeholder = mq.matches ? "Search" : "Search teams or leagues"; }; set(); if (mq.addEventListener) mq.addEventListener("change", set); })();
  $("#stake").addEventListener("input", function (e) {
    var v = e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
    S.stake = v; e.target.value = v; store("q247.stake", v); renderSlip();
  });
  $("#showMore").addEventListener("click", function () { S.shown += C.PAGE; renderList(); });
  $("#slipClear").addEventListener("click", function () { S.slip.clear(); renderSlip(); renderKick(); renderList(); renderSheet(); });
  $("#slipBarBtn").addEventListener("click", function () { if (!S.slip.size) { toast("Tap any odds to start your slip."); return; } setSlipOpen(!document.body.classList.contains("slip-open")); });
  $("#bnavSlip").addEventListener("click", function () { if (S.slip.size) setSlipOpen(!document.body.classList.contains("slip-open")); else toast("Tap any odds to start your slip."); });
  $("#slipClose").addEventListener("click", function () { setSlipOpen(false); });
  $("#scrim").addEventListener("click", function () { setSlipOpen(false); });
  /* ---------- hero slider (visitors): slim, auto-sliding, swipeable ---------- */
  var HS = { i: 0, n: 0, paused: false, rt: 0, inView: true, hotKey: "~", raf: 0 };
  var HS_REDUCE = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function hotPicks() {
    return upcoming().filter(function (m) { return mkt(m, "1x2"); })
      .sort(function (a, b) { return rank(a.league) - rank(b.league) || a.t - b.t; }).slice(0, 4);
  }
  function hotBody(m) {
    var k = mkt(m, "1x2");
    return '<span class="hs-tag">Hot match</span><div class="hs-teams"><span>' + miniLogo(m.home) + esc(m.home) + "</span><i>v</i><span>" + miniLogo(m.away) + esc(m.away) + "</span></div>" +
      '<div class="hs-when">' + esc(m.league) + " &middot; " + esc(dayName(m.t)) + " " + tf.format(m.t) + "</div>" +
      '<div class="hs-odds">' + k.outs.map(function (o) { return oddBtn(m, k, o); }).join("") + "</div>";
  }
  function heroSlides(hot) {
    var W = PROMO.welcome, K = PROMO.weekend, B = BOOSTCFG || DEFBOOST, top = B.ladder[B.ladder.length - 1][1], s = [], li = !!S.user, F = PROMO.free || { amount: 50, on: true }, RF = LIM.ref, H = [];
    hot.forEach(function (m, i) { H.push({ id: "hot" + i, img: "hero-hot" + (i + 1), hot: m }); });      // up to 4 hot matches, each with its own picture
    s.push({ id: "welcome", img: "hero-welcome", tag: W.pct + "% welcome bonus", h: "Get <b>" + W.pct + "%</b> on your first deposit", p: "Up to KES " + k0(W.max) + ". Deposit with M-Pesa.", cta: li ? "Deposit now" : "Sign up now", act: li ? 'data-auth="wallet"' : 'data-auth="join"' });
    if (!li && F.on !== false) s.push({ id: "register", img: "hero-register", tag: "Registration bonus", h: "Free <b>KES " + k0(F.amount) + "</b> when you join", p: "No deposit needed. Sign up and your bonus is waiting.", cta: "Sign up free", act: 'data-auth="join"' });
    if (H[0]) s.push(H[0]);
    s.push({ id: "boost", img: "hero-boost", tag: "Multibet boost", h: "Up to <b>" + top + "%</b> extra on your wins", p: "Build a multibet and the boost grows with every pick you add.", cta: "How it works", act: 'data-info="boost"' });
    if (H[1]) s.push(H[1]);
    s.push({ id: "jackpot", img: "hero-jackpot", tag: "Jackpots", h: "Win <b>" + topShort("WKD", 5000000) + "</b>", p: "Super and Midweek Millionaire. The top prize grows every week until it is won.", cta: "Play jackpots", act: 'data-open="jackpots"' });
    s.push({ id: "predictor", img: "hero-predictor", tag: "Free to play", h: "Super 5 <b>Predictor</b>", p: "Predict 5 exact scores. Get 3 or 4 right for a bonus, all 5 for cash.", cta: "Play free", act: 'data-open="predictor"' });
    if (!((window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true)) s.push({ id: "install", img: "hero-install", tag: "Get the app", h: "Install the <b>247Bet app</b>", p: "Add 247Bet to your home screen. No store needed.", cta: "Install APK", act: 'data-install-go="1"' });
    s.push({ id: "theme", img: "hero-theme", tag: "New: screen theme", h: "Dark or <b>Light</b>", p: "Pick the look you like. Auto follows your phone.", cta: "Choose theme", act: 'data-theme-open="1"' });
    if (H[2]) s.push(H[2]);
    s.push({ id: "share", img: "hero-share", tag: "Share and earn", h: "Share your bet, earn <b>5%</b>", p: "When a friend wins on your shared slip, 5% of their winnings is yours as a bonus.", cta: "How it works", act: 'data-how="share"' });
    s.push({ id: "referral", img: "hero-referral", tag: "Invite a friend", h: "Get <b>KES " + k0(RF.reward) + "</b> per friend", p: "Not an affiliate? Invite a friend. When they deposit KES " + k0(RF.minDeposit) + " or more, your bonus is added.", cta: li ? "Get my link" : "Sign up to invite", act: li ? 'data-auth="account"' : 'data-auth="join"' });
    s.push({ id: "device", img: "hero-device", tag: "Fair play", h: "<b>1 welcome bonus</b> per M-Pesa number", p: "Keeps the 200% bonus safe and fair for every player.", cta: "How bonuses work", act: 'data-how="all"' });
    if (H[3]) s.push(H[3]);
    s.push({ id: "chat", img: "hero-chat", tag: "Live chat", h: "Need <b>help?</b>", p: "Quick answers any time. A person joins when you ask.", cta: "Open chat", act: 'data-chat-go="1"' });
    s.push({ id: "affiliate", img: "hero-affiliate", tag: "Affiliate programme", h: "Earn up to <b>45%</b>", p: "A share of the revenue from every player you refer, paid every Tuesday.", cta: "Become an affiliate", act: 'data-info="affiliates"' });
    s.push({ id: "saturday", img: "hero-saturday", tag: "Saturday bonus", h: "Up to <b>KES " + k0(K.max) + "</b>", p: "Get a " + K.pct + "% bonus on your first deposit every Saturday.", cta: li ? "Deposit now" : "Claim it", act: li ? 'data-auth="wallet"' : 'data-auth="join"' });
    return s;
  }
  function slideHtml(x) {
    var img = x.img ? '<img src="Assets/' + x.img + '.webp" alt="" decoding="async" width="1000" height="462"' + (x.id === "welcome" ? ' fetchpriority="high"' : ' loading="lazy"') + ">" : "";
    if (x.hot) return '<article class="hs-slide" data-hs="' + x.id + '">' + img + '<div class="hs-body" data-hot="' + x.id + '">' + hotBody(x.hot) + "</div></article>";
    return '<article class="hs-slide' + (x.ph ? " hs-ph" : "") + '" data-hs="' + x.id + '" ' + x.act + ' role="button" tabindex="0" aria-label="' + esc(x.tag + ". " + x.cta) + '">' + img +
      '<div class="hs-body"><span class="hs-tag">' + esc(x.tag) + "</span><h2>" + x.h + "</h2><p>" + esc(x.p) + '</p><span class="hs-cta">' + esc(x.cta) + " &rsaquo;</span></div></article>";
  }
  function hsMark() {
    $$("#hsDots button").forEach(function (b, i) { if (i === HS.i) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current"); });
  }
  function hsGo(i, smooth) {
    var t = $("#hsTrack"); if (!t) return;
    HS.i = i; t.scrollTo({ left: i * t.clientWidth, behavior: smooth ? "smooth" : "auto" }); hsMark();
  }
  function renderHero() {
    var t = $("#hsTrack"); if (!t) return;
    var hot = hotPicks(), s = heroSlides(hot);
    HS.hotKey = hot.map(function (m) { return m.id; }).join("|"); HS.li = !!S.user;
    HS.n = s.length; if (HS.i >= HS.n) HS.i = 0;
    t.innerHTML = s.map(slideHtml).join("");
    $("#hsDots").innerHTML = s.map(function (x, i) { return '<button type="button" data-hsgo="' + i + '" aria-label="Slide ' + (i + 1) + " of " + s.length + '"></button>'; }).join("");
    t.scrollLeft = HS.i * t.clientWidth; hsMark();
  }
  function renderHeroHot() {
    if (!$("#hsTrack") || !S.matches.length) return;
    var hot = hotPicks(), key = hot.map(function (m) { return m.id; }).join("|");
    if (key !== HS.hotKey) { renderHero(); return; }          // the hot fixtures changed: rebuild once, keeping the current slide
    hot.forEach(function (m, i) { var el = $('[data-hot="hot' + i + '"]'); if (el) el.innerHTML = hotBody(m); });
  }
  (function heroInit() {
    var t = $("#hsTrack"); if (!t) return;
    renderHero();
    t.addEventListener("scroll", function () {
      if (HS.raf) return;
      HS.raf = requestAnimationFrame(function () { HS.raf = 0; var i = Math.round(t.scrollLeft / (t.clientWidth || 1)); if (i !== HS.i) { HS.i = i; hsMark(); } });
    }, { passive: true });
    function hold() { HS.paused = true; clearTimeout(HS.rt); }
    function release(ms) { clearTimeout(HS.rt); HS.rt = setTimeout(function () { HS.paused = false; }, ms || 4000); }
    t.addEventListener("pointerdown", hold);
    t.addEventListener("pointerup", function () { release(4000); });
    t.addEventListener("pointercancel", function () { release(4000); });
    t.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse") hold(); });
    t.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") release(1500); });
    t.addEventListener("focusin", hold); t.addEventListener("focusout", function () { release(4000); });
    $("#hsDots").addEventListener("click", function (e) { var b = e.target.closest("[data-hsgo]"); if (b) { hold(); hsGo(Number(b.getAttribute("data-hsgo")), true); release(6000); } });
    t.addEventListener("keydown", function (e) {
      var sl = e.target.closest && e.target.closest('.hs-slide[role="button"]');
      if (sl && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); sl.click(); }
    });
    window.addEventListener("resize", function () { t.scrollLeft = HS.i * t.clientWidth; });
    if ("IntersectionObserver" in window) new IntersectionObserver(function (en) { HS.inView = en[0].isIntersecting; }, { threshold: 0.4 }).observe($("#hs"));
    setInterval(function () {
      if (HS_REDUCE || HS.paused || document.hidden || !HS.inView || HS.n < 2 || $("#land").hidden) return;
      var nx = (HS.i + 1) % HS.n; hsGo(nx, nx !== 0);
    }, 4000);
  })();
  $("#keepSlip").checked = S.keep;
  $("#keepSlip").addEventListener("change", function (e) {
    S.keep = e.target.checked; store("q247.keep", S.keep); if (!S.keep) store("q247.slip", null);
    toast(S.keep ? "Slip will be kept after you place a bet." : "Slip will clear after you place a bet.");
    renderSlip();
  });

  $("#useBonus").addEventListener("change", function (e) { S.useBonus = !!e.target.checked; renderSlip(); });
  $("#place").addEventListener("click", function () {
    if (!S.user || DEMO || Date.now() - (S.savedAt || 0) < 45000) { placeNow(); return; }
    var before = {}; slipItems().forEach(function (i) { before[i.mid] = i.live ? i.now : 0; });
    var pb = $("#place"); pb.disabled = true; $("#slipMsg").textContent = "Checking the latest odds...";
    load(false).then(function () {
      pb.disabled = false; $("#slipMsg").textContent = "";
      var now = slipItems(), moved = now.some(function (i) { return (i.live ? i.now : 0) !== before[i.mid]; });
      if (moved) { renderSlip(); if (!$("#slipMsg").textContent) $("#slipMsg").textContent = "Odds were updated. Check your slip and tap Place bet again."; return; }
      placeNow();
    }, function () { pb.disabled = false; $("#slipMsg").textContent = ""; placeNow(); });
  });
  function placeNow() {
    var items = slipItems().filter(function (i) { return i.live; }), stake = parseStake();
    if (!items.length) { toast("Add a selection first."); return; }
    if (!(stake >= C.MIN_STAKE)) { $("#stake").focus(); renderSlip(); if (!S.stake) $("#slipMsg").textContent = "Enter a stake to continue."; return; }
    if (stake > C.MAX_STAKE) { $("#stake").focus(); return; }
    if (!S.user) { openAuth("bet"); return; }
    var useB = !!(S.useBonus && bonusPlan(items, slipItems().length, stake).pick);
    if (!useB && !DEMO && (Number(S.user.balance) || 0) < stake) { noFunds(); return; }
    var btn = $("#place"); btn.disabled = true;
    if (!rid) rid = "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    api({ action: "placeBet", token: S.token, rid: rid, stake: stake, useBonus: useB, legs: items.map(function (i) { var s = S.slip.get(i.mid); return { mid: i.mid, mk: s.mk, l: i.l, price: i.now }; }) })
      .then(function (r) {
        btn.disabled = false; rid = "";
        if (r.expired) { setSession("", null); openAuth("bet"); return; }
        if (!r.ok) { if (/not enough balance/i.test(r.error || "")) { noFunds(); return; } $("#slipMsg").textContent = r.error || "Could not place bet."; if (r.changed) { if (r.gone && r.gone.length) toast("Some selections are no longer available."); load(true); } return; }
        S.user.balance = r.balance; if (r.bonus != null) S.user.bonus = r.bonus; S.useBonus = false; loadTaskFlag(); if (!S.keep) { S.slip.clear(); S.stake = ""; $("#stake").value = ""; store("q247.stake", ""); }
        renderAcct(); renderSlip(); renderKick(); renderList(); renderSheet(); setSlipOpen(false); toast(r.usedBonus ? "Bonus bet placed. Good luck!" : S.keep ? "Bet placed. Your slip was kept." : "Bet placed. Good luck!");
      }).catch(function () { btn.disabled = false; $("#slipMsg").textContent = "Network problem. Tap Place bet again; it will not double-charge."; });
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && document.body.classList.contains("slip-open")) setSlipOpen(false); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") load(false); });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (en) { if (en[0].isIntersecting && !$("#showMore").hidden) { S.shown += C.PAGE; renderList(); } }, { rootMargin: "300px" }).observe($("#showMore"));
  }

  /* ---------- share slip: a stake-locked https link; the picks stay on the server until the viewer's bet is placed ---------- */
  var SHT = { "1x2": "1X2", dc: "Double chance", dnb: "Draw no bet", ou25: "Total goals 2.5", ou15: "Total goals 1.5", ou35: "Total goals 3.5", btts: "Both teams to score", oe: "Total goals odd/even", ou45: "Total goals 4.5", gr: "Total goals range", hts: "Home team to score", ats: "Away team to score", ho15: "Home team goals 1.5", ao15: "Away team goals 1.5", hch: "Handicap: home -1", hca: "Handicap: away -1", rbt: "Result & both teams to score", rou: "Result & total goals 2.5", hwn: "Home team to win to nil", awn: "Away team to win to nil", htft: "Half-time/Full-time", cs: "Correct score" };
  var SHR = { code: "", st: "", d: null, rc: null, msg: "", busy: false, bal: null, agree: false };
  function kes0(n) { return "KES " + Number(n).toLocaleString("en-KE", { maximumFractionDigits: 2 }); }
  var expF = new Intl.DateTimeFormat("en-GB", { timeZone: C.TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  function expFmt(ms) { return expF.format(new Date(ms)) + " (Nairobi time)"; }
  /* the link lasts 24 hours or until the first kickoff, whichever comes first (the server sets the real time; this is the same rule shown early) */
  function expEarly(items) { var e = Date.now() + 864e5; items.forEach(function (i) { if (i.t > 0 && i.t < e) e = i.t; }); return e; }
  function leftFmt(ms) { var m = Math.max(0, Math.round((ms - Date.now()) / 60000)), h = Math.floor(m / 60); return h > 0 ? h + "h " + (m % 60) + "m" : m + "m"; }
  var LOCK_IC = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  var OK_IC = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
  function shRow(a, b, big) { return '<div class="shr-r' + (big ? " big" : "") + '"><span>' + esc(a) + "</span><b>" + esc(b) + "</b></div>"; }
  function shLegs(list) {
    return '<div>' + list.map(function (g) {
      return '<div class="shr-leg"><div><b>' + esc(g.home + " Vs. " + g.away) + "</b><span>" + esc((SHT[g.mk] || g.mk) + " \u2022 " + pickName(g.mk, g.l, g.home, g.away)) + "</span>" + (g.t ? "<i>Starts " + esc(startFmt(g.t)) + "</i>" : "") + "</div><em>" + odds2(g.p) + "</em></div>";
    }).join("") + "</div>";
  }
  function shHidden(list) {
    return "<div>" + list.map(function (g) {
      return '<div class="shr-leg"><div><b>' + esc(g.home + " Vs. " + g.away) + "</b><span>" + esc((g.lg ? g.lg + " \u2022 " : "") + "Pick hidden") + "</span>" + (g.t ? "<i>Starts " + esc(startFmt(g.t)) + "</i>" : "") + "</div></div>";
    }).join("") + "</div>";
  }
  function shareUrl(code, promo) { var u = location.origin + location.pathname + "?slip=" + code; if (promo) u += "&ref=" + promo; return u; }

  /* --- the sharer: build the link --- */
  var SHCAP = 0;
  function openShare() {
    var items = slipItems().filter(function (i) { return i.live; });
    if (!items.length) { toast("Add a selection first."); return; }
    if (!S.user) { toast("Log in to share your slip."); openAuth("login"); return; }
    $("#shBody").innerHTML = '<p class="shr-note">Checking your access...</p>'; openDlg($("#shDlg"));
    api({ action: "slipAccess", token: S.token }).then(function (r) {
      if (r.expired) { setSession("", null); closeDlg($("#shDlg")); openAuth("login"); return; }
      if (!r.ok) { $("#shBody").innerHTML = '<p class="shr-err">' + esc(r.error || "Could not check your access.") + "</p>"; return; }
      if (r.player) { shPlayer(items, r); return; }
      if (!r.eligible) { shLocked(r); return; }
      shForm(items, r);
    }).catch(function () { $("#shBody").innerHTML = '<p class="shr-err">Network problem. Close this and try again.</p>'; });
  }
  function shLocked(r) {
    var pct = Math.min(100, Math.round((r.active || 0) / r.need * 100)), h = '<div class="shr-card"><div class="shr-lock">' + LOCK_IC + "<span>Slip sharing is for partners</span></div><p class=\"shr-note\">" + esc(r.error || "") + "</p>";
    if (r.status === "approved" && !r.blocked) h += '<div class="shr-bar"><i style="width:' + pct + '%"></i></div><p class="shr-note"><b>' + (r.active || 0) + " of " + r.need + "</b> active players</p>";
    h += "</div>";
    if (r.status === "none") h += '<div class="shr-btns"><button type="button" id="shAff" class="btn lime wide">Join the affiliate programme</button></div>';
    $("#shBody").innerHTML = h; var x = $("#shAff"); if (x) x.onclick = function () { closeDlg($("#shDlg")); openAff("apply"); };
  }
  /* --- any player (not an affiliate): lock this slip and share it --- */
  function shPlayer(items, r) {
    var tot = Math.round(items.reduce(function (a, i) { return a * i.now; }, 1) * 100) / 100, pct = r.pct || 5;
    $("#shBody").innerHTML = '<div class="shr-sum"><b>' + items.length + (items.length === 1 ? " selection" : " selections") + "</b><span>Total odds " + odds2(tot) + "</span></div>" +
      '<p class="shr-note"><b>Share this bet.</b> Friends who open your link see these exact matches and picks. They cannot add, remove or change a pick, and each one chooses their own stake. If a friend\'s bet wins, ' + pct + '% of their winnings goes to you as a Share bonus (you stake it on 5+ matches, every match at 1.5+, minimum stake KES ' + C.MIN_STAKE + '). The link expires on <b>' + esc(expFmt(expEarly(items))) + '</b> (the first kickoff, or 24 hours if that is earlier).</p>' +
      '<p id="shMsg" class="sl-msg" role="alert"></p><div class="shr-btns"><button type="button" id="shMake" class="btn lime wide">Create link</button></div><div id="shOut"></div>';
    $("#shMake").onclick = function () { shPlayerMake(items); };
  }
  function shPlayerMake(items) {
    var msg = $("#shMsg"), btn = $("#shMake"), legs = items.map(function (i) { var sl = S.slip.get(i.mid); return { mid: i.mid, mk: sl.mk, l: i.l }; }); msg.textContent = ""; btn.disabled = true;
    api({ action: "pshare", token: S.token, legs: legs }).then(function (r) {
      btn.disabled = false;
      if (r.expired) { setSession("", null); closeDlg($("#shDlg")); openAuth("login"); return; }
      if (!r.ok) { msg.textContent = r.error || "Could not create the link."; return; }
      var url = shareUrl(r.code, r.promo), txt = "My 247BET slip: " + r.n + (r.n === 1 ? " pick" : " picks") + ", total odds " + odds2(r.odds) + ". Open the link, see the picks and bet with your own stake: " + url;
      $("#shOut").innerHTML = '<p class="shr-note"><b>Your link is ready.</b> It expires on <b>' + esc(expFmt(r.expires)) + '</b>.</p><input class="shr-link" id="shLink" readonly value="' + esc(url) + '" aria-label="Slip link"><div class="shr-btns"><a class="btn lime wide" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(txt) + '">Share on WhatsApp</a><button type="button" id="shCp" class="btn wide">Copy link</button></div>';
      $("#shCp").onclick = function () { var i = $("#shLink"); i.select(); try { document.execCommand("copy"); toast("Link copied."); } catch (e) {} };
    }).catch(function () { btn.disabled = false; msg.textContent = "Network problem. Try again."; });
  }
  function shForm(items, ac) {
    var tot = Math.round(items.reduce(function (a, i) { return a * i.now; }, 1) * 100) / 100, st = parseStake(); SHCAP = ac.cap;
    $("#shBody").innerHTML =
      '<div class="shr-sum"><b>' + items.length + (items.length === 1 ? " selection" : " selections") + "</b><span>Total odds " + odds2(tot) + "</span></div>" +
      '<label class="shr-f">Stake for this slip (KES, maximum ' + esc(kes0(ac.cap)) + ')<input id="shStake" type="text" inputmode="decimal" autocomplete="off" value="' + (st > 0 && st <= ac.cap ? esc(String(st)) : "") + '" placeholder="e.g. 500"></label>' +
      '<label class="shr-f">Promo code (optional)<input id="shPromo" type="text" maxlength="12" autocapitalize="characters" autocomplete="off" placeholder="Leave empty to use your own code"></label>' +
      '<label class="shr-f">Campaign name (optional, for your own tracking)<input id="shCamp" type="text" maxlength="24" autocomplete="off" placeholder="e.g. WhatsApp group 1"></label>' +
      '<p class="shr-note">People who open your link see only the stake and the total odds. The matches stay hidden until they log in and place this exact bet with this exact stake. The link expires on <b>' + esc(expFmt(expEarly(items))) + '</b>, at the first kickoff or after 24 hours, whichever is earlier. Picks are not advice: make no guaranteed-win claims.</p>' +
      '<p id="shMsg" class="sl-msg" role="alert"></p>' +
      '<div class="shr-btns"><button type="button" id="shMake" class="btn lime wide">Create link</button></div>' +
      '<div id="shOut"></div><div id="shMine" class="shr-mine"></div>';
    $("#shMake").onclick = shMake; shMineLoad();
  }
  function shMake() {
    var msg = $("#shMsg"), stake = Math.round(parseFloat(String($("#shStake").value).replace(/,/g, "")) * 100) / 100, promo = $("#shPromo").value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    msg.textContent = "";
    if (!(stake >= C.MIN_STAKE)) { msg.textContent = "Minimum stake is KES " + C.MIN_STAKE + "."; return; }
    if (stake > (SHCAP || C.MAX_STAKE)) { msg.textContent = "The maximum stake on a shared slip is " + kes0(SHCAP || C.MAX_STAKE) + "."; return; }
    if (promo && promo.length < 3) { msg.textContent = "A promo code is 3 to 12 letters or numbers."; return; }
    var legs = slipItems().filter(function (i) { return i.live; }).map(function (i) { var sl = S.slip.get(i.mid); return { mid: i.mid, mk: sl.mk, l: i.l }; });
    var btn = $("#shMake"); btn.disabled = true;
    api({ action: "slipShare", token: S.token, stake: stake, promo: promo, camp: ($("#shCamp") || {}).value || "", legs: legs }).then(function (r) {
      btn.disabled = false;
      if (r.expired) { setSession("", null); closeDlg($("#shDlg")); openAuth("login"); return; }
      if (r.locked && r.access) { shLocked(r.access); return; }
      if (!r.ok) { msg.textContent = r.error || "Could not create the link."; return; }
      var url = shareUrl(r.code, r.promo), txt = "My 247BET slip: " + r.n + (r.n === 1 ? " pick" : " picks") + ", total odds " + odds2(r.odds) + ". Stake " + kes0(stake) + ". The picks are revealed when you place the bet. Link valid until " + expFmt(r.expires) + ": " + url;
      $("#shOut").innerHTML = '<p class="shr-note"><b>Your link is ready.</b> It expires on <b>' + esc(expFmt(r.expires)) + '</b>.</p><input class="shr-link" id="shLink" readonly value="' + esc(url) + '" aria-label="Slip link">' +
        '<div class="shr-btns"><a id="shWa" class="btn lime wide" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(txt) + '">Share on WhatsApp</a>' +
        '<button type="button" id="shCp" class="btn wide">Copy link</button>' + (navigator.share ? '<button type="button" id="shNat" class="btn wide">More share options</button>' : "") + "</div>";
      $("#shCp").onclick = function () {
        var done = function () { toast("Link copied."); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { var i = $("#shLink"); i.select(); try { document.execCommand("copy"); done(); } catch (e) {} });
        else { var i = $("#shLink"); i.select(); try { document.execCommand("copy"); done(); } catch (e) {} }
      };
      var nt = $("#shNat"); if (nt) nt.onclick = function () { navigator.share({ text: txt, url: url }).catch(function () {}); };
      shMineLoad();
    }).catch(function () { btn.disabled = false; msg.textContent = "Network problem. Try again."; });
  }
  function shMineLoad() {
    var box = $("#shMine"); if (!box) return;
    api({ action: "slipMine", token: S.token }).then(function (r) {
      if (!r.ok || !r.list.length) { box.innerHTML = ""; return; }
      box.innerHTML = "<h3>Your recent links</h3>" + r.list.map(function (x) {
        return '<div class="shr-mr"><span><b>' + esc(x.code) + "</b>" + (x.camp ? " \u2022 " + esc(x.camp) : "") + (x.from ? " \u2022 from 247BET" : "") + " \u2022 " + esc(kes0(x.stake)) + " \u2022 " + x.n + (x.n === 1 ? " pick" : " picks") + "</span><span>" + x.opens + " opened \u2022 " + x.bets + " bet" + (x.bets === 1 ? "" : "s") + " \u2022 " + (x.expires > Date.now() ? leftFmt(x.expires) + " left" : "expired") + "</span></div>";
      }).join("");
    }).catch(function () {});
  }

  /* --- the friend: open the link --- */
  function shrBoot() {
    var c = ""; try { c = (new URLSearchParams(location.search).get("slip") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8); } catch (e) {}
    if (!c || DEMO) return;
    SHR.code = c; SHR.st = "load"; renderShr(); openDlg($("#shrDlg")); shrPeek();
  }
  function shrPeek() {
    api({ action: "slipPeek", code: SHR.code, token: S.token || "", dev: devId() }).then(shrGot).catch(function () { SHR.st = "err"; SHR.msg = "Network problem. Check your connection and reload the page."; renderShr(); });
  }
  function shrGot(r) {
    SHR.msg = ""; SHR.agree = false;
    if (r && r.ok && r.placed) { SHR.st = "done"; SHR.rc = r.placed; SHR.bal = r.balance; }
    else if (r && r.ok) { SHR.st = "peek"; SHR.d = r; SHR.more = false; if (r.promo && !S.user && !store("q247.ref")) store("q247.ref", r.promo); }
    else { SHR.st = "err"; SHR.msg = (r && r.error) || "This slip could not be opened."; if (r && r.gone && /expired/i.test(r.error || "")) { SHR.st = "exp"; } }
    renderShr();
  }
  function shrAfterAuth(login) {
    if (typeof SHR === "undefined" || !SHR || !SHR.code || !$("#shrDlg").open) return;
    if (login) { SHR.st = "load"; renderShr(); shrPeek(); } else renderShr();
  }
  function renderShr() {
    var b = $("#shrBody"); if (!b) return;
    var h = "", d = SHR.d;
    if (SHR.st === "load") h = '<p class="shr-note">Opening slip...</p>';
    else if (SHR.st === "exp") h = '<div class="shr-card"><div class="shr-lock">' + LOCK_IC + "<span>This link has expired</span></div></div>" + '<p class="shr-err">This link has expired. A slip link stops working at the first kickoff, so no bet can be placed on it now. Nothing was charged.</p><button type="button" class="btn lime wide" data-close>See matches</button>';
    else if (SHR.st === "err") h = '<p class="shr-err">' + esc(SHR.msg) + '</p><button type="button" class="btn lime wide" data-close>See matches</button>';
    else if (SHR.st === "done" && SHR.rc) {
      var rc = SHR.rc;
      h = '<div class="shr-card"><div class="shr-lock">' + OK_IC + "<span>Bet placed</span></div>" + shRow("Bet ID", rc.betId) + shRow("Stake", money(rc.stake)) + shRow("Total odds", odds2(rc.odds)) +
        (rc.boost > 0 ? shRow("Multibet boost", "+ " + money(rc.boost)) : "") + shRow("Potential return", money(rc.potential), true) + (SHR.bal != null ? shRow("Your balance", money(SHR.bal)) : "") + "</div>" +
        '<div class="shr-card">' + shLegs(rc.legs) + "</div>" +
        '<div class="shr-btns"><button type="button" id="shBets" class="btn lime wide">View my bets</button><button type="button" class="btn wide" data-close>Done</button>' + (SHR.d && (SHR.d.player || SHR.d.mode === "min") ? '<button type="button" id="shAgain" class="btn wide">Place again with another stake</button>' : "") + '</div>' + (SHR.fee ? '<p class="shr-fine">If this bet wins, ' + SHR.pct + '% of your winnings goes to the player who shared it.</p>' : "") + '<p class="shr-fine">Picks are not advice. 18+. Bet responsibly.</p>';
    } else if (SHR.st === "peek" && d && d.player) {
      h = shrPlayerHtml(d);
    } else if (SHR.st === "peek" && d) {
      var mn = d.mode === "min", lo = Number(d.minStake || d.stake) || 0, hi = Number(d.maxStake) || C.MAX_STAKE, cur = mn ? (Number(SHR.stake) || lo) : d.stake, ratio = d.stake > 0 ? d.potential / d.stake : d.odds;
      h = '<div class="shr-card"><div class="shr-lock">' + LOCK_IC + "<span>" + (d.mine ? "Your shared slip" : "Locked slip") + "</span></div>" + (d.house ? '<div class="shr-badge">Shared by 247BET</div>' : d.partner ? '<div class="shr-badge">Shared by a 247BET partner</div>' : "") +
        shRow(mn ? "Minimum stake" : "Stake (fixed)", money(mn ? lo : d.stake)) + shRow("Selections", String(d.n)) + shRow("Total odds", odds2(d.odds)) +
        (d.boostPct ? shRow("Multibet boost", d.boostPct + "% included") : "") +
        (mn ? '<div class="shr-r big"><span>Potential return</span><b id="shrPot">' + esc(money(cur * ratio)) + "</b></div>" : shRow("Potential return", money(d.potential), true)) + shRow("Link expires", expFmt(d.expires) + " (" + leftFmt(d.expires) + " left)") + "</div>";
      if (d.mine && d.picks) h += '<div class="shr-card">' + shLegs(d.picks) + "</div>";
      else {
        if (d.matches && d.matches.length) h += '<div class="shr-card">' + shHidden(d.matches) + "</div>";
        h += '<p class="shr-note"><b>' + (d.matches && d.matches.length ? "The market and pick on each match are hidden" : "The matches and picks are hidden") + "</b> until you place this bet. " + (mn ? "The minimum stake is " + esc(kes0(lo)) + ". You can stake more, up to " + esc(kes0(hi)) + "." : "The stake cannot be changed.") + "</p>";
      }
      if (!S.user && S.token && !DEMO) h += '<p class="shr-note">Checking your account...</p>';
      else if (!S.user) h += '<div class="shr-btns"><button type="button" id="shLogin" class="btn lime wide">Log in to continue</button><button type="button" id="shJoin" class="btn wide">Sign up</button></div>';
      else {
        var bal = Number(S.user.balance) || 0;
        h += '<p class="shr-note">Your balance: <b>' + esc(money(bal)) + "</b></p>";
        if (bal < lo) h += '<div class="shr-warn">You need ' + esc(money(lo)) + ' to open this slip. Deposit to continue.</div><div class="shr-btns"><button type="button" id="shDep" class="btn lime wide">Deposit</button></div>';
        else {
          if (mn) {
            var opts = [lo, lo + 500, lo + 1000].filter(function (v) { return v <= hi; }), isOpt = opts.indexOf(cur) >= 0, more = !!SHR.more || !isOpt;
            h += '<div class="shr-f"><span>Choose your stake (KES, minimum ' + esc(String(lo)) + ')</span><div class="shr-chips" id="shrChips" role="group" aria-label="Stake options">' +
              opts.map(function (v) { return '<button type="button" class="shr-chip' + (!more && cur === v ? " on" : "") + '" data-st="' + v + '"' + (v > bal ? " disabled" : "") + ">" + esc(Number(v).toLocaleString("en-KE")) + "</button>"; }).join("") +
              '<button type="button" class="shr-chip shr-chip-more' + (more ? " on" : "") + '" data-more="1">More</button></div></div>' +
              '<label class="shr-f" id="shrMoreBox"' + (more ? "" : " hidden") + '>Type your stake (KES, not less than ' + esc(String(lo)) + ')<input id="shrStake" type="text" inputmode="decimal" autocomplete="off" value="' + esc(String(cur)) + '"></label><div id="shrCalc" class="shr-note"></div>';
          }
          if (!d.mine) h += '<label class="shr-chk"><input type="checkbox" id="shAgree"' + (SHR.agree ? " checked" : "") + "><span>I understand the picks stay hidden until I place this bet, my stake of <b id=\"shrAgAmt\">" + esc(kes0(cur)) + "</b> is taken immediately, and normal bet rules apply. The odds can move slightly before the bet is placed.</span></label>";
          h += '<div class="shr-btns"><button type="button" id="shGo" class="btn lime wide"' + (!d.mine && !SHR.agree ? " disabled" : "") + ">" + (d.mine ? "Place this bet " : "Place bet ") + esc(kes0(cur)) + (d.mine ? "" : " and reveal picks") + "</button></div>";
        }
      }
      h += '<p class="sl-msg" role="alert">' + esc(SHR.msg) + '</p><p class="shr-fine">Picks are not advice. 18+. Bet responsibly.</p>';
    }
    b.innerHTML = h;
    var a = $("#shAgree"), go = $("#shGo");
    if (a && go) a.onchange = function () { SHR.agree = a.checked; go.disabled = !a.checked || SHR.busy; };
    if (go) go.onclick = shrGo;
    var si = $("#shrStake"); if (si) { si.oninput = shrCalc; shrCalc(); }
    var chips = $("#shrChips");
    if (chips && si) chips.onclick = function (e) {
      var c = e.target.closest ? e.target.closest("button") : null; if (!c || c.disabled) return;
      var box = $("#shrMoreBox"), all = chips.querySelectorAll(".shr-chip"), i;
      for (i = 0; i < all.length; i++) all[i].classList.remove("on");
      c.classList.add("on");
      if (c.getAttribute("data-more")) { SHR.more = true; if (box) box.hidden = false; si.focus(); si.select && si.select(); }
      else { SHR.more = false; if (box) box.hidden = true; si.value = c.getAttribute("data-st"); SHR.msg = ""; }
      shrCalc();
    };
    var x; if ((x = $("#shAgain"))) x.onclick = function () { SHR.st = "peek"; SHR.agree = false; SHR.msg = ""; SHR.rid = ""; renderShr(); };
    if ((x = $("#shLogin"))) x.onclick = function () { openAuth("login"); };
    if ((x = $("#shJoin"))) x.onclick = function () { openAuth("join"); };
    if ((x = $("#shDep"))) x.onclick = function () { noFunds(); };
    if ((x = $("#shBets"))) x.onclick = function () { closeDlg($("#shrDlg")); openBets(); };
  }
  function shrPlayerHtml(d) {
    var h = '<div class="shr-card"><div class="shr-lock">' + LOCK_IC + "<span>" + (d.mine ? "Your shared slip" : "Slip shared by " + esc(d.by)) + "</span></div>" + shRow("Selections", String(d.n)) + shRow("Total odds", odds2(d.odds)) + shRow("Link expires", expFmt(d.expires) + " (" + leftFmt(d.expires) + " left)") + "</div>" +
      '<div class="shr-card">' + shLegs(d.picks) + '</div><p class="shr-note">The picks are locked. You can only choose your own stake.</p>';
    if (!S.user && S.token && !DEMO) return h + '<p class="shr-note">Checking your account...</p>';
    if (!S.user) return h + '<div class="shr-btns"><button type="button" id="shLogin" class="btn lime wide">Log in to continue</button><button type="button" id="shJoin" class="btn wide">Sign up</button></div>';
    h += '<p class="shr-note">Your balance: <b>' + esc(money(Number(S.user.balance) || 0)) + '</b></p><label class="shr-f">Your stake (KES, minimum ' + esc(String(d.minStake)) + ')<input id="shrStake" type="text" inputmode="decimal" autocomplete="off" value="' + esc(String(SHR.stake || d.minStake)) + '"></label><div id="shrCalc" class="shr-note"></div>' +
      '<label class="shr-chk"><input type="checkbox" id="shAgree"' + (SHR.agree ? " checked" : "") + "><span>I understand the picks are locked, my stake is taken immediately and normal bet rules apply." + (d.feeApplies ? " If this bet wins, " + d.pct + "% of my winnings (the part above my stake) goes to the player who shared it and I keep the rest." : "") + "</span></label>" +
      '<div class="shr-btns"><button type="button" id="shGo" class="btn lime wide"' + (SHR.agree ? "" : " disabled") + ">Place bet</button></div>";
    return h + '<p class="sl-msg" role="alert">' + esc(SHR.msg) + '</p><p class="shr-fine">Picks are not advice. 18+. Bet responsibly.</p>';
  }
  function shrCalc() {
    var d = SHR.d, el = $("#shrCalc"), si = $("#shrStake"); if (!d || !el || !si) return;
    var st = parseFloat(String(si.value).replace(/,/g, "")), go = $("#shGo");
    if (!(st > 0)) { el.textContent = ""; if (go && !d.player && d.mode === "min") go.disabled = true; return; }
    if (!d.player) {
      var ratio = d.stake > 0 ? d.potential / d.stake : d.odds, pot = $("#shrPot"), ag = $("#shrAgAmt");
      if (d.mode === "min") {
        var mnLo = Number(d.minStake || d.stake) || 0;
        if (st < mnLo) { el.textContent = "The minimum stake is " + kes0(mnLo) + ". Please enter " + kes0(mnLo) + " or more."; if (go) go.disabled = true; return; }
        if (go) go.disabled = (!d.mine && !SHR.agree) || !!SHR.busy;
      }
      SHR.stake = st; if (pot) pot.textContent = money(st * ratio); if (ag) ag.textContent = kes0(st);
      el.textContent = "Possible return about " + money(st * ratio) + ", boost included. The exact amount is confirmed when the bet is placed.";
      if (go) go.textContent = (d.mine ? "Place this bet " : "Place bet ") + kes0(st) + (d.mine ? "" : " and reveal picks");
      return;
    }
    var pot2 = st * d.odds, fee = d.feeApplies ? Math.floor((pot2 - st) * d.pct) : 0;
    el.innerHTML = "Possible return " + esc(money(pot2)) + (fee > 0 ? ". If it wins, " + esc(money(fee)) + " (" + d.pct + "% of the winnings) goes to " + esc(d.by) + " and you receive " + esc(money(pot2 - fee)) + "." : ".") + " Any multibet boost is added when the bet is placed.";
    if (go) go.textContent = "Place bet " + kes0(st);
  }
  function shrGo() {
    if (SHR.busy || !SHR.d) return;
    var pst = 0; if (SHR.d.player || SHR.d.mode === "min") { var lo = SHR.d.player ? SHR.d.minStake : (SHR.d.minStake || SHR.d.stake), hi = SHR.d.player ? C.MAX_STAKE : (Number(SHR.d.maxStake) || C.MAX_STAKE); pst = Math.round(parseFloat(String(($("#shrStake") || {}).value).replace(/,/g, "")) * 100) / 100; SHR.stake = pst; if (!(pst >= lo)) { SHR.msg = "Minimum stake is KES " + lo + "."; renderShr(); return; } if (pst > hi) { SHR.msg = "Maximum stake is KES " + hi.toLocaleString("en-KE") + "."; renderShr(); return; } if (S.user && pst > (Number(S.user.balance) || 0)) { SHR.msg = ""; renderShr(); noFunds(); return; } SHR.rid = SHR.rid || ("r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)); }
    SHR.busy = true; SHR.msg = "";
    var go = $("#shGo"); if (go) { go.disabled = true; go.textContent = "Placing bet..."; }
    api({ action: "slipPlace", token: S.token, code: SHR.code, odds: SHR.d.odds, agree: true, stake: pst, rid: SHR.rid || "" }).then(function (r) {
      SHR.busy = false;
      if (r.expired) { setSession("", null); SHR.msg = "Please log in again."; renderShr(); openAuth("login"); return; }
      if (r.ok) { if (S.user) { S.user.balance = r.balance; renderAcct(); } SHR.st = "done"; SHR.rc = r.receipt; SHR.bal = r.balance; SHR.fee = r.fee; SHR.pct = r.pct; SHR.rid = ""; apiBust(); renderShr(); return; }
      if (r.gone) { SHR.st = /expired/i.test(r.error || "") ? "exp" : "err"; SHR.msg = r.error; renderShr(); return; }
      if (r.moved) { SHR.d.odds = r.odds; SHR.d.potential = r.potential; SHR.d.boostPct = r.boostPct; SHR.rid = ""; SHR.agree = false; SHR.msg = r.error; renderShr(); return; }
      if (/not enough balance/i.test(r.error || "")) { SHR.msg = ""; renderShr(); noFunds(); return; }
      SHR.msg = r.error || "Could not place the bet."; renderShr();
    }).catch(function () { SHR.busy = false; SHR.msg = "Network problem. Tap again; it will not double-charge."; renderShr(); });
  }
  /* --- Super 5 Predictor: free, 5 exact scores --- */
  var PR = { d: null, msg: "", busy: false, rid: "" }, PRZ = { 5: 100000, 4: 20000, 3: 5000 };
  function openPredictor() { openDlg($("#prDlg")); $("#prBody").innerHTML = '<p class="shr-note">Loading...</p>'; prLoad(); }
  function prLoad() {
    api({ action: "predInfo", token: S.token || "" }).then(function (r) { PR.d = r && r.ok ? r : null; PR.msg = r && r.ok ? "" : ((r && r.error) || "Could not load the predictor."); prRender(); })
      .catch(function () { PR.d = null; PR.msg = "Network problem. Close this and try again."; prRender(); });
  }
  function prPrizes(p) {
    p = p || PRZ;
    return '<div class="shr-card"><div class="shr-lock"><span>Free to enter. Predict the exact score of all 5 matches.</span></div>' +
      shRow("5 of 5 exact", kes0(p[5]) + " cash to your wallet") + shRow("4 of 5", kes0(p[4]) + " bonus") + shRow("3 of 5", kes0(p[3]) + " bonus") +
      '</div><p class="shr-note">Each prize is shared equally if several players land in the same group. Bonus prizes are staked on 5+ matches, every match at 1.5+, minimum stake KES ' + C.MIN_STAKE + ". Entries close when the first match kicks off.</p>";
  }
  function prRow(m, pick) {
    var ok = pick && m.hs != null && pick[0] === m.hs && pick[1] === m.as;
    return '<div style="display:flex;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--line2)"><b class="jm2-no">' + m.n + '</b><span style="flex:1;min-width:0">' + esc(m.home) + " v " + esc(m.away) + "<br><small>" + esc(startFmt(m.t)) + "</small></span>" +
      (pick ? "<span>Pick <b>" + pick[0] + "-" + pick[1] + "</b></span>" : "") + (m.hs != null ? "<span>Result <b>" + m.hs + "-" + m.as + "</b> " + (pick ? (ok ? "&#9989;" : "&#10060;") : "") + "</span>" : "") + "</div>";
  }
  /* score pickers: a dropdown (0-15, the server limit) instead of typing, so no keyboard pops up and no bad entries */
  function prSel(id, team) {
    var o = '<option value="" selected>-</option>', g; for (g = 0; g <= 15; g++) o += '<option value="' + g + '">' + g + "</option>";
    return '<select id="' + id + '" class="pr-sel" aria-label="' + esc(team) + ' goals">' + o + "</select>";
  }
  function prRender() {
    var b = $("#prBody"), d = PR.d, h = "", x;
    if (!d) { b.innerHTML = '<p class="shr-err">' + esc(PR.msg) + "</p>"; return; }
    var r = d.round, mine = d.mine;
    h += prPrizes((r || d.last || {}).prizes);
    if (!r) h += '<p class="shr-note"><b>No round is open right now.</b> A new round of 5 matches is posted every weekend.</p>';
    else if (d.canEnter && !mine) {
      h += '<div class="shr-card"><div class="shr-lock"><span>Entries close in ' + esc(leftFmt(r.closes)) + "</span></div>" + r.matches.map(function (m, i) {
        var st = "width:48px;text-align:center;padding:8px 4px;border-radius:8px;border:1px solid var(--line2);background:transparent;color:inherit;font:inherit";
        return '<div style="display:flex;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--line2)"><b class="jm2-no">' + m.n + '</b><span style="flex:1;min-width:0">' + esc(m.home) + " v " + esc(m.away) + "<br><small>" + esc(startFmt(m.t)) + '</small></span>' + prSel("prH" + i, m.home) + '<b>:</b>' + prSel("prA" + i, m.away) + '</div>';
      }).join("") + "</div>" + (S.user ? '<div class="shr-btns"><button type="button" id="prSend" class="btn lime wide">Submit my 5 scores</button></div>' : '<div class="shr-btns"><button type="button" id="prLogin" class="btn lime wide">Log in to enter</button><button type="button" id="prJoin" class="btn wide">Sign up free</button></div>');
    } else if (mine) {
      h += '<div class="shr-card"><div class="shr-lock">' + OK_IC + "<span>" + (d.canEnter ? "You are in. Entries close in " + esc(leftFmt(r.closes)) : r.status === "settled" ? "Round finished" : "Your entry is locked in") + "</span></div>" + r.matches.map(function (m, i) { return prRow(m, mine.picks[i]); }).join("") + "</div>";
      if (mine.correct != null) h += '<p class="shr-note"><b>You got ' + mine.correct + " of " + d.size + " exact.</b>" + (mine.status === "paid" ? " Prize paid: " + esc(kes0(mine.prize)) + (mine.tier === 5 ? " to your wallet." : " to your bonus balance.") : r.status === "awaiting" ? " Prizes are being confirmed." : "") + "</p>";
      var sl = mine.slip;
      if (sl) {
        h += '<div class="shr-card"><div class="shr-lock"><span>Turn your scores into a bet (1X2)</span></div>' + sl.legs.map(function (g) { return '<div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid var(--line2)"><b class="jm2-no">' + g.n + '</b><span style="flex:1">' + esc(g.home) + " v " + esc(g.away) + "<br><small>" + esc(pickName("1x2", g.l, g.home, g.away)) + "</small></span><b>" + odds2(g.price) + "</b></div>"; }).join("") +
          (sl.legs.length ? shRow("Total odds", odds2(sl.total), true) : "") + "</div>" + (sl.missing.length ? '<p class="shr-note">Match ' + esc(sl.missing.join(", ")) + " can no longer be bet on, so the full bet is not available.</p>" : "") +
          '<div class="shr-btns">' + (sl.ok ? '<button type="button" id="prBet" class="btn lime wide">Turn this into a bet</button>' : "") + '<button type="button" id="prShare" class="btn wide"' + (sl.legs.length ? "" : " disabled") + ">Challenge your friends</button></div><div id=\"prOut\"></div>";
      }
    } else if (r.status === "open" || r.status === "awaiting") h += '<div class="shr-card"><div class="shr-lock"><span>' + (r.status === "awaiting" ? "Waiting for prizes" : "Entries closed") + "</span></div>" + r.matches.map(function (m) { return prRow(m, null); }).join("") + "</div>";
    if (d.last && (!r || r.id !== d.last.id)) h += '<div class="shr-card"><div class="shr-lock"><span>Last round' + (d.lastMine ? ": you got " + d.lastMine.correct + " of " + d.size : "") + "</span></div>" + d.last.matches.map(function (m, i) { return prRow(m, d.lastMine ? d.lastMine.picks[i] : null); }).join("") + "</div>";
    b.innerHTML = h + '<p id="prMsg" class="sl-msg" role="alert">' + esc(PR.msg) + '</p><p class="shr-fine">Free to play. 18+. Bet responsibly.</p>';
    if ((x = $("#prSend"))) x.onclick = prSend; if ((x = $("#prBet"))) x.onclick = prToSlip; if ((x = $("#prShare"))) x.onclick = prShare;
    if ((x = $("#prLogin"))) x.onclick = function () { openAuth("login"); }; if ((x = $("#prJoin"))) x.onclick = function () { openAuth("join"); };
  }
  function prSend() {
    if (PR.busy || !PR.d || !PR.d.round) return;
    var sc = [], msg = $("#prMsg"), n = PR.d.round.matches.length, i;
    for (i = 0; i < n; i++) { var hh = ($("#prH" + i).value || "").trim(), aa = ($("#prA" + i).value || "").trim(); if (!/^\d{1,2}$/.test(hh) || !/^\d{1,2}$/.test(aa)) { msg.textContent = "Enter a score for every match (whole numbers)."; return; } sc.push([Number(hh), Number(aa)]); }
    PR.rid = PR.rid || ("e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)); PR.busy = true; var btn = $("#prSend"); if (btn) { btn.disabled = true; btn.textContent = "Sending..."; }
    api({ action: "predSubmit", token: S.token, round: PR.d.round.id, rid: PR.rid, scores: sc }).then(function (r) {
      PR.busy = false;
      if (r.expired) { setSession("", null); closeDlg($("#prDlg")); openAuth("login"); return; }
      if (!r.ok) { PR.msg = r.error || "Could not send your scores."; PR.rid = ""; prRender(); return; }
      PR.rid = ""; PR.msg = ""; toast("Your 5 scores are in. Good luck!"); prLoad();
    }).catch(function () { PR.busy = false; if (btn) { btn.disabled = false; btn.textContent = "Submit my 5 scores"; } msg.textContent = "Network problem. Tap again; it will not enter twice."; });
  }
  function prToSlip() {
    var sl = PR.d && PR.d.mine && PR.d.mine.slip; if (!sl || !sl.ok) return;
    S.slip.clear(); var n = 0;
    sl.legs.forEach(function (g) { var m = byId(g.mid), k = m && mkt(m, "1x2"), o = k && outc(k, g.l); if (m && o && m.t > Date.now()) { S.slip.set(g.mid, { mk: "1x2", l: g.l, base: o.p, home: m.home, away: m.away, title: k.title, t: m.t }); n++; } });
    S.slip.forEach(function (v, mid) { syncOdds(mid); }); renderSlip(); closeDlg($("#prDlg"));
    toast(n === sl.legs.length ? "Your 5 picks are on the slip. Choose your stake." : "Some matches are not available any more."); var sb = $("#bnavSlip"); if (sb) sb.click();
  }
  function prShare() {
    var d = PR.d, sl = d && d.mine && d.mine.slip, msg = $("#prMsg"), btn = $("#prShare"); if (!sl || !sl.legs.length) return; msg.textContent = ""; btn.disabled = true;
    api({ action: "pshare", token: S.token, legs: sl.legs.map(function (g) { return { mid: g.mid, mk: "1x2", l: g.l }; }) }).then(function (r) {
      btn.disabled = false;
      if (r.expired) { setSession("", null); closeDlg($("#prDlg")); openAuth("login"); return; }
      if (!r.ok) { msg.textContent = r.error || "Could not create the link."; return; }
      var url = shareUrl(r.code, r.promo), names = d.round.matches.map(function (m, i) { return m.home + " " + d.mine.picks[i][0] + "-" + d.mine.picks[i][1] + " " + m.away; }).join(", "),
        txt = "My Super 5 Predictor scores on 247BET: " + names + ". Bet my picks with your own stake, or predict your own scores free: " + url;
      $("#prOut").innerHTML = '<p class="shr-note"><b>Your link is ready.</b> Friends see the 5 picks and choose their own stake.</p><input class="shr-link" id="prLink" readonly value="' + esc(url) + '" aria-label="Link"><div class="shr-btns"><a class="btn lime wide" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(txt) + '">Challenge your friends on WhatsApp</a><button type="button" id="prCp" class="btn wide">Copy link</button></div>';
      $("#prCp").onclick = function () { var i = $("#prLink"); i.select(); try { document.execCommand("copy"); toast("Link copied."); } catch (e) {} };
    }).catch(function () { btn.disabled = false; msg.textContent = "Network problem. Try again."; });
  }
  /* ---------- Share & Earn: the program screen (bottom bar and menu) ---------- */
  var SE_IC = "";
  function openShareEarn() {
    var b = $("#seBody"); openDlg($("#seDlg")); b.innerHTML = '<p class="shr-note">Loading...</p>';
    if (!S.user) { seRender(b, null); return; }
    api({ action: "pshareStats", token: S.token }).then(function (r) {
      if (r && r.expired) { setSession("", null); seRender(b, null); return; }
      seRender(b, r && r.ok ? r : false);
    }).catch(function () { seRender(b, false); });
  }
  function seRender(b, r) {
    var pct = (r && r.pct) || 5, days = (r && r.days) || 14, minS = (r && r.minStake) || C.MIN_STAKE || 50;
    var h = '<div class="se-hero"><b>' + pct + '%</b><span>Share your bet. Earn when your friends win.</span><small>When a friend\'s bet from your link wins, ' + pct + '% of their winnings is yours.</small></div>' +
      '<ul class="se-steps"><li><i>1</i><span><b>Build your slip</b> and tap Share on the slip. The picks are locked.</span></li>' +
      '<li><i>2</i><span><b>Send the link</b> on WhatsApp. Each friend picks their own stake.</span></li>' +
      '<li><i>3</i><span><b>Earn ' + pct + '%</b> of the winnings when their bet wins, paid as a Share bonus.</span></li></ul>';
    if (r === false) h += '<p class="shr-err">Could not load your Share &amp; Earn status. Check your connection and try again.</p>';
    else if (r && r.partner) h += '<p class="shr-note"><b>You are an approved partner.</b> Partners share slips from their Partner links, and earn commission through the affiliate programme instead.</p>';
    else if (r) {
      if (r.on === false) h += '<p class="shr-warn">Share &amp; Earn is paused right now. Links already created still work.</p>';
      h += '<div class="se-tiles"><div><b>' + r.links + '</b><small>Links shared</small></div><div><b>' + r.opens + '</b><small>Link opens</small></div><div><b>' + r.bets + '</b><small>Friends\' bets</small></div></div>' +
        '<div class="se-tiles"><div class="k"><b>' + esc(kes0(r.earned)) + '</b><small>Earned</small></div><div class="k"><b>' + esc(kes0(r.usable)) + '</b><small>Ready to use</small></div><div><b>' + esc(kes0(r.used)) + '</b><small>Used or expired</small></div></div>' +
        (r.usable > 0 && r.until ? '<p class="shr-note">Your ready-to-use Share bonus expires in <b>' + (r.until - Date.now() > 864e5 ? Math.ceil((r.until - Date.now()) / 864e5) + ' days' : leftFmt(r.until)) + '</b>. Each new credit extends it to ' + days + ' days.</p>' : "");
    }
    h += '<p class="se-rule"><b>How it is paid:</b> the ' + pct + '% is added to your <b>bonus balance</b> (not cash). Stake it on <b>5 or more matches, every match at odds of 1.5+</b>, minimum stake KES ' + minS + '. It lasts ' + days + ' days after your last credit and never locks withdrawals. Bets from your own device or account do not count.</p>';
    if (!r && r !== false) h += '<div class="shr-btns"><button type="button" id="seLogin" class="btn lime wide">Log in to start earning</button></div>';
    else if (!(r && r.partner)) h += '<div class="shr-btns"><button type="button" id="seSlip" class="btn lime wide">Share my slip</button><button type="button" id="sePred" class="btn wide">Share my Predictor picks</button></div><div id="seMine" class="shr-mine"></div>';
    b.innerHTML = h;
    var x = $("#seLogin"); if (x) x.onclick = function () { closeDlg($("#seDlg")); openAuth("login"); };
    x = $("#seSlip"); if (x) x.onclick = function () {
      closeDlg($("#seDlg"));
      if (slipItems().filter(function (i) { return i.live; }).length) openShare(); else toast("Add your picks to the slip first, then tap Share.");
    };
    x = $("#sePred"); if (x) x.onclick = function () { closeDlg($("#seDlg")); openPredictor(); };
    if ($("#seMine")) seMine();
  }
  function seMine() {
    var box = $("#seMine"); if (!box) return;
    api({ action: "slipMine", token: S.token }).then(function (r) {
      if (!r || !r.ok || !r.list || !r.list.length) { box.innerHTML = ""; return; }
      box.innerHTML = "<h3>Your recent links</h3>" + r.list.map(function (x) {
        return '<div class="shr-mr"><span><b>' + esc(x.code) + "</b> • " + x.n + (x.n === 1 ? " pick" : " picks") + "</span><span>" + x.opens + " opened • " + x.bets + " bet" + (x.bets === 1 ? "" : "s") + " • " + (x.expires > Date.now() ? leftFmt(x.expires) + " left" : "expired") + "</span></div>";
      }).join("");
    }).catch(function () {});
  }
  $("#slipShare").addEventListener("click", openShare);
  $("#authDlg").addEventListener("close", function () { if ($("#shrDlg").open) renderShr(); });

  /* ---------- brand images: splash, popup, backgrounds ---------- */
  (function () {
    var I = C.IMAGES || {}, root = document.documentElement;
    function probe(src, ok) { if (!src) return; var im = new Image(); im.onload = function () { ok(src); }; im.src = src; }
    probe(I.splash, function (u) { root.style.setProperty("--splash-bg", 'url("' + u + '")'); });
    setTimeout(function () {   // page backgrounds are decoration: fetched after the page is usable, so they never compete with the odds
      probe(I.matches, function (u) { root.style.setProperty("--matches-bg", 'url("' + u + '")'); var f = $("#feed"); if (f) f.classList.add("has-bg"); });
      probe(I.offers, function (u) { root.style.setProperty("--offers-bg", 'url("' + u + '")'); });
    }, 1800);
    var im = $("#spImg"); if (im && I.loading) im.src = I.loading;
    
    var t0 = Date.now(), gone = false, sp = $("#splash");
    function showPopup() {
      var seen = false; try { seen = !!localStorage.getItem("q247.pop"); } catch (e) {}
      if (C.POPUP_ONCE !== false && seen) return;
      if (S.user || S.token || REFGO || DEPGO || (SHR && SHR.code)) return;                 // already a member, or opened a shared slip: no welcome popup
      try { localStorage.setItem("q247.pop", "1"); } catch (e) {}
      var pi = $("#popImg"); if (pi && I.popup && !pi.getAttribute("src")) pi.src = I.popup;
      var d = $("#popDlg"); if (d) openDlg(d);
    }
    function hide() {
      if (gone) return; gone = true;
      var go = false; try { go = refEntry(); } catch (e) { console.error(e); }
      if (!go) { try { go = depLinkEntry(); } catch (e) { console.error(e); } }
      if (!go) { try { go = goLinkEntry(); } catch (e) { console.error(e); } }
      try { NAV.start(go); } catch (e) { console.error(e); }
      if (sp) { sp.classList.add("out"); setTimeout(function () { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 600); }
      setTimeout(function () { showPopup(); SAT.ui = true; satTry(); }, 700);
    }
    var iv = setInterval(function () {
      var ready = !S.loading || S.matches.length || S.failed;
      if ((ready && Date.now() - t0 > 350) || Date.now() - t0 > 1200) { clearInterval(iv); hide(); }   // never waits for the network: cached matches, else 1.2 s at most
    }, 40);
  })();
  document.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("[data-popclose]"); if (b) { var d = $("#popDlg"); if (d && d.open) closeDlg(d); } });

  /* ---------- v5: refresh returns to the same place (URL hash + sessionStorage) ---------- */
  var NAV = (function () {
    var KEY = "q247.nav", DAYS = { all: 1, today: 1, tomorrow: 1 }, WINS = { auth: 1, bets: 1, jp: 1, iw: 1, info: 1, aff: 1 };
    var o = { on: false, off: false, info: "", want: null, pendL: "", hold: null, last: "", save: function () {}, start: function () {} };
    function fromHash() {
      var h = (location.hash || "").replace(/^#/, ""); if (h.indexOf("=") < 0) return null;
      var r = {}; h.split("&").forEach(function (p) { var i = p.indexOf("="); if (i > 0) { try { r[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1)); } catch (e) {} } });
      return (r.d || r.l || r.w || r.y) ? r : null;
    }
    function fromStore() { try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
    function navType() { try { var n = performance.getEntriesByType("navigation")[0]; return n ? n.type : ""; } catch (e) { return ""; } }
    var saved = fromHash();
    if (!saved) { var nt = navType(); if (nt === "reload" || nt === "back_forward") saved = fromStore(); }
    if (saved) {
      if (DAYS[saved.d]) S.day = saved.d;
      if (saved.l && saved.l !== "all") { S.league = String(saved.l).slice(0, 80); o.pendL = S.league; }
      o.want = saved;
    }
    function cur() {
      if ($("#authDlg").open) { var t = S.user ? acTab : (authTab === "join" ? "join" : "login"); return { w: "auth", t: t }; }
      if ($("#betsDlg").open) return { w: "bets", t: MB.tab };
      if ($("#jpDlg").open) return { w: "jp", t: jpSel || "" };
      if ($("#iwDlg").open) return { w: "iw", t: iwCat };
      if ($("#infoDlg").open && o.info) return { w: "info", t: o.info };
      if ($("#affDlg").open) return { w: "aff", t: "" };
      return { w: "", t: "" };
    }
    function writeHash(st) {
      var p = [];
      if (st.d && st.d !== "all") p.push("d=" + encodeURIComponent(st.d));
      if (st.l && st.l !== "all") p.push("l=" + encodeURIComponent(st.l));
      if (st.w) { p.push("w=" + st.w); if (st.t) p.push("t=" + encodeURIComponent(st.t)); }
      if (st.y > 40) p.push("y=" + st.y);
      try { history.replaceState(null, "", location.pathname + location.search + (p.length ? "#" + p.join("&") : "")); } catch (e) {}
    }
    function save(force) {
      if (!o.on || o.off) return;
      var w = cur(), y = o.hold !== null ? o.hold : Math.round(window.pageYOffset || 0);
      var st = { d: S.day === "search" ? "all" : S.day, l: (o.pendL && S.league === "all") ? o.pendL : S.league, w: w.w, t: w.t, y: y };
      try { sessionStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {}
      var sig = [st.d, st.l, st.w, st.t].join("|");
      if (force || sig !== o.last) { o.last = sig; writeHash(st); }
    }
    function openWin(w, t) {
      if (w === "auth") { if (S.user) { openAuth("account"); acTab = t || "home"; renderAuth(); } else openAuth(t === "join" ? "join" : "login"); }
      else if (w === "bets") { if (S.user) openBets(t === "jps" ? "jps" : "bets"); }
      else if (w === "jp") { jpSel = (t === "MID" || t === "WKD") ? t : ""; jpPick = {}; jpDc = 0; jpRid = ""; loadJackpots(); }
      else if (w === "iw") { openInstant(); if (IW_CATS.indexOf(t) > -1) { iwCat = t; renderInstant(); } }
      else if (w === "info") { if (t) openInfo(t); }
      else if (w === "aff") { if (S.user) openAff("dash"); }
    }
    o.save = save;
    o.start = function (skipWin) {        // called as the splash hides: the page is already in its saved state
      var s = o.want; o.on = true;
      if (s && !skipWin && WINS[s.w]) { try { openWin(s.w, String(s.t || "")); } catch (e) { console.error(e); } }
      var ty = s ? (Number(s.y) || 0) : 0;
      if (ty > 0) {
        var tries = 0; o.hold = ty;
        (function go() { window.scrollTo(0, ty); if (tries++ < 6 && Math.abs((window.pageYOffset || 0) - ty) > 30) setTimeout(go, 350); else o.hold = null; })();
      }
      save(true);
    };
    /* a league saved before the matches arrived is applied once they do */
    var wt = 0, wi = setInterval(function () {
      if (!o.pendL || ++wt > 40) { clearInterval(wi); if (wt > 40) o.pendL = ""; return; }
      if (S.league !== "all") { o.pendL = ""; return; }
      if (S.matches.some(function (m) { return m.league === o.pendL; })) { S.league = o.pendL; o.pendL = ""; refreshAll(); }
    }, 200);
    var hT = 0;
    window.addEventListener("scroll", function () { if (!o.on) return; clearTimeout(hT); hT = setTimeout(function () { save(true); }, 700); }, { passive: true });
    window.addEventListener("pagehide", function () { save(false); });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") save(false); });
    setInterval(function () { save(false); }, 2500);
    try { var mo = new MutationObserver(function () { save(false); }); ["authDlg", "betsDlg", "jpDlg", "iwDlg", "infoDlg", "affDlg"].forEach(function (id) { var d = document.getElementById(id); if (d) mo.observe(d, { attributes: true, attributeFilter: ["open"] }); }); } catch (e) {}
    /* the logo and the Matches link take you home: forget the saved place */
    document.addEventListener("click", function (e) {
      if (e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest('a.brand,a[href="./"]'); if (!a) return;
      o.off = true; try { sessionStorage.removeItem(KEY); history.replaceState(null, "", location.pathname + location.search); } catch (x) {}
      setTimeout(function () { o.off = false; }, 1500);
    }, true);
    return o;
  })();

  /* ---------- v5: text that fits every screen (only the tight spots are measured) ---------- */
  (function () {
    var SEL = ".teams span,.odd b,.odd i,.slip .sel-m,.mh-lg,.lim-tiles b,.dbal b,.sp-t,.bnav a,.bnav button,.acts .btn,.mi-t,.dm-t b", tm = 0, lastW = 0, lastF = 0;
    function tight() { var w = window.innerWidth || document.documentElement.clientWidth || 360, f = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16; return w <= 420 || f > 17.5; }
    function fit() {
      if (!tight() && !document.querySelector("[data-fit]")) return;
      var els = $$(SEL), i, el, sz, n = 0;
      for (i = 0; i < els.length; i++) { el = els[i]; if (el.getAttribute("data-fit")) { el.style.fontSize = ""; el.removeAttribute("data-fit"); } }
      if (!tight()) return;
      for (i = 0; i < els.length && n < 500; i++) {
        el = els[i]; if (!el.offsetParent) continue; n++;
        if (el.scrollWidth <= el.clientWidth + 1) continue;
        sz = parseFloat(getComputedStyle(el).fontSize) || 14;
        while (el.scrollWidth > el.clientWidth + 1 && sz > 9) { sz -= 0.5; el.style.fontSize = sz + "px"; }
        el.setAttribute("data-fit", "1");
      }
    }
    function run() { if (document.hidden) return; fit(); }
    function later() { clearTimeout(tm); tm = setTimeout(function () { if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 900 }); else run(); }, 320); }   // runs when the phone is idle, not on every tiny page change
    function onSize() {   /* the keyboard changes only the height: nothing to refit then */
      var w = window.innerWidth || 0, f = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      if (w === lastW && f === lastF) return; lastW = w; lastF = f; later();
    }
    window.addEventListener("resize", onSize); window.addEventListener("orientationchange", onSize);
    try { new MutationObserver(later).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    later();
  })();

  /* ---------- layout self-check: open the site with ?layout=debug to outline anything that overflows or wraps badly ---------- */
  (function () {
    if (!/[?&]layout=debug(&|$)/.test(location.search)) return;
    var bar = document.createElement("button"), box = document.createElement("div"), tm = 0, last = "";
    bar.type = "button"; bar.id = "lyDbg"; box.id = "lyPanel"; box.hidden = true;
    document.body.appendChild(bar); document.body.appendChild(box);
    function nm(el) { return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""); }
    function scan() {
      var old = document.querySelectorAll(".ly-bad"), i, el, r, cs, tn, n, rg, tops, tl, list = [], seen = {};
      for (i = 0; i < old.length; i++) old[i].classList.remove("ly-bad");
      var W = Math.min(window.innerWidth, (window.screen && screen.width) || 99999), all = document.body.getElementsByTagName("*");
      var skip = "[hidden],#splash,.promo-run,.hs-track,.hs-slide,#chips,.chips,.fcols,.sr,#lyDbg,#lyPanel,dialog:not([open])";
      function scrolls(e) { for (var a = e.parentElement; a && a !== document.documentElement; a = a.parentElement) { var o = getComputedStyle(a); if (/(auto|scroll)/.test(o.overflowX) && a.scrollWidth > a.clientWidth + 1) return true; } return false; }
      function flag(e, why) { var k = nm(e) + why; if (seen[k]) return; seen[k] = 1; e.classList.add("ly-bad"); list.push(why + "  " + nm(e)); }
      for (i = 0; i < all.length; i++) {
        el = all[i]; if (el.tagName === "svg" || el.closest("svg") || el.closest(skip)) continue;
        cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden") continue;
        r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
        if ((r.right > W + 1 || r.left < -1) && !scrolls(el)) flag(el, "sticks out " + Math.round(r.left) + ".." + Math.round(r.right));
        if (!el.children.length && el.textContent.trim() && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && /(hidden|clip)/.test(cs.overflowX) && cs.textOverflow !== "ellipsis") flag(el, "text cut");
        if (/^(BUTTON|A)$/.test(el.tagName)) {
          tn = []; for (n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.textContent.trim()) tn.push(n);
          tl = tn.map(function (t) { return t.textContent.trim(); }).join(" ");
          if (tn.length && tl.length < 18) { tops = {}; tn.forEach(function (t) { rg = document.createRange(); rg.selectNodeContents(t); [].forEach.call(rg.getClientRects(), function (q) { if (q.width > 2) tops[Math.round(q.top / 5)] = 1; }); }); if (Object.keys(tops).length > 1) flag(el, "label wraps"); }
        }
      }
      var d = document.documentElement, over = d.scrollWidth - W; if (over > 1) list.unshift("page is " + over + "px wider than the screen");
      var head = window.innerWidth + "x" + window.innerHeight + " " + (d.getAttribute("data-screen") || "") + (d.getAttribute("data-bigtext") ? " bigtext" : "") + (d.getAttribute("data-short") ? " short" : "");
      bar.textContent = head + " | " + (list.length ? list.length + " issue" + (list.length > 1 ? "s" : "") : "clean");
      bar.className = list.length ? "bad" : "ok";
      last = head + "\n" + (list.length ? list.slice(0, 40).join("\n") : "No layout issues found on this screen.");
      box.textContent = last;
    }
    function later() { clearTimeout(tm); tm = setTimeout(scan, 500); }
    bar.addEventListener("click", function () { box.hidden = !box.hidden; if (!box.hidden) { scan(); try { navigator.clipboard.writeText(last); } catch (e) {} } });
    window.addEventListener("resize", later); window.addEventListener("orientationchange", later);
    try { new MutationObserver(later).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    setTimeout(scan, 1500);
  })();

  /* ---------- start ---------- */
  var saved = store("q247.stake"); if (saved) { S.stake = String(saved); $("#stake").value = Number(S.stake).toLocaleString("en-KE"); }
  syncInert();
  if (!DEMO) {
    var c = store(CACHE_KEY);
    if (c && c.data && Date.now() - c.at < 6 * 3600 * 1000) { S.matches = normaliseAll(c.data); S.savedAt = c.at; S.loading = false; }
  }
  S.token = store("q247.tok") || (function () { try { return sessionStorage.getItem("q247.tok") || ""; } catch (e) { return ""; } })(); S.user = null;
  if (S.token) { try { S.user = store("q247.user") || JSON.parse(sessionStorage.getItem("q247.user") || "null"); } catch (e) { S.user = null; } }   // shown at once, refreshed below
  renderAcct();
  function bootMe(n) {
    api({ action: "me", token: S.token }).then(function (r) {
      if (r.ok) {
        S.user = r.user; try { if (store("q247.tok")) store("q247.user", S.user); else sessionStorage.setItem("q247.user", JSON.stringify(S.user)); } catch (e) {}
        renderAcct(); loadTaskFlag(); if (typeof shrAfterAuth === "function") shrAfterAuth(false);
      } else if (r.expired) { if (n < 2) setTimeout(function () { bootMe(n + 1); }, 1500); else setSession("", null); }   // never sign out on one answer
    }).catch(function () { if (n < 3) setTimeout(function () { bootMe(n + 1); }, 2500); });
  }
  if (S.token && !DEMO) { if (S.user) loadTaskFlag(); bootMe(0); }
  refreshAll();
  try { if (sessionStorage.getItem("q247.wdmsg")) { sessionStorage.removeItem("q247.wdmsg"); setTimeout(function () { openAuth("login"); authNote = "You were signed out of this account. Sign in again with the current password."; renderAuth(); }, 400); } } catch (e) {}
  load(false);
  prefetch();
  shrBoot();
  setInterval(function () { if (document.visibilityState === "visible") load(false); }, C.REFRESH_MS);
})();
