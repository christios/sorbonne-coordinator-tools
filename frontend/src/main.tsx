import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, RouterProvider, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";

import { InvitedWishesPage } from "@/components/InvitedWishesPage";
import { PreferencesPreviewPage } from "@/components/PreferencesPreviewPage";
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
/*
 * An invited teacher's link: their own timetable preferences and constraints, outside the staff's sign-in gate —
 * it has a sign-in of its own, with the Google account the invitation was sent to.
 */
const invitedWishesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/preferences/$code",
  component: function InvitedWishes() {
    const { code } = invitedWishesRoute.useParams();
    return <InvitedWishesPage code={code} />;
  },
});
/*
 * The coordinators' preview of that page (25 Nov 2026): a sample teacher on the semester's own
 * settings, read with the coordinator's sign-in, and nothing saved.
 */
const preferencesPreviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/preview/preferences/$term",
  component: function PreferencesPreview() {
    const { term } = preferencesPreviewRoute.useParams();
    return <PreferencesPreviewPage term={term} />;
  },
});
const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, invitedWishesRoute, preferencesPreviewRoute]),
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
