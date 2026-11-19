import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { queryClient } from "./api";
import { startTheme } from "./hooks/use-theme";
import "./index.css";
import { Home } from "./routes/home";
import { SettingsPage } from "./routes/settings";
import { TripView } from "./routes/trip";

const root = createRootRoute({ component: Outlet });
const routeTree = root.addChildren([
  createRoute({ getParentRoute: () => root, path: "/", component: Home }),
  createRoute({
    getParentRoute: () => root,
    path: "/trips/$tripId",
    // Home sends the first message along as `?first=`; the trip view sends it once and clears it.
    validateSearch: (s: Record<string, unknown>) => ({
      first: typeof s.first === "string" ? s.first : undefined,
    }),
    component: TripView,
  }),
  createRoute({
    getParentRoute: () => root,
    path: "/settings",
    component: SettingsPage,
  }),
]);
const router = createRouter({ routeTree });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

startTheme();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
