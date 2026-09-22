import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The admin is a single-user surface on a fast local database; a retry only hides real errors.
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
  },
});
