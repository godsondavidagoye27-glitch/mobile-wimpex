import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { getErrorMessage } from '../../lib/errorMessage';
import { getSupabaseClient } from '../../lib/supabase';
import { theme } from '../../theme/theme';
import type { NotificationMuteRpcRow } from '../../types/database';
import { setMutedUserCalls, unmuteNotificationTarget } from './notificationMutes';

type Props = {
  visible: boolean;
  onClose: () => void;
};

function expiryLabel(mutedUntil: string | null) {
  if (!mutedUntil) return 'Until you turn it back on';
  return `Until ${new Date(mutedUntil).toLocaleString()}`;
}

export function MutedTargetsSheet({ visible, onClose }: Props) {
  const [rows, setRows] = useState<NotificationMuteRpcRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyTarget, setBusyTarget] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: loadError } = await getSupabaseClient().rpc('get_my_notification_mutes');
      if (loadError) throw loadError;
      setRows(data ?? []);
    } catch (caught) {
      setError(await getErrorMessage(caught, 'Unable to load muted notifications.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) void load();
  }, [load, visible]);

  const toggleCalls = async (row: NotificationMuteRpcRow, muteCalls: boolean) => {
    setBusyTarget(row.target_id);
    setError('');
    try {
      await setMutedUserCalls(row.target_id, muteCalls);
      setRows((current) => current.map((item) => item.target_id === row.target_id
        && item.target_type === 'user' ? { ...item, mute_calls: muteCalls } : item));
    } catch (caught) {
      setError(await getErrorMessage(caught, 'Unable to update call notifications.'));
    } finally {
      setBusyTarget('');
    }
  };

  const unmute = async (row: NotificationMuteRpcRow) => {
    setBusyTarget(row.target_id);
    setError('');
    try {
      await unmuteNotificationTarget(row.target_type, row.target_id);
      setRows((current) => current.filter((item) => !(
        item.target_type === row.target_type && item.target_id === row.target_id
      )));
    } catch (caught) {
      setError(await getErrorMessage(caught, 'Unable to unmute notifications.'));
    } finally {
      setBusyTarget('');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close muted list">
            <Text style={styles.headerAction}>Done</Text>
          </Pressable>
          <Text style={styles.title}>Muted</Text>
          <Pressable onPress={() => void load()} accessibilityRole="button" accessibilityLabel="Refresh muted list">
            <Text style={styles.headerAction}>Refresh</Text>
          </Pressable>
        </View>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {loading ? <ActivityIndicator style={styles.loading} color={theme.colors.primary} /> : (
          <FlatList
            data={rows}
            keyExtractor={(row) => `${row.target_type}:${row.target_id}`}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.empty}>No active mutes.</Text>}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <View style={styles.rowContent}>
                  <Text style={styles.label}>{item.target_label}</Text>
                  <Text style={styles.subtitle}>{item.target_type} · {expiryLabel(item.muted_until)}</Text>
                  {item.target_type === 'user' ? (
                    <View style={styles.callsRow}>
                      <Text style={styles.callsLabel}>Mute calls too</Text>
                      <Switch
                        value={item.mute_calls}
                        onValueChange={(value) => void toggleCalls(item, value)}
                        disabled={busyTarget === item.target_id}
                        trackColor={{ false: '#374151', true: theme.colors.success }}
                        thumbColor={theme.colors.white}
                      />
                    </View>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => void unmute(item)}
                  disabled={busyTarget === item.target_id}
                  style={styles.unmute}
                  accessibilityRole="button"
                >
                  {busyTarget === item.target_id
                    ? <ActivityIndicator color={theme.colors.primary} />
                    : <Text style={styles.unmuteText}>Unmute</Text>}
                </Pressable>
              </View>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black, paddingTop: 52 },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  headerAction: { color: theme.colors.primary, fontWeight: '700' },
  title: { color: theme.colors.white, fontSize: 19, fontWeight: '800' },
  error: { color: theme.colors.danger, padding: 14 },
  loading: { marginTop: 36 },
  list: { padding: 16, flexGrow: 1 },
  empty: { color: theme.colors.textMuted, textAlign: 'center', marginTop: 40 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 10, backgroundColor: theme.colors.surface, borderRadius: 14 },
  rowContent: { flex: 1 },
  label: { color: theme.colors.white, fontWeight: '700' },
  subtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 4 },
  callsRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  callsLabel: { color: theme.colors.textMuted, fontSize: 12 },
  unmute: { minWidth: 66, minHeight: 38, alignItems: 'center', justifyContent: 'center' },
  unmuteText: { color: theme.colors.primary, fontWeight: '700' },
});
