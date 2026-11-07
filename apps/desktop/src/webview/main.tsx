import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { Home } from "./routes/home";
import { TripView } from "./routes/trip";

const root = createRootRoute({ component: Outlet });
const routeTree = root.addChildren([
  createRoute({ getParentRoute: () => root, path: "/", component: Home }),
  createRoute({
    getParentRoute: () => root,
    path: "/trips/$tripId",
    component: TripView,
  }),
]);
const router = createRouter({ routeTree });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000 } }, // no refetch flash on remount/focus
});
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
