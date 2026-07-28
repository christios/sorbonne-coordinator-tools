/*
 * Semantic reranking for the SCEN Coordinator Handbook, layered onto MkDocs
 * Material's NATIVE search UI.
 *
 * Material owns the whole interface: the header box, the dropdown, the teasers
 * and the <mark> term highlighting. We add one thing — the order.
 *
 *   1. Material's own keyword search retrieves and renders, instantly.
 *   2. We take the pages it found, score them with a cross-encoder reranker in a
 *      Web Worker, and REORDER the existing <li> nodes.
 *
 * Reordering rather than re-rendering is deliberate: Material's markup, icons,
 * teasers, highlighting and "N more on this page" sections are preserved for
 * free, and there is no second retrieval that could disagree with what is on
 * screen. Every ranked item is by definition already in the DOM.
 *
 * Material emits one <li class="md-search-result__item"> per PAGE, and our index
 * is chunked per <h2> section, so for each page we rerank its best-matching
 * section — the chunk that actually answers the query.
 *
 * Fully client-side; nothing is sent anywhere.
 */
(function () {
  "use strict";

  // ---- config -------------------------------------------------------------
  var DATA_URL = "assets/search/search-data.json";
  var WORKER_URL = "assets/search/search-worker.js";
  var POOL = 24;              // MUST match POOL in search-worker.js (fixed batch shape)
  var SECTIONS_PER_PAGE = 3;  // passages per candidate page; the reranker picks the winner
  var DEBOUNCE = 90;          // ms, to coalesce Material's re-renders

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
  function pathOf(href) {
    try { return new URL(href, window.location.href).pathname; } catch (e) { return href; }
  }

  // ---- index --------------------------------------------------------------
  // Supplies the passage text the reranker reads. Material's teasers are far too
  // short to rerank on; these are the full section chunks.
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
      // pathname -> [record index, …], so a Material result can find its chunks.
      var byPath = {};
      records.forEach(function (r, i) {
        var p = pathOf(withBase(r.url));
        (byPath[p] || (byPath[p] = [])).push(i);
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
      return { records: records, hay: hay, byPath: byPath, N: N, dfOf: dfOf };
    })();
    return liteP;
  }

  function queryTerms(s, q) {
    var all = tokens(q).filter(function (t) { return s.dfOf(t) > 0; });
    return all.map(function (t) { return { t: t, idf: Math.log((s.N + 1) / (s.dfOf(t) + 1)) }; });
  }

  /**
   * The `n` sections of `path` most likely to answer the query, best first.
   *
   * Keyword overlap is only a shortlist here, not the decision: picking a single
   * section this way chose the wrong one for paraphrased questions (asking about
   * resitting a passed course selected a section that merely repeated the query's
   * words). We hand several to the cross-encoder and let it judge.
   */
  function topChunks(s, path, terms, n) {
    var idxs = s.byPath[path];
    if (!idxs || !idxs.length) return [];
    var scored = idxs.map(function (i) {
      var score = 0;
      for (var j = 0; j < terms.length; j++) if (hasTerm(s.hay[i], terms[j].t)) score += terms[j].idf;
      return { i: i, score: score };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, n).map(function (x) { return s.records[x.i]; });
  }

  // ---- native DOM ---------------------------------------------------------
  function resultList() { return document.querySelector(".md-search-result__list"); }
  function metaEl() { return document.querySelector(".md-search-result__meta"); }
  function searchInput() { return document.querySelector(".md-search__input"); }
  function items(list) {
    return list ? [].slice.call(list.querySelectorAll(":scope > li.md-search-result__item")) : [];
  }

  // Material rewrites the meta line on every render, so keep our note appended
  // to its text ("20 matching documents") rather than replacing it.
  var META_SEP = " · ";
  function baseMeta(el) {
    var t = el.textContent || "";
    var i = t.indexOf(META_SEP);
    return i === -1 ? t : t.slice(0, i);
  }
  function setMetaNote(note) {
    var el = metaEl();
    if (!el) return;
    el.textContent = note ? baseMeta(el) + META_SEP + note : baseMeta(el);
  }

  // ---- worker -------------------------------------------------------------
  var worker = null, workerReady = false, workerFailed = false, warmSent = false;
  var runId = 0, pending = null;
  var lastTerms = [];

  function getWorker() {
    if (worker || workerFailed) return worker;
    try {
      worker = new Worker(withBase(WORKER_URL), { type: "module" });
    } catch (e) { workerFailed = true; return null; }

    worker.onmessage = function (ev) {
      var m = ev.data || {};
      if (m.type === "progress") {
        if (!workerReady) setMetaNote("loading semantic ranking " + m.pct + "%");
      } else if (m.type === "status") {
        if (m.text === "ready") {
          workerReady = true;
          setMetaNote("");
          rerankNow(); // rank whatever is already on screen
        }
      } else if (m.type === "rerank") {
        if (!pending || m.id !== pending.id || m.id !== runId) return; // superseded
        applyOrder(m.order, pending);
        pending = null;
      } else if (m.type === "error") {
        // Ranking failed. Material's keyword order stands — say so rather than
        // letting it look semantically ranked.
        pending = null;
        setMetaNote("keyword order (ranking unavailable)");
      }
    };
    worker.onerror = function () {
      workerFailed = true; pending = null;
      setMetaNote("keyword order (ranking unavailable)");
    };
    return worker;
  }

  function warmSearch() {
    if (warmSent) return;
    var w = getWorker();
    if (!w) return;
    warmSent = true;
    w.postMessage({ type: "warm" });
  }

  // ---- rerank + reorder ---------------------------------------------------
  var observer = null;

  function applyOrder(order, ctx) {
    var list = resultList();
    if (!list) return;
    var live = items(list);
    // Material may have re-rendered since we asked; only reorder if the list we
    // reasoned about is still the one on screen.
    if (live.length !== ctx.liveCount) return;

    // `order` ranks PASSAGES, several of which may belong to the same page. The
    // first time a page appears is its best-scoring section, so taking first
    // appearances ranks pages by their strongest section.
    var ranked = [], seen = new Set();
    for (var i = 0; i < order.length; i++) {
      var node = ctx.owners[order[i]];
      if (!node || seen.has(node) || node.parentNode !== list) continue;
      seen.add(node);
      ranked.push(node);
    }
    if (!ranked.length) return;

    // Anything beyond POOL was not reranked; it keeps its order, below.
    var inRanked = new Set(ranked);
    var rest = live.filter(function (n) { return !inRanked.has(n); });

    var frag = document.createDocumentFragment();
    ranked.forEach(function (n) { frag.appendChild(n); });
    rest.forEach(function (n) { frag.appendChild(n); });

    // Our own mutation must not retrigger the observer.
    if (observer) observer.disconnect();
    list.appendChild(frag);
    setMetaNote("ranked by meaning");
    observe();
  }

  async function rerankNow() {
    var input = searchInput();
    var list = resultList();
    if (!input || !list) return;
    var q = (input.value || "").trim();
    var live = items(list);
    if (q.length < 2 || live.length < 2) return;

    var w = getWorker();
    if (!w || workerFailed) return;
    // Model still downloading: Material's order stands and the meta line already
    // shows progress. Queuing here would only produce stale work.
    if (!workerReady) return;

    var id = ++runId;
    var s;
    try { s = await initLite(); } catch (e) { return; }
    if (id !== runId) return;

    var terms = queryTerms(s, q);
    lastTerms = terms;

    // Build the candidate list at SECTION granularity, several per page, then let
    // the reranker decide which section (and therefore which page) wins.
    //
    // Only pages we hold real content for are included. Nav-only index pages
    // ("Getting Started", "Procedures") are deliberately absent from the index —
    // they are tables of contents, not answers. Scoring them on scraped DOM text
    // let the reranker promote a stub above the page that actually answered the
    // query, so they are excluded and sink below the ranked results instead.
    var owners = [], docs = [];
    for (var i = 0; i < live.length && docs.length < POOL; i++) {
      var a = live[i].querySelector("a.md-search-result__link");
      if (!a) continue;
      var recs = topChunks(s, pathOf(a.getAttribute("href") || ""), terms, SECTIONS_PER_PAGE);
      for (var k = 0; k < recs.length && docs.length < POOL; k++) {
        owners.push(live[i]); // which <li> this passage belongs to
        docs.push(recs[k].title + ". " + recs[k].section + ". " + recs[k].content);
      }
    }
    if (docs.length < 2) return; // nothing meaningful to reorder

    pending = { id: id, owners: owners, liveCount: live.length, q: q, terms: terms };
    w.postMessage({ type: "rerank", id: id, q: q, docs: docs });
  }

  // ---- passage highlight on the destination page --------------------------
  function rememberHighlight(a) {
    var href = a.getAttribute("href") || "";
    var anchor = href.split("#")[1] || "";
    var path = pathOf(href);
    var terms = lastTerms;
    if (path === window.location.pathname) {
      setTimeout(function () { try { highlightSection(anchor, terms); } catch (e) {} }, 160);
    } else {
      try {
        sessionStorage.setItem("ss:hl", JSON.stringify({ path: path, anchor: anchor, terms: terms }));
      } catch (e) {}
    }
  }

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

  // ---- wiring -------------------------------------------------------------
  var debounceTimer = null;
  function scheduleRerank() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(rerankNow, DEBOUNCE);
  }

  function observe() {
    var list = resultList();
    if (!list) return;
    if (!observer) observer = new MutationObserver(scheduleRerank);
    observer.observe(list, { childList: true });
  }

  var wired = false;
  function boot() {
    applyPendingHighlight();
    if (wired) return;
    var list = resultList();
    if (!list) return; // search plugin disabled — nothing to enhance
    wired = true;

    observe();

    // Remember which passage to flash on the destination page.
    list.addEventListener("click", function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a.md-search-result__link") : null;
      if (a) rememberHighlight(a);
    });

    // Start the model download immediately: it runs in the worker and cannot
    // block the UI, and Material's keyword results are usable meanwhile.
    warmSearch();
    initLite().catch(function () {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
  // Material's instant navigation swaps the page but keeps this module alive.
  if (window.document$ && window.document$.subscribe) {
    window.document$.subscribe(boot);
  }
})();
