/*
 * Rerank worker — runs the cross-encoder off the main thread so the UI never
 * freezes. Retrieval is lexical and happens on the main thread (no model); this
 * worker only loads the small reranker and reorders the candidates it's given.
 *
 * Model: ms-marco-MiniLM-L-6-v2 (q8, ~22MB), via transformers.js. Loaded as a
 * module worker so it can dynamic-import the ESM build from the CDN.
 *
 * Messages in:  { type:"warm" }
 *               { type:"rerank", id, q, docs:[text, …] }
 * Messages out: { type:"status", text }
 *               { type:"rerank", id, order:[indices sorted best→worst] }
 *               { type:"error", id, message }
 */
const XFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3";
const RERANK_ID = "Xenova/ms-marco-MiniLM-L-6-v2";

/*
 * BACKEND — WebGPU when available, WASM otherwise. Measured, in this worker, on
 * real passages at a fixed [12,256] batch:
 *
 *   WASM q8   (23 MB) ........ 5500-5900 ms   ← what users were feeling
 *   WebGPU fp32 (91 MB) ......   92-97 ms
 *   WebGPU fp16 (46 MB) ......   47-48 ms     ← chosen
 *
 * The WASM path is slow here for a specific reason: browsers run Web Workers at
 * low thread QoS, so on Apple Silicon the inference lands on efficiency cores.
 * The identical batch takes ~1360 ms on the main thread — a 4.3x penalty purely
 * for being in a worker. WebGPU runs on the GPU, so the penalty disappears and
 * we keep the UI thread free.
 *
 * fp16 doubles the download vs q8 (46 MB vs 23 MB, one-time and cached) but is
 * ~120x faster per query AND higher precision than q8, so ranking quality does
 * not regress. WASM q8 stays as the fallback for browsers without WebGPU.
 */
const GPU_DTYPE = "fp16";
const CPU_DTYPE = "q8";

/*
 * FIXED BATCH SHAPE — this is the single biggest perf lever, measured.
 *
 * onnxruntime-web compiles a graph per distinct input shape. With `padding:true`
 * every query pads to the longest candidate in *its* pool, so almost every search
 * hits a novel [N, L] shape and pays 3-5s of recompilation — which is why warm
 * searches were still taking 5-10s. Padding to a constant [POOL, MAX_LEN] means
 * the graph is compiled exactly once and reused for every subsequent query.
 *
 * Measured on this corpus: dynamic padding = 0.96s-4.7s and unpredictable;
 * fixed [12,256] = a flat 1.35s, first query included.
 *
 * MAX_LEN=256 truncates almost nothing: chunk lengths are median ~130 tokens,
 * p90 ~239. POOL must match RERANK_POOL in semantic-search.js; short pools are
 * padded with empty passages and their scores discarded.
 */
const POOL = 12;
const MAX_LEN = 256;

let latest = 0;
function post(m) { self.postMessage(m); }

/*
 * SERIALISE ALL INFERENCE.
 *
 * `self.onmessage = async …` does NOT queue: every message starts its own async
 * invocation immediately. So a query typed while the warm-up was still running
 * put two `model()` calls on the same ONNX session at once, and onnxruntime threw
 * "Session already started" — one query erroring and the other silently never
 * resolving, which left the UI spinner up until the 60s timeout. That is the
 * "stuck loading for 20s+" symptom.
 *
 * Everything that touches the session goes through this one-at-a-time chain.
 */
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn);
  chain = run.then(function () {}, function () {}); // never let a rejection break the chain
  return run;
}

let rerankerP = null;
function initReranker() {
  if (rerankerP) return rerankerP;
  rerankerP = (async function () {
    const xf = await import(XFORMERS_URL);
    xf.env.allowLocalModels = false;

    // Prefer WebGPU; fall back to WASM if it's unavailable or fails to build.
    let gpu = false;
    try { gpu = !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch (e) { gpu = false; }

    const totalMB = gpu ? 46 : 23;
    post({ type: "status", text: "Downloading search model (" + totalMB + " MB)…" });

    // Report real download progress so a slow first load shows a moving number
    // instead of an indefinite spinner.
    let lastPct = -1;
    const onProgress = (p) => {
      if (!p || p.status !== "progress" || !p.total) return;
      const pct = Math.round((p.loaded / p.total) * 100);
      if (pct === lastPct || pct % 5 !== 0) return; // throttle: every 5%
      lastPct = pct;
      post({ type: "progress", pct: pct, mb: totalMB });
    };

    const tok = await xf.AutoTokenizer.from_pretrained(RERANK_ID);

    let model;
    if (gpu) {
      try {
        model = await xf.AutoModelForSequenceClassification.from_pretrained(
          RERANK_ID, { device: "webgpu", dtype: GPU_DTYPE, progress_callback: onProgress });
      } catch (e) {
        gpu = false; // WebGPU advertised but unusable — drop to CPU.
      }
    }
    if (!model) {
      model = await xf.AutoModelForSequenceClassification.from_pretrained(
        RERANK_ID, { dtype: CPU_DTYPE, progress_callback: onProgress });
    }
    post({ type: "status", text: "backend:" + (gpu ? "webgpu" : "wasm") });
    return async (q, docs) => {
      // Pad the candidate list to a constant POOL so dim 0 never varies either.
      const n = docs.length;
      const padded = docs.slice(0, POOL);
      while (padded.length < POOL) padded.push("");
      const inputs = tok(padded.map(() => q), {
        text_pair: padded,
        padding: "max_length", // constant [POOL, MAX_LEN] → compile the graph once
        max_length: MAX_LEN,
        truncation: true,
      });
      const out = await model(inputs);
      // Drop the filler rows before returning.
      return out.logits.tolist().map((x) => x[0]).slice(0, n);
    };
  })();
  return rerankerP;
}

let warmed = false;

self.onmessage = (e) => {
  const m = e.data || {};

  if (m.type === "warm") {
    if (warmed) return; // repeated opens must not re-queue the warm-up
    warmed = true;
    serial(async () => {
      const rerank = await initReranker();
      // Throwaway inference so ONNX graph compilation happens here, in the
      // background, instead of on the user's first query. This only works because
      // the batch is now a FIXED [POOL, MAX_LEN] shape — the graph compiled here
      // is byte-for-byte the one every real query reuses.
      try {
        const dummy = [];
        for (let k = 0; k < POOL; k++) dummy.push("warm up passage number " + k + " for graph compilation");
        await rerank("warm up query", dummy);
      } catch (e2) {}
      post({ type: "status", text: "ready" });
    }).catch((err) => post({ type: "error", message: String((err && err.message) || err) }));
    return;
  }

  if (m.type === "rerank") {
    latest = m.id; // newest query wins; older ones are dropped when their turn comes
    serial(async () => {
      const rerank = await initReranker();
      if (m.id !== latest) return; // superseded while queued — skip the work entirely
      const scores = await rerank(m.q, m.docs);
      if (m.id !== latest) return;
      const order = scores
        .map((s, i) => ({ i, s }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.i);
      post({ type: "rerank", id: m.id, order: order });
    }).catch((err) => post({ type: "error", id: m.id, message: String((err && err.message) || err) }));
  }
};
