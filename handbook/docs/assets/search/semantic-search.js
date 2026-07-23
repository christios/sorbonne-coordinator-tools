/*
 * Unified search for the SCEN Coordinator Handbook.
 *
 * One search box (the theme's header box) → a modal with two stages:
 *   1. INSTANT  — keyword ranking, on the MAIN thread (no model, feels instant).
 *   2. REFINED  — two-stage semantic ranking (bi-encoder retrieve → cross-encoder
 *                 rerank), run entirely in a WEB WORKER so the UI never freezes.
 *
 * Fully client-side. The worker owns the ML models (multilingual-e5-small q8 +
 * ms-marco-MiniLM-L-6-v2 q8, ~135 MB, cached after first use). Nothing is sent
 * anywhere. Loaded as a classic script; pulls ESM deps via dynamic import().
 */
(function () {
  "use strict";

  // ---- config -------------------------------------------------------------
  var DATA_URL = "assets/search/search-data.json";
  var WORKER_URL = "assets/search/search-worker.js";
  var LIMIT = 8;           // results shown
  var RERANK_POOL = 12;    // lexical candidates handed to the reranker (covers the
                           // measured recall depth ~#10 with margin; fewer = faster)
  var STOP = new Set(
    ("the a an of to in on for and or is are be do does how what who when where which that this " +
      "these those i you it my your we our can could should would with as at by from about into " +
      "need needs want get got have has not no any all more most some such very than then there " +
      "here their them they its").split(" ")
  );

  function stem(t) { return t.length > 4 && t.charAt(t.length - 1) === "s" ? t.slice(0, -1) : t; }
  function hasTerm(hay, t) {
    try { return new RegExp("\\b" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(hay); }
    catch (e) { return hay.indexOf(t) !== -1; }
  }
  function tokens(s) {
    var m = s.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
    var seen = {}, out = [];
    for (var i = 0; i < m.length; i++) {
      var t = stem(m[i]);
      if (!seen[t] && !STOP.has(t) && !STOP.has(m[i])) { seen[t] = 1; out.push(t); }
    }
    return out;
  }

  function siteBase() {
    var logo = document.querySelector(".md-header__button.md-logo, a.md-logo");
    var href = logo ? logo.getAttribute("href") : "./";
    try { return new URL(href, window.location.href); } catch (e) { return new URL("./", window.location.href); }
  }
  function withBase(rel) {
    try { return new URL(rel, siteBase()).href; } catch (e) { return rel; }
  }
  function escapeHtml(s) {
    return (s || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---- lightweight index (main thread) — for instant keyword + highlight ---
  var liteP = null;
  function initLite() {
    if (liteP) return liteP;
    liteP = (async function () {
      var res = await fetch(withBase(DATA_URL));
      if (!res.ok) throw new Error("index fetch failed: " + res.status);
      var data = await res.json();
      var records = data.records;
      var hay = records.map(function (r) {
        return (r.title + " " + r.section + " " + r.content).toLowerCase();
      });
      var N = records.length;
      var DF = {};
      var dfOf = function (t) {
        if (DF[t] === undefined) {
          var c = 0;
          for (var i = 0; i < hay.length; i++) if (hasTerm(hay[i], t)) c++;
          DF[t] = c;
        }
        return DF[t];
      };
      return { records: records, hay: hay, N: N, dfOf: dfOf };
    })();
    return liteP;
  }

  function queryTerms(s, q) {
    var all = tokens(q).filter(function (t) { return s.dfOf(t) > 0; });
    var idf = {};
    all.forEach(function (t) { idf[t] = Math.log((s.N + 1) / (s.dfOf(t) + 1)); });
    return all.map(function (t) { return { t: t, idf: idf[t] }; });
  }

  function dedupe(scored, n) {
    var seen = {}, out = [];
    for (var i = 0; i < scored.length && out.length < n; i++) {
      var page = scored[i].doc.url.split("#")[0];
      if (seen[page]) continue;
      seen[page] = 1;
      out.push(scored[i]);
    }
    return out;
  }

  /**
   * Lexical retrieval (idf-weighted term coverage). Returns the display top-LIMIT
   * (instant) plus a broader candidate `pool` for the reranker.
   */
  async function runLexical(q) {
    var s = await initLite();
    var terms = queryTerms(s, q);
    if (!terms.length) return { hits: [], pool: [], terms: [] };
    var total = terms.reduce(function (a, o) { return a + o.idf; }, 0) || 1;
    var scored = [];
    for (var i = 0; i < s.records.length; i++) {
      var cov = 0;
      for (var j = 0; j < terms.length; j++) if (hasTerm(s.hay[i], terms[j].t)) cov += terms[j].idf;
      if (cov > 0) scored.push({ doc: s.records[i], score: cov / total });
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    var pool = dedupe(scored, RERANK_POOL);
    return { hits: pool.slice(0, LIMIT), pool: pool, terms: terms };
  }

  // ---- UI -----------------------------------------------------------------
  var openModal = null;  // set by buildUI
  var warmSearch = null; // set by buildUI — preloads the reranker

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (html != null) e.innerHTML = html;
    return e;
  }

  function buildUI() {
    var overlay = el("div", { id: "ss-overlay", "aria-hidden": "true" });
    overlay.innerHTML =
      '<div id="ss-modal" role="dialog" aria-modal="true" aria-label="Search">' +
      '  <div id="ss-head">' +
      '    <input id="ss-input" type="text" autocomplete="off" spellcheck="false" ' +
      '           placeholder="Search — plain words or a question, e.g. can a student resit a course they passed?" />' +
      '    <button id="ss-close" aria-label="Close">✕</button>' +
      "  </div>" +
      '  <div id="ss-status"></div>' +
      '  <div id="ss-results"></div>' +
      '  <div id="ss-foot"><span id="ss-stage">Keyword results — refining by meaning…</span></div>' +
      "</div>";
    document.body.appendChild(overlay);

    var input = overlay.querySelector("#ss-input");
    var status = overlay.querySelector("#ss-status");
    var results = overlay.querySelector("#ss-results");
    var stageEl = overlay.querySelector("#ss-stage");

    function setStage(txt, busy) {
      stageEl.textContent = txt;
      stageEl.className = busy ? "ss-busy" : "";
    }

    // ---- worker (created once, lazily) — reranks the lexical candidate pool ----
    var worker = null, workerReady = false, workerFailed = false, backend = "";
    var warmSent = false;  // the worker ignores repeat warms; don't spam it either
    var dlPct = -1;        // model download progress, -1 until the first report
    var lastRun = 0;
    var pending = null; // { id, pool, terms, q } for the query awaiting a rerank
    function getWorker() {
      if (worker || workerFailed) return worker;
      try {
        worker = new Worker(withBase(WORKER_URL), { type: "module" });
      } catch (e) { workerFailed = true; setStage("Keyword only (reranker unavailable)", false); return null; }
      worker.onmessage = function (ev) {
        var m = ev.data || {};
        if (m.type === "progress") {
          dlPct = m.pct;
          if (pending) setLoadingMsg(waitingMsg());
          else setStage("Downloading search model — " + m.pct + "%", true);
        } else if (m.type === "status") {
          if (m.text === "ready") {
            workerReady = true;
            // A query may have been waiting on the download — retitle its spinner.
            if (pending) setLoadingMsg(waitingMsg()); else setStage("Ready.", false);
          }
          else if (m.text.indexOf("backend:") === 0) { backend = m.text.slice(8); } // diagnostic only
          else if (pending) setLoadingMsg(waitingMsg());
          else setStage(m.text, true);
        } else if (m.type === "rerank") {
          if (!pending || m.id !== pending.id || m.id !== lastRun) return; // superseded
          clearTimeout(rerankTimer);
          var reranked = m.order.map(function (i) { return pending.pool[i]; }).slice(0, LIMIT);
          render({ hits: reranked.map(function (d) { return { doc: d }; }), terms: pending.terms }, pending.q);
          setStage("Ranked by meaning", false);
          pending = null;
        } else if (m.type === "error") {
          if (pending && m.id === pending.id) { fallbackToKeyword("reranker unavailable"); }
        }
      };
      worker.onerror = function () {
        workerFailed = true;
        if (pending) fallbackToKeyword("reranker error");
      };
      return worker;
    }

    // Show the keyword results we already have, when reranking can't complete.
    function fallbackToKeyword(reason) {
      clearTimeout(rerankTimer);
      if (!pending) return;
      render({ hits: pending.lexHits, terms: pending.terms }, pending.q);
      setStage("Keyword results (" + reason + ")", false);
      pending = null;
    }

    function close() {
      overlay.classList.remove("ss-open");
      overlay.setAttribute("aria-hidden", "true");
    }
    function open(prefill) {
      overlay.classList.add("ss-open");
      overlay.setAttribute("aria-hidden", "false");
      if (prefill && prefill !== input.value) { input.value = prefill; schedule(); }
      setTimeout(function () { input.focus(); input.select(); }, 30);
      initLite().catch(function (e) { status.textContent = "Failed to load index: " + e.message; });
      warmSearch();
    }
    openModal = open;
    // Preload the reranker in the background so it's ready before the user searches.
    warmSearch = function () {
      if (warmSent) return;
      var w = getWorker();
      if (!w) return;
      warmSent = true;
      setStage("Starting search…", true);
      w.postMessage({ type: "warm" });
    };

    overlay.querySelector("#ss-close").addEventListener("click", close);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay.classList.contains("ss-open")) close();
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        overlay.classList.contains("ss-open") ? close() : open("");
      }
    });

    var timer = null, rerankTimer = null;
    function schedule() {
      clearTimeout(timer);
      var q = input.value.trim();
      if (q.length < 2) { results.innerHTML = ""; status.textContent = "Type a word or a question."; return; }
      timer = setTimeout(function () { doQuery(q); }, 180);
    }
    function showLoading(msg) {
      status.textContent = "";
      results.innerHTML =
        '<div class="ss-loading"><span class="ss-spinner"></span>' +
        '<span class="ss-loading-msg"></span></div>';
      results.querySelector(".ss-loading-msg").textContent = msg;
    }
    // Update the centred loading text in place (used for download progress).
    function setLoadingMsg(msg) {
      var m = results.querySelector(".ss-loading-msg");
      if (m) m.textContent = msg;
    }
    // What to show while we wait, given what the worker is currently doing.
    function waitingMsg() {
      if (workerReady) return "Ranking results by meaning…";
      if (dlPct >= 0) return "Downloading search model — " + dlPct + "%";
      return "Starting search…";
    }
    async function doQuery(q) {
      var runId = ++lastRun;
      try {
        var lex = await runLexical(q); // instant, main thread
        if (runId !== lastRun) return;
        var w = getWorker();
        if (w && !workerFailed && lex.pool.length) {
          // Don't present the provisional keyword order as final — hold the view
          // with a loading state until the reranker returns the real ranking.
          pending = { id: runId, pool: lex.pool.map(function (h) { return h.doc; }), terms: lex.terms, q: q, lexHits: lex.hits };
          showLoading(waitingMsg());
          setStage("", false); // centred loading message is enough — no duplicate in the footer
          w.postMessage({
            type: "rerank", id: runId, q: q,
            docs: pending.pool.map(function (d) { return d.title + ". " + d.section + ". " + d.content; }),
          });
          clearTimeout(rerankTimer);
          rerankTimer = setTimeout(function () {
            if (pending && pending.id === lastRun) fallbackToKeyword("ranking took too long");
          }, 60000);
        } else {
          // No reranker (or no keyword candidates) → show what we have.
          render(lex, q);
          setStage(lex.hits.length ? "Keyword results" : "", false);
        }
      } catch (e) {
        if (runId === lastRun) status.textContent = "Error: " + e.message;
      }
    }
    function render(res, q) {
      results.innerHTML = "";
      if (!res.hits.length) { status.textContent = "No matches."; return; }
      status.textContent = "";
      res.hits.forEach(function (h) {
        var a = el("a", { class: "ss-hit", href: withBase(h.doc.url) });
        var snip = h.doc.content.length > 220 ? h.doc.content.slice(0, 220) + "…" : h.doc.content;
        a.innerHTML =
          '<div class="ss-hit-title">' + escapeHtml(h.doc.title) +
          (h.doc.section ? ' <span class="ss-hit-sec">› ' + escapeHtml(h.doc.section) + "</span>" : "") +
          "</div>" +
          '<div class="ss-hit-snip">' + escapeHtml(snip) + "</div>";
        a.addEventListener("click", function () {
          var anchor = h.doc.url.split("#")[1] || "";
          var path = null;
          try { path = new URL(a.href).pathname; } catch (e) {}
          close();
          if (path && path === window.location.pathname) {
            setTimeout(function () { try { highlightSection(anchor, res.terms); } catch (e) {} }, 160);
          } else {
            try {
              sessionStorage.setItem("ss:hl", JSON.stringify({ path: path, anchor: anchor, terms: res.terms }));
            } catch (e) {}
          }
        });
        results.appendChild(a);
      });
    }
    input.addEventListener("input", schedule);
  }

  /** Make the theme's header search box open our modal. */
  function wireHeaderSearch() {
    var input = document.querySelector(".md-search__input");
    if (!input || input.getAttribute("data-ss-wired")) return !!input;
    input.setAttribute("data-ss-wired", "1");
    input.setAttribute("placeholder", "Search");
    var grab = function (e) {
      if (!openModal) return;
      e.preventDefault();
      var v = input.value.trim();
      input.value = "";
      input.blur();
      openModal(v);
    };
    input.addEventListener("focus", grab);
    input.addEventListener("click", grab);
    return true;
  }

  /** Fallback launcher, only if the header search box isn't present. */
  function ensureLauncher() {
    if (document.getElementById("ss-launch")) return;
    var b = el("button", { id: "ss-launch", title: "Search", "aria-label": "Search" });
    b.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 1 5.6 11.2l4.1 4.1-1.4 1.4-4.1-4.1A7 7 0 1 1 12 2m0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z"/></svg>' +
      "<span>Search</span>";
    b.addEventListener("click", function () { openModal && openModal(""); });
    document.body.appendChild(b);
  }

  // ---- destination-page passage highlight ---------------------------------
  function highlightSection(anchor, terms) {
    var content = document.querySelector(".md-content__inner");
    if (!content) return;
    var nodes = [], heading = null;
    if (anchor) {
      try { heading = content.querySelector("#" + (window.CSS && CSS.escape ? CSS.escape(anchor) : anchor)); } catch (e) {}
      if (heading) {
        var sib = heading.nextElementSibling;
        while (sib && sib.tagName !== "H2") { nodes.push(sib); sib = sib.nextElementSibling; }
      }
    }
    if (!heading) {
      var kids = content.children;
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].tagName === "H2") break;
        if (kids[i].tagName !== "H1") nodes.push(kids[i]);
      }
    }
    if (!nodes.length && heading) nodes = [heading];

    var blocks = [];
    nodes.forEach(function (n) {
      if (/^(P|LI|TD|TH|BLOCKQUOTE|H3|H4|PRE)$/.test(n.tagName)) blocks.push(n);
      var inner = n.querySelectorAll ? n.querySelectorAll("p, li, td, th, blockquote") : [];
      for (var j = 0; j < inner.length; j++) blocks.push(inner[j]);
    });
    if (!blocks.length) blocks = nodes.slice();

    var scored = blocks.map(function (b) {
      var txt = (b.textContent || "").toLowerCase();
      var s = 0;
      (terms || []).forEach(function (o) { if (hasTerm(txt, o.t)) s += o.idf; });
      return { el: b, score: s };
    });
    var positive = scored.filter(function (x) { return x.score > 0; });
    positive.sort(function (a, b) { return b.score - a.score; });

    var chosen = positive.length
      ? positive.slice(0, 3).map(function (x) { return x.el; })
      : (heading ? [heading] : []).concat(nodes.slice(0, 2));

    chosen.forEach(function (elm) {
      if (!elm) return;
      elm.classList.add("ss-hl");
      setTimeout(function () { elm.classList.remove("ss-hl"); }, 6000);
    });
    if (chosen[0] && chosen[0].getBoundingClientRect) {
      var r = chosen[0].getBoundingClientRect();
      if (r.top < 60 || r.top > window.innerHeight * 0.6) {
        chosen[0].scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }

  function applyPendingHighlight() {
    var raw;
    try { raw = sessionStorage.getItem("ss:hl"); } catch (e) { return; }
    if (!raw) return;
    var info;
    try { info = JSON.parse(raw); } catch (e) { try { sessionStorage.removeItem("ss:hl"); } catch (e2) {} return; }
    if (info.path !== window.location.pathname) return;
    try { sessionStorage.removeItem("ss:hl"); } catch (e) {}
    setTimeout(function () {
      try { highlightSection(info.anchor, info.terms); } catch (e) {}
    }, 80);
  }

  var warmed = false;
  function boot() {
    if (!document.getElementById("ss-overlay")) buildUI();
    if (!wireHeaderSearch()) ensureLauncher();
    applyPendingHighlight();
    // Start fetching the model immediately. The one-time download is ~9 s, and it
    // all happens in the worker — it cannot block the UI thread — so there is
    // nothing to gain by waiting for requestIdleCallback (whose no-rIC fallback
    // was a flat 1.5 s delay, and which on a page doing instant-nav + Mermaid can
    // be several seconds away). Earlier start = more of it done before the first
    // search. `warmSearch` is idempotent.
    if (!warmed && warmSearch) {
      warmed = true;
      try { warmSearch(); } catch (e) {}
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
  if (window.document$ && window.document$.subscribe) {
    window.document$.subscribe(boot);
  }
})();
