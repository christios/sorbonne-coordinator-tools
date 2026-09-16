import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, RouterProvider, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";

import { GatedApp } from "@/routes/GatedApp";
import { installSearchEscape } from "@/services/searchEscape";
import "./styles.css";

installSearchEscape();

/*
 * Data a coordinator has just looked at is treated as fresh for five minutes, so stepping
 * between screens redraws from the cache instead of asking the server again and blinking
 * while it answers.
 *
 * It was half a minute, which is shorter than a coordinator spends on one screen: going
 * back to a list you had open a moment ago re-fetched all of it, and the biggest of these
 * lists takes the server a second or two to build. What makes the longer window safe is
 * that nothing here goes stale on its own — a list changes because somebody on this screen
 * changed it, and every one of those actions says which lists it affected. The case the
 * window does cover is the other coordinator's change, and that is what refetching on
 * focus is for: come back to the tab and anything past its five minutes is asked again.
 */
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60_000 } } });
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
