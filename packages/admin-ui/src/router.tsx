import { Skeleton } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, createBrowserRouter } from "react-router";

import { AppShell } from "./components/app-shell";
import DeletePage from "./features/delete/page";
import FormPage from "./features/form/page";
import ListPage from "./features/list/page";
import { fetchMeta, metaKeys } from "./features/meta/_api";

/** Sends `/admin` to the first model so the admin never opens on an empty screen. */
function FirstModelRedirect(): React.ReactElement {
  const meta = useQuery({ queryKey: metaKeys.root(), queryFn: fetchMeta });
  if (meta.isPending) return <Skeleton className="h-32 w-full" />;
  const first = meta.data?.models[0]?.path;
  if (first === undefined) {
    return <p className="text-sm text-neutral-500">No models are registered.</p>;
  }
  return <Navigate to={first} replace />;
}

/**
 * The SPA is served for every unmatched `/admin/*` path, so the browser router owns its own routes
 * while the Worker owns `/admin/api/*`. `basename` keeps the two from ever colliding.
 */
export const router = createBrowserRouter([
  {
    path: "/admin",
    element: <AppShell />,
    children: [
      { index: true, element: <FirstModelRedirect /> },
      { path: ":app/:model", element: <ListPage /> },
      { path: ":app/:model/new", element: <FormPage /> },
      { path: ":app/:model/:id/delete", element: <DeletePage /> },
      { path: ":app/:model/:id", element: <FormPage /> },
    ],
  },
  { path: "*", element: <Navigate to="/admin" replace /> },
]);
