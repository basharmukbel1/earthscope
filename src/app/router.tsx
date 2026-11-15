import { lazy } from "react";
import { createBrowserRouter } from "react-router";
import { AppShell } from "@/components/layout/AppShell";
import { RouteError } from "@/components/layout/RouteError";

const Home = lazy(() => import("@/pages/Home/HomePage"));
const Discovery = lazy(() => import("@/pages/Discovery/DiscoveryPage"));
const Investigation = lazy(() => import("@/pages/Investigation/InvestigationPage"));
const Workspace = lazy(() => import("@/pages/Workspace/WorkspacePage"));
const TrendLab = lazy(() => import("@/pages/TrendLab/TrendLabPage"));
const EarthExplorer = lazy(() => import("@/pages/EarthExplorer/EarthExplorerPage"));
const Compare = lazy(() => import("@/pages/RegionalComparison/ComparePage"));
const Relationships = lazy(() => import("@/pages/RelationshipLab/RelationshipPage"));
const AIScientist = lazy(() => import("@/pages/AIScientist/AIScientistPage"));
const Reports = lazy(() => import("@/pages/Reports/ReportsPage"));
const Resources = lazy(() => import("@/pages/Resources/ResourcesPage"));
const NotFound = lazy(() => import("@/pages/NotFound"));

export const ROUTES = {
  home: "/",
  discover: "/discover",
  investigate: "/investigate",
  workspace: "/workspace",
  trendLab: "/trend-lab",
  explorer: "/explorer",
  compare: "/compare",
  relationships: "/relationships",
  ai: "/ai-scientist",
  reports: "/reports",
  resources: "/resources",
} as const;

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Home /> },
      { path: "discover", element: <Discovery /> },
      { path: "investigate", element: <Investigation /> },
      { path: "workspace", element: <Workspace /> },
      { path: "trend-lab", element: <TrendLab /> },
      { path: "explorer", element: <EarthExplorer /> },
      { path: "compare", element: <Compare /> },
      { path: "relationships", element: <Relationships /> },
      { path: "ai-scientist", element: <AIScientist /> },
      { path: "reports", element: <Reports /> },
      { path: "resources", element: <Resources /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
