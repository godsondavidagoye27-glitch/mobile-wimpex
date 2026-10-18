import { AppState } from 'react-native';
import { useEffect } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getSupabaseClient } from '../../lib/supabase';
import { createVerifiedMapLoader } from './verifiedMapCache';

export { createVerifiedMapLoader } from './verifiedMapCache';
export type { VerifiedMap } from './verifiedMapCache';
const queryClients = new Map<QueryClient, number>();
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;

const loadVerifiedMap = createVerifiedMapLoader(async (ids) => {
  const { data, error } = await getSupabaseClient()
    .from('profiles')
    .select('id,is_verified')
    .in('id', ids);
  if (error) throw error;
  return data ?? [];
}, 5_000);

export function fetchVerifiedMap(ids: string[]) {
  return loadVerifiedMap(ids);
}

export function useVerifiedMap(ids: string[]) {
  const sortedIds = [...new Set(ids.filter(Boolean))].sort();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['verified-map', sortedIds],
    queryFn: () => fetchVerifiedMap(sortedIds),
    enabled: sortedIds.length > 0,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (sortedIds.length === 0) return undefined;
    queryClients.set(queryClient, (queryClients.get(queryClient) ?? 0) + 1);
    if (!appStateSubscription) {
      appStateSubscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          for (const client of queryClients.keys()) {
            void client.invalidateQueries({ queryKey: ['verified-map'] });
          }
        }
      });
    }
    return () => {
      const references = queryClients.get(queryClient) ?? 0;
      if (references <= 1) queryClients.delete(queryClient);
      else queryClients.set(queryClient, references - 1);
      if (queryClients.size === 0) {
        appStateSubscription?.remove();
        appStateSubscription = null;
      }
    };
  }, [queryClient, sortedIds.length]);
  return query;
}
