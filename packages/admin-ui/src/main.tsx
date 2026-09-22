import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { Toaster } from "sonner";

import { ErrorBoundary } from "@/components/error-boundary";
import { queryClient } from "@/lib/query-client";
import { router } from "@/router";
import "@/styles/globals.css";

const container = document.getElementById("root");
if (container === null) throw new Error("The admin shell is missing its #root element.");

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
