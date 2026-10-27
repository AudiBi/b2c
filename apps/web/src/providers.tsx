import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AuthProvider } from './auth/AuthProvider';

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      // Pas de nouvelle tentative automatique sur les erreurs 4xx ; une seule sur les pannes réseau
      queries: { retry: 1, refetchOnWindowFocus: false },
    },
  });

export function AppProviders({ client, children }: { client: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
