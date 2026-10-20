import { goBack } from '../lib/navigation';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../components/Icon';
import { getErrorMessage } from '../lib/errorMessage';
import { fetchMyMessageRequests, respondToMessageRequest } from '../features/chats/chatService';
import { getSupabaseClient } from '../lib/supabase';
import { theme } from '../theme/theme';
import type { Database } from '../types/database';

type MessageRequest = Database['public']['Functions']['get_my_message_requests']['Returns'][number];

export default function MessageRequestsScreen() {
  const [requests, setRequests] = useState<MessageRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setRequests(await fetchMyMessageRequests(getSupabaseClient()));
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    void refresh().catch(async (caught: unknown) => {
      if (active) setError(await getErrorMessage(caught, 'Could not load message requests.'));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [refresh]));

  const respond = async (request: MessageRequest, accept: boolean) => {
    try {
      await respondToMessageRequest(getSupabaseClient(), request.conversation_id, accept);
      await refresh();
      if (accept) router.push({ pathname: '/chat/[id]', params: { id: request.conversation_id } });
    } catch (caught) {
      setError(await getErrorMessage(caught, 'Could not update this message request.'));
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack()} style={styles.back} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.title}>Message requests</Text>
        <View style={styles.back} />
      </View>
      {loading ? <ActivityIndicator color={theme.colors.primary} /> : (
        <ScrollView contentContainerStyle={styles.content}>
          {!requests.length ? <Text style={styles.empty}>No message requests.</Text> : requests.map((request) => (
            <View key={request.conversation_id} style={styles.card}>
              <Text style={styles.name}>{request.display_name} · @{request.username}</Text>
              <Text style={styles.body}>{request.body || 'Would like to message you.'}</Text>
              <View style={styles.actions}>
                <Pressable onPress={() => void respond(request, false)} style={styles.decline}>
                  <Text style={styles.declineText}>Delete</Text>
                </Pressable>
                <Pressable onPress={() => void respond(request, true)} style={styles.accept}>
                  <Text style={styles.acceptText}>Accept</Text>
                </Pressable>
              </View>
            </View>
          ))}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black, paddingTop: 12 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  back: { width: 36 },
  title: { color: theme.colors.white, fontSize: 18, fontWeight: '700' },
  content: { padding: 16, gap: 12 },
  card: { padding: 16, borderRadius: 12, backgroundColor: theme.colors.surface, gap: 8 },
  name: { color: theme.colors.white, fontWeight: '700' },
  body: { color: theme.colors.textMuted },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  decline: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.line },
  declineText: { color: theme.colors.white, fontWeight: '700' },
  accept: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: theme.colors.primary },
  acceptText: { color: theme.colors.black, fontWeight: '800' },
  empty: { color: theme.colors.textMuted, textAlign: 'center', marginTop: 48 },
  error: { color: theme.colors.danger },
});
