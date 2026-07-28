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
  var POOL = 64;             // MUST match POOL in search-worker.js (fixed batch shape)
  var DEBOUNCE = 90;         // ms, to coalesce Material's re-renders
  var MAX_ADDED = 6;         // most pages we will add beyond Material's own results
  var ADD_RANK_CUTOFF = 8;   // an added page is only shown if it ranks this high

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

      // Stemmed token sets, for the supplementary retrieval that finds pages
      // Material's literal-prefix matching misses (see `retrievePages`).
      var stems = records.map(function (r) {
        var toks = (r.title + " " + r.section + " " + r.content).toLowerCase().match(/[a-z0-9]{3,}/g) || [];
        var set = Object.create(null);
        for (var i = 0; i < toks.length; i++) set[porterStem(toks[i])] = 1;
        return set;
      });
      var sdf = Object.create(null);
      stems.forEach(function (set) { for (var k in set) sdf[k] = (sdf[k] || 0) + 1; });
      var DF = {};
      var dfOf = function (t) {
        if (DF[t] === undefined) {
          var c = 0;
          for (var i = 0; i < hay.length; i++) if (hasTerm(hay[i], t)) c++;
          DF[t] = c;
        }
        return DF[t];
      };
      return { records: records, hay: hay, byPath: byPath, N: N, dfOf: dfOf,
               stems: stems, sdf: sdf };
    })();
    return liteP;
  }

  function queryTerms(s, q) {
    var all = tokens(q).filter(function (t) { return s.dfOf(t) > 0; });
    return all.map(function (t) { return { t: t, idf: Math.log((s.N + 1) / (s.dfOf(t) + 1)) }; });
  }

  /*
   * SUPPLEMENTARY RETRIEVAL.
   *
   * Material's keyword stage matches literal prefixes with no stemmer, so it
   * silently under-retrieves: "grading" returned 7 pages and simply never
   * considered "Grades, PVs & transcripts", "Grade corrections" or "FYS grade
   * workflow". The reranker cannot rescue those — they were never candidates.
   *
   * So we run our own stem-aware pass over the whole index and add any page
   * Material missed. This is a supplement, not a fallback: it always runs, since
   * a threshold on "too few results" would not have fired on the `grading` case
   * (7 results looks perfectly healthy).
   *
   * Added pages have to earn their place — they are kept only if the reranker
   * puts them in the top `ADD_RANK_CUTOFF`, otherwise they are dropped again.
   */
  function stemTerms(q) {
    var raw = markTerms(q), out = [], seen = Object.create(null);
    for (var i = 0; i < raw.length; i++) {
      var s = porterStem(raw[i]);
      if (!seen[s]) { seen[s] = 1; out.push(s); }
      var n = s.replace(NEG, "");           // "inconsistent" should also find "consistent"
      if (n.length >= 4 && !seen[n]) { seen[n] = 1; out.push(n); }
    }
    return out;
  }

  /** Pages our stem-aware scoring considers relevant, best first. */
  function retrievePages(s, q) {
    var terms = stemTerms(q);
    if (!terms.length) return [];
    var best = Object.create(null);
    for (var i = 0; i < s.records.length; i++) {
      var score = 0;
      for (var j = 0; j < terms.length; j++) {
        if (s.stems[i][terms[j]]) score += Math.log((s.N + 1) / ((s.sdf[terms[j]] || 0) + 1));
      }
      if (score <= 0) continue;
      var p = pathOf(withBase(s.records[i].url));
      if (!(p in best) || score > best[p]) best[p] = score;
    }
    var out = [];
    for (var k in best) out.push({ path: k, score: best[k] });
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  /** A result node for a page Material did not return, in its own markup. */
  function makeResult(s, path, terms) {
    var recs = chunksOf(s, path);
    if (!recs.length) return null;
    var intro = recs[0];
    var li = document.createElement("li");
    li.className = "md-search-result__item ss-added";

    var a = document.createElement("a");
    a.className = "md-search-result__link";
    a.setAttribute("href", withBase(intro.url));
    a.setAttribute("tabindex", "-1");
    var art = document.createElement("article");
    art.className = "md-search-result__article md-search-result__article--document md-typeset";
    var icon = document.createElement("div");
    icon.className = "md-search-result__icon md-icon";
    var h1 = document.createElement("h1");
    h1.appendChild(document.createTextNode(intro.title));
    art.appendChild(icon);
    art.appendChild(h1);
    a.appendChild(art);
    li.appendChild(a);
    return li;
  }

  /** The section block appended to a synthesized result, matching Material's. */
  function makeSection(rec) {
    var a = document.createElement("a");
    a.className = "md-search-result__link";
    a.setAttribute("href", withBase(rec.url));
    a.setAttribute("tabindex", "-1");
    var art = document.createElement("article");
    art.className = "md-search-result__article md-typeset";
    if (rec.section) {
      var h = document.createElement("h2");
      h.appendChild(document.createTextNode(rec.section));
      art.appendChild(h);
    }
    var text = rec.content.length > 320 ? rec.content.slice(0, 320) + "…" : rec.content;
    art.appendChild(document.createTextNode(text));
    a.appendChild(art);
    return a;
  }

  /** Every indexed section of `path`, page intro first. */
  function chunksOf(s, path) {
    var idxs = s.byPath[path];
    if (!idxs || !idxs.length) return [];
    return idxs.map(function (i) { return s.records[i]; });
  }

  // ---- morphological highlighting ----------------------------------------
  /*
   * Material highlights literal PREFIX matches only: "grade" marks `grades` but
   * not `grading`, and "inconsistent" marks nothing in "not always consistent" —
   * the passage the reranker just chose. So a result could rank first with no
   * visible reason.
   *
   * Enabling lunr's stemmer is NOT the fix (see README): it stems the index but
   * not the query, and search gets much worse. This runs after ranking, over the
   * rendered text only, and adds marks Material missed. It cannot affect which
   * results appear — purely what is emphasised in them.
   *
   * This uses a real Porter stemmer. Prefix/containment heuristics were tried
   * first and are not viable — matching on a shared prefix marked `example` for
   * "exam", `listen` for "list", `market` for "mark" and `graduate` for "grade".
   */
  var P_C = "[^aeiou]", P_V = "[aeiouy]";
  var P_CC = P_C + "[^aeiouy]*", P_VV = P_V + "[aeiou]*";
  var mgr0 = new RegExp("^(" + P_CC + ")?" + P_VV + P_CC);
  var meq1 = new RegExp("^(" + P_CC + ")?" + P_VV + P_CC + "(" + P_VV + ")?$");
  var mgr1 = new RegExp("^(" + P_CC + ")?" + P_VV + P_CC + P_VV + P_CC);
  var s_v = new RegExp("^(" + P_CC + ")?" + P_V);
  var step2list = { ational: "ate", tional: "tion", enci: "ence", anci: "ance", izer: "ize",
    bli: "ble", alli: "al", entli: "ent", eli: "e", ousli: "ous", ization: "ize", ation: "ate",
    ator: "ate", alism: "al", iveness: "ive", fulness: "ful", ousness: "ous", aliti: "al",
    iviti: "ive", biliti: "ble", logi: "log" };
  var step3list = { icate: "ic", ative: "", alize: "al", iciti: "ic", ical: "ic", ful: "", ness: "" };

  /** Porter (1980). */
  function porterStem(w) {
    w = String(w).toLowerCase();
    if (w.length < 3) return w;
    var re, re2, re3, re4, fp, st;
    if (w.charAt(0) === "y") w = "Y" + w.substr(1);

    re = /^(.+?)(ss|i)es$/; re2 = /^(.+?)([^s])s$/;
    if (re.test(w)) w = w.replace(re, "$1$2");
    else if (re2.test(w)) w = w.replace(re2, "$1$2");

    re = /^(.+?)eed$/; re2 = /^(.+?)(ed|ing)$/;
    if (re.test(w)) { fp = re.exec(w); if (mgr0.test(fp[1])) w = w.replace(/.$/, ""); }
    else if (re2.test(w)) {
      fp = re2.exec(w); st = fp[1];
      if (s_v.test(st)) {
        w = st;
        re2 = /(at|bl|iz)$/;
        re3 = new RegExp("([^aeiouylsz])\\1$");
        re4 = new RegExp("^" + P_CC + P_V + "[^aeiouwxy]$");
        if (re2.test(w)) w += "e";
        else if (re3.test(w)) w = w.replace(/.$/, "");
        else if (re4.test(w)) w += "e";
      }
    }

    re = /^(.+?)y$/;
    if (re.test(w)) { fp = re.exec(w); if (s_v.test(fp[1])) w = fp[1] + "i"; }

    re = /^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/;
    if (re.test(w)) { fp = re.exec(w); if (mgr0.test(fp[1])) w = fp[1] + step2list[fp[2]]; }

    re = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/;
    if (re.test(w)) { fp = re.exec(w); if (mgr0.test(fp[1])) w = fp[1] + step3list[fp[2]]; }

    re = /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/;
    re2 = /^(.+?)(s|t)(ion)$/;
    if (re.test(w)) { fp = re.exec(w); if (mgr1.test(fp[1])) w = fp[1]; }
    else if (re2.test(w)) { fp = re2.exec(w); if (mgr1.test(fp[1] + fp[2])) w = fp[1] + fp[2]; }

    re = /^(.+?)e$/;
    if (re.test(w)) {
      fp = re.exec(w); st = fp[1];
      re3 = new RegExp("^" + P_CC + P_V + "[^aeiouwxy]$");
      if (mgr1.test(st) || (meq1.test(st) && !re3.test(st))) w = st;
    }
    if (/ll$/.test(w) && mgr1.test(w)) w = w.replace(/.$/, "");

    if (w.charAt(0) === "Y") w = "y" + w.substr(1);
    return w;
  }

  var NEG = /^(in|un|non|dis|im|ir|il)/;
  function related(term, word) {
    if (term === word) return true;
    var a = porterStem(term), b = porterStem(word);
    if (a === b) return true;
    // Negation prefixes, handled explicitly: stemmers strip suffixes only, so
    // "inconsistent" -> "inconsist" never meets "consistent" -> "consist".
    var sa = a.replace(NEG, ""), sb = b.replace(NEG, "");
    if (sa.length >= 4 && sa === b) return true;
    if (sb.length >= 4 && sb === a) return true;
    return false;
  }

  /** Raw query words worth emphasising (Material handles its own literal hits). */
  function markTerms(q) {
    var m = (q || "").toLowerCase().match(/[a-z0-9]{3,}/g) || [];
    var seen = {}, out = [];
    for (var i = 0; i < m.length; i++) {
      if (seen[m[i]] || STOP.has(m[i])) continue;
      seen[m[i]] = 1;
      out.push(m[i]);
    }
    return out;
  }

  function markTextNode(node, terms) {
    var text = node.nodeValue, re = /[A-Za-z0-9]+/g, m, last = 0, frag = null;
    while ((m = re.exec(text))) {
      var w = m[0].toLowerCase(), hit = false;
      for (var i = 0; i < terms.length; i++) if (related(terms[i], w)) { hit = true; break; }
      if (!hit) continue;
      frag = frag || document.createDocumentFragment();
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      var mk = document.createElement("mark");
      mk.appendChild(document.createTextNode(m[0]));
      frag.appendChild(mk);
      last = m.index + m[0].length;
    }
    if (!frag) return;
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }

  function markRelated(root, terms) {
    if (!terms.length) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || !/[A-Za-z0-9]/.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        // Leave Material's own marks alone, and never touch the "Missing:" list.
        for (var p = n.parentNode; p && p !== root; p = p.parentNode) {
          if (p.nodeName === "MARK" || p.nodeName === "DEL") return NodeFilter.FILTER_REJECT;
          if (p.classList && p.classList.contains("md-search-result__terms")) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    for (var i = 0; i < nodes.length; i++) markTextNode(nodes[i], terms);
  }

  /** Compare DOM hrefs and index URLs on the same footing. */
  function urlKey(u) {
    try { var x = new URL(u, window.location.href); return x.pathname + x.hash; }
    catch (e) { return u || ""; }
  }

  /** The index record a urlKey refers to. */
  function recordByKey(s, key) {
    var path = key.split("#")[0];
    var idxs = s.byPath[path] || [];
    for (var i = 0; i < idxs.length; i++) {
      if (urlKey(withBase(s.records[idxs[i]].url)) === key) return s.records[idxs[i]];
    }
    return null;
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
    // Count Material's own results only — anything we added is ours to rebuild.
    var live = items(list).filter(function (n) { return !n.classList.contains("ss-added"); });
    // Material may have re-rendered since we asked; only reorder if the list we
    // reasoned about is still the one on screen.
    if (live.length !== ctx.liveCount) return;

    // `order` ranks PASSAGES, several of which may belong to the same page. The
    // first time a page appears is its best-scoring section, so taking first
    // appearances ranks pages by their strongest section — and the full sequence
    // per page gives that page's internal section order.
    var ranked = [], seen = new Set(), byPage = new Map();
    for (var i = 0; i < order.length; i++) {
      var idx = order[i];
      var node = ctx.owners[idx];
      if (!node) continue;
      // A synthesized candidate is a plain token, not a node, until it earns a
      // place: only build it if the reranker put it near the top.
      if (node.added) {
        if (!node.el) {
          if (ranked.length >= ADD_RANK_CUTOFF) continue;   // did not earn it
          node.el = makeResult(ctx.index, node.path, ctx.terms);
          if (!node.el) continue;
          node.bestKey = ctx.keys[idx];
        }
        node = node.el;
      } else if (node.parentNode !== list) continue;

      if (!byPage.has(node)) byPage.set(node, []);
      byPage.get(node).push(ctx.keys[idx]);
      if (!seen.has(node)) { seen.add(node); ranked.push(node); }
    }
    if (!ranked.length) return;

    // Give each newly built result its best section, so it reads like the rest.
    for (var t = 0; t < ctx.added.length; t++) {
      var tok = ctx.added[t];
      if (!tok.el || tok.el.childNodes.length > 1) continue;
      var keys = byPage.get(tok.el) || [];
      for (var kk = 0; kk < keys.length; kk++) {
        var rec = recordByKey(ctx.index, keys[kk]);
        if (rec && rec.section) { tok.el.appendChild(makeSection(rec)); break; }
        if (rec && !rec.section) {                     // page intro won
          var art = tok.el.querySelector("article");
          var txt = rec.content.length > 320 ? rec.content.slice(0, 320) + "…" : rec.content;
          art.appendChild(document.createTextNode(txt));
          break;
        }
      }
    }

    // Anything beyond POOL was not reranked; it keeps its order, below.
    var inRanked = new Set(ranked);
    var rest = live.filter(function (n) { return !inRanked.has(n); });

    var frag = document.createDocumentFragment();
    ranked.forEach(function (n) { frag.appendChild(n); });
    rest.forEach(function (n) { frag.appendChild(n); });

    // Our own mutations must not retrigger the observer.
    if (observer) observer.disconnect();
    list.appendChild(frag);
    byPage.forEach(function (keys, node) { orderSections(node, keys); });
    // Emphasise morphological variants Material's prefix matching missed, so a
    // semantically-ranked hit shows why it matched.
    var mt = markTerms(ctx.q);
    for (var r = 0; r < ranked.length; r++) markRelated(ranked[r], mt);

    var shown = 0;
    for (var c = 0; c < ctx.added.length; c++) if (ctx.added[c].el) shown++;

    if (shown) {
      // Material hides the list outright when its own pass found nothing.
      list.removeAttribute("hidden");
      var out = document.querySelector(".md-search-result");
      if (out) out.removeAttribute("hidden");
    }

    if (!ctx.liveCount && shown) {
      // Material said "No matching documents"; appending to that would contradict
      // the results now on screen, so replace it.
      var el = metaEl();
      if (el) el.textContent = shown + (shown === 1 ? " result" : " results") + " found by meaning";
    } else {
      setMetaNote(shown
        ? "ranked by meaning · " + shown + (shown === 1 ? " page" : " pages") + " keyword search missed"
        : "ranked by meaning");
    }
    observe();
  }

  /**
   * Order one result's sections, and lift its best one into view.
   *
   * Material shows the page link, then hides every matching section behind a
   * "N more on this page" toggle, ordered by its own keyword score. That buries
   * the answer whenever keyword scoring disagrees with meaning — the reported
   * case being "student names inconsistent", where the section that answers it
   * sat last in a collapsed list. So the best-ranked section is promoted to a
   * direct child of the <li>, where it renders in Material's own style, and the
   * remainder are reordered inside the toggle.
   */
  function orderSections(li, keys) {
    var det = li.querySelector("details.md-search-result__more");
    if (!det) return;
    var links = [].slice.call(li.querySelectorAll(":scope > a.md-search-result__link"));
    var pageLink = links[0];

    // Clear marks from any previous pass over this same render.
    li.classList.remove("ss-compact");
    [].forEach.call(li.querySelectorAll("a.ss-promoted"), function (a) {
      a.classList.remove("ss-promoted");
    });

    // Material already promotes a section of its own choosing to a direct child.
    // Put any such section back in the toggle first, so we replace its pick
    // rather than adding a second visible section next to it.
    for (var d = 1; d < links.length; d++) det.appendChild(links[d]);

    var byKey = {};
    [].forEach.call(li.querySelectorAll("a.md-search-result__link"), function (a) {
      var k = urlKey(a.getAttribute("href"));
      if (!byKey[k]) byKey[k] = a;
    });

    // Promote the best section — unless the page intro itself won, in which case
    // what is already visible is the right thing to show.
    //
    // `ss-compact` then hides the page's own teaser: with the answering section
    // directly beneath it, that intro is a less relevant line sitting above the
    // answer. `ss-promoted` hides Material's "Missing: …" caption on the promoted
    // section, where it contradicts the ranking we just applied — it reports that
    // literal query words are absent, which is exactly what a semantic match is
    // allowed to do ("names inconsistent" vs "name spellings … not consistent").
    for (var i = 0; i < keys.length; i++) {
      var a = byKey[keys[i]];
      if (!a) continue;
      if (a === pageLink) break;          // page intro ranked highest; leave as is
      if (a.parentNode === det) li.insertBefore(a, det);
      a.classList.add("ss-promoted");
      li.classList.add("ss-compact");
      break;
    }

    // Reorder whatever is left in the toggle; unranked links keep their order.
    var all = [].slice.call(det.querySelectorAll("a.md-search-result__link"));
    var seq = [];
    keys.forEach(function (k) {
      var a = byKey[k];
      if (a && all.indexOf(a) !== -1 && seq.indexOf(a) === -1) seq.push(a);
    });
    all.forEach(function (a) { if (seq.indexOf(a) === -1) seq.push(a); });
    var frag = document.createDocumentFragment();
    seq.forEach(function (a) { frag.appendChild(a); });
    det.appendChild(frag);

    // Keep Material's "N more on this page" count honest after promoting one.
    var label = det.querySelector("summary div") || det.querySelector("summary");
    if (label) {
      var left = det.querySelectorAll("a.md-search-result__link").length;
      if (!left) det.hidden = true;
      else label.textContent = label.textContent.replace(/\d+/, String(left));
    }
  }

  async function rerankNow() {
    var input = searchInput();
    var list = resultList();
    if (!input || !list) return;
    var q = (input.value || "").trim();

    // Drop results we added on a previous pass, so `live` is Material's own and
    // the staleness guard in applyOrder stays meaningful. Detach the observer:
    // our own mutations must not schedule another rerank.
    var stale = list.querySelectorAll("li.ss-added");
    if (stale.length) {
      if (observer) observer.disconnect();
      for (var d = 0; d < stale.length; d++) stale[d].remove();
      observe();
    }

    var live = items(list);
    // No guard on `live` being non-empty: a query Material cannot match at all
    // ("listing" when the page says "lists") is exactly the case the
    // supplementary retrieval exists for.
    if (q.length < 2) return;

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

    // Rerank at SECTION granularity — EVERY section of each candidate page, in
    // Material's page order, until the batch is full. Both the page order and the
    // section order fall out of the single ranking that comes back.
    //
    // Shortlisting sections by keyword first was the bug this replaces: Material
    // scores "Identity cross-checks" last of six for "student names inconsistent"
    // and a keyword shortlist agreed, so the one section that answers the query
    // never reached the reranker at all.
    //
    // Only pages we hold real content for are included. Nav-only index pages
    // ("Getting Started", "Procedures") are deliberately absent from the index —
    // they are tables of contents, not answers. Scoring them on scraped DOM text
    // let the reranker promote a stub above the page that actually answered the
    // query, so they are excluded and sink below the ranked results instead.
    var owners = [], keys = [], docs = [], havePath = Object.create(null);
    for (var i = 0; i < live.length && docs.length < POOL; i++) {
      var a = live[i].querySelector("a.md-search-result__link");
      if (!a) continue;
      var path = pathOf(a.getAttribute("href") || "");
      havePath[path] = 1;
      var recs = chunksOf(s, path);
      for (var k = 0; k < recs.length && docs.length < POOL; k++) {
        owners.push(live[i]);                      // which <li> this passage belongs to
        keys.push(urlKey(withBase(recs[k].url)));  // which link within that <li>
        docs.push(recs[k].title + ". " + recs[k].section + ". " + recs[k].content);
      }
    }

    // Pages Material missed entirely — added as candidates so the reranker can
    // judge them. They are only rendered if they earn a top position.
    var added = [];
    var extra = retrievePages(s, q);
    for (var e = 0; e < extra.length && docs.length < POOL && added.length < MAX_ADDED; e++) {
      if (havePath[extra[e].path]) continue;
      var erecs = chunksOf(s, extra[e].path);
      if (!erecs.length) continue;
      var token = { path: extra[e].path, added: true };  // stands in for a <li>
      added.push(token);
      for (var m = 0; m < erecs.length && docs.length < POOL; m++) {
        owners.push(token);
        keys.push(urlKey(withBase(erecs[m].url)));
        docs.push(erecs[m].title + ". " + erecs[m].section + ". " + erecs[m].content);
      }
    }

    if (docs.length < 2) return; // nothing meaningful to reorder

    pending = { id: id, owners: owners, keys: keys, liveCount: live.length,
                q: q, terms: terms, added: added, index: s };
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

    // The observer alone is not enough. It fires on Material re-rendering the
    // list, but when Material matches nothing there is no render — so going from
    // one zero-result query to another mutates nothing and we would never run,
    // which is precisely when the supplementary retrieval is most needed. Watch
    // the input directly as well; both paths share the debounce, and a superseded
    // run is dropped by the id check.
    var box = searchInput();
    if (box) {
      box.addEventListener("keyup", scheduleRerank);
      box.addEventListener("input", scheduleRerank);
    }

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
