import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { Toaster } from "sonner";

import { ErrorBoundary } from "@/components/error-boundary";
import { queryClient } from "@/lib/query-client";
import { router } from "@/router";
import "@/styles/globals.css";

/** Options accepted by {@link mountAdminUi}. */
export interface MountOptions {
  /**
   * Called before the first render, so an application can `registerWidget` for its own fields.
   *
   * Registering later would work too, but the first form rendered might then show the fallback.
   */
  readonly onRegisterWidgets?: () => void;
}

/**
 * Mounts the admin SPA.
 *
 * Exported so an application can build its own bundle and register custom widgets, rather than being
 * limited to the prebuilt one in `packages/admin-ui/dist` (D-059).
 */
export function mountAdminUi(container: HTMLElement, options: MountOptions = {}): void {
  options.onRegisterWidgets?.();
  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
          <Toaster position="bottom-right" richColors />
        </QueryClientProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
}
