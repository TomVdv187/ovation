"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, httpLink, loggerLink, splitLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { useState, type ReactNode } from "react";
import superjson from "superjson";
import type { AppRouter } from "~/server/router";

export const api = createTRPCReact<AppRouter>();

/**
 * Two links on purpose.
 *
 * Batching is the right default for a dashboard fetching six things at once.
 * It is the wrong default for a door scan: batching adds a scheduling delay
 * and, worse, couples a scan to whatever else is in flight, so one slow query
 * would sit inside the 2.5s budget. `live.checkin` therefore goes out on its
 * own unbatched request.
 */
export function TRPCProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
          mutations: {
            // The queue owns retries; a second automatic attempt here would
            // race the queue's replay for the same idempotency key.
            retry: 0,
          },
        },
      }),
  );

  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        loggerLink({
          enabled: (op) =>
            process.env.NODE_ENV === "development" &&
            op.direction === "down" &&
            op.result instanceof Error,
        }),
        splitLink({
          condition: (op) => op.path === "live.checkin",
          true: httpLink({ url: "/api/trpc", transformer: superjson }),
          false: httpBatchLink({ url: "/api/trpc", transformer: superjson }),
        }),
      ],
    }),
  );

  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </api.Provider>
  );
}
