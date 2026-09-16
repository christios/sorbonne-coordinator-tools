import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, RouterProvider, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";

import { GatedApp } from "@/routes/GatedApp";
import { installSearchEscape } from "@/services/searchEscape";
import "./styles.css";

installSearchEscape();

/*
 * Data a coordinator has just looked at is kept for half an hour, so stepping between
 * screens redraws from the cache instead of asking the server again and blinking while it
 * answers.
 *
 * It was half a minute, which is shorter than a coordinator spends on one screen: going
 * back to a list you had open a moment ago re-fetched all of it, and the biggest of these
 * lists takes the server a second or two to build. What makes a long window safe is that
 * nothing here goes stale on its own — a list changes because somebody changed it, and
 * every one of those actions already says which lists it affected, a portal sync included.
 *
 * What none of them can say is that a DIFFERENT coordinator changed something, since there
 * is no channel to hear it on. That is what the second line is for: coming back to the tab
 * re-asks for whatever is on screen whether or not it has gone stale. So the refresh
 * happens at the moment you return to the application — which is also the moment somebody
 * else's change is most likely to be waiting — and moving between screens in a session,
 * however long, asks for nothing it already has.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30 * 60_000, refetchOnWindowFocus: "always" } },
});
const rootRoute = createRootRoute({
  component: () => <Outlet />,
});
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: GatedApp,
});
const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute]),
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Missing app root");
}

ReactDOM.createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
