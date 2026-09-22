import { Alert } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet } from "react-router";

import { ApiError } from "../lib/api-client";
import { fetchMeta, metaKeys } from "../features/meta/_api";

/** Chrome for every admin screen: sidebar navigation plus the routed page. */
export function AppShell(): React.ReactElement {
  const meta = useQuery({ queryKey: metaKeys.root(), queryFn: fetchMeta });

  if (meta.isPending) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-500">
        Loading admin…
      </div>
    );
  }

  if (meta.isError) {
    const error = meta.error;
    const denied = error instanceof ApiError && (error.status === 401 || error.status === 403);
    return (
      <div className="mx-auto max-w-xl p-8">
        <Alert status={denied ? "warning" : "danger"}>
          <Alert.Title>
            {denied ? "You do not have access to the admin" : "The admin API is unavailable"}
          </Alert.Title>
          <Alert.Description>
            {denied
              ? `${error.message} Sign in with a staff account, then reload.`
              : error instanceof Error
                ? error.message
                : String(error)}
          </Alert.Description>
        </Alert>
      </div>
    );
  }

  const groups = new Map<string, (typeof meta.data.models)[number][]>();
  for (const model of meta.data.models) {
    const existing = groups.get(model.appLabel);
    if (existing === undefined) groups.set(model.appLabel, [model]);
    else existing.push(model);
  }

  return (
    <div className="grid h-full grid-cols-[220px_1fr]">
      <nav className="flex flex-col gap-1 overflow-y-auto bg-sidebar px-4 py-4 text-sidebar-foreground">
        <p className="mb-3 text-sm font-semibold">Clango</p>
        {[...groups.entries()].map(([appLabel, models]) => (
          <div key={appLabel} className="mb-3">
            <p className="mb-1 text-[11px] font-medium tracking-wide text-sidebar-muted uppercase">
              {appLabel}
            </p>
            <ul className="space-y-0.5">
              {models.map((model) => (
                <li key={model.name}>
                  <NavLink
                    to={model.path}
                    className={({ isActive }) =>
                      `block rounded px-2 py-1 text-sm ${isActive ? "bg-white/10" : "hover:bg-white/5"}`
                    }
                  >
                    {model.verboseNamePlural}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {meta.data.user === null ? (
          <p className="mt-auto text-[11px] leading-snug text-sidebar-muted">
            Not authenticated. The staff gate arrives with the auth adapter in M4.
          </p>
        ) : null}
      </nav>
      <main className="overflow-y-auto px-8 py-6">
        <Outlet />
      </main>
    </div>
  );
}
