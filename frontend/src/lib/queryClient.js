import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,         // 60 seconds - data is fresh
      gcTime: 10 * 60 * 1000,        // 10 minutes garbage collection
      refetchOnWindowFocus: false,   // don't refetch on tab switch — prevents flicker
      retry: 1,                      // only retry once
      refetchOnReconnect: true,      // refetch when network comes back
      refetchOnMount: true,          // refetch when component mounts (but show stale data first)
    },
    mutations: {
      retry: 0,                      // don't retry mutations on failure
    },
  },
});
