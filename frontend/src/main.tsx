import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, RouterProvider, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";

import { GatedApp } from "@/routes/GatedApp";
import { QUERY_DEFAULTS } from "@/services/queryDefaults";
import { installSearchEscape } from "@/services/searchEscape";
import "./styles.css";

installSearchEscape();

// See services/queryDefaults: what is kept, for how long, and when it is asked again.
const queryClient = new QueryClient({ defaultOptions: QUERY_DEFAULTS });
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
