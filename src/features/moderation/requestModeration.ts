import { getSupabaseClient } from '../../lib/supabase';

export function requestPendingModeration(context: 'post' | 'comment') {
  void getSupabaseClient().functions.invoke('moderate-content', { body: {} })
    .then(({ error }) => {
      if (error) console.error(`Moderation could not be requested for the new ${context}.`, error);
    })
    .catch((error: unknown) => {
      console.error(`Moderation could not be requested for the new ${context}.`, error);
    });
}
