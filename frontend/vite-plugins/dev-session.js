/**
 * Signs the local browser in, so `npm run start` opens the tools without a Google login.
 *
 * The gate is not bypassed: this mints a *real* session with `backend/scripts/dev_session.py`,
 * which signs the cookie with the local SESSION_SECRET for an address on
 * COORDINATOR_ACCESS_EMAILS, and the API verifies it exactly as it verifies one that came
 * from Google. None of it can reach a deployment — Vite only applies the plugin while it is
 * serving, and the cookie is minted by the backend that is being served.
 *
 * Set DEV_SESSION=off to get the sign-in screen back, or DEV_SESSION_EMAIL=someone@… to
 * browse as another member of staff (useful for checking what a non-administrator sees).
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const SCRIPT = "scripts/dev_session.py";

/** The script prints the cookie first and a "# signed in as …" note after it. */
export function cookieFrom(output) {
  const line = String(output)
    .split("\n")
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate && !candidate.startsWith("#"));
  return line && line.includes("=") ? line : "";
}

/** "http://localhost:8000" -> "localhost". */
export function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * A cookie set on 127.0.0.1 is never sent to localhost, so the browser looks signed in
 * and every API call still answers 401. Both halves have to agree on the hostname.
 */
export function hostMismatch(requestHost, apiBaseUrl) {
  const api = hostOf(apiBaseUrl);
  const browser = String(requestHost ?? "").split(":")[0];
  return api && browser && api !== browser ? { browser, api } : null;
}

function mint({ backend, email, run }) {
  const args = ["run", "python", SCRIPT];
  if (email) args.push("--email", email);
  return cookieFrom(run("uv", args, { cwd: backend, encoding: "utf8" }));
}

export function devSession({ backend: backendDirectory = "", env = process.env, run = execFileSync, log = console } = {}) {
  let backend = backendDirectory;

  return {
    name: "sorbonne-dev-session",
    apply: "serve",

    configResolved(config) {
      backend = backendDirectory || resolve(config.root, "..", "backend");
    },

    configureServer(server) {
      if (env.DEV_SESSION === "off") {
        log.info("  dev session off — sign in with Google");
        return;
      }
      if (!existsSync(resolve(backend, SCRIPT))) return;

      let cookie = "";
      try {
        cookie = mint({ backend, email: env.DEV_SESSION_EMAIL, run });
      } catch {
        cookie = "";
      }
      if (!cookie) {
        log.info("  dev session unavailable — check backend/.env, then sign in with Google");
        return;
      }

      let warned = false;
      server.middlewares.use((request, response, next) => {
        if ((request.headers.accept ?? "").includes("text/html")) {
          response.setHeader("Set-Cookie", `${cookie}; Path=/; SameSite=Lax`);
          const mismatch = !warned && hostMismatch(request.headers.host, env.VITE_API_BASE_URL);
          if (mismatch) {
            warned = true;
            log.info(
              `  the session cookie is set for ${mismatch.browser}, but the API is on ` +
                `${mismatch.api} — open the ${mismatch.api} address instead, or the API will answer 401`,
            );
          }
        }
        next();
      });
      log.info(`  dev session on — signed in without Google (DEV_SESSION=off to stop)`);
    },
  };
}
