import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { getErrorMessage } from '../../lib/errorMessage';
import { theme } from '../../theme/theme';
import {
  muteNotificationTarget,
  notificationMuteDurations,
  type NotificationMuteTargetType,
} from './notificationMutes';

type Props = {
  visible: boolean;
  targetType: NotificationMuteTargetType;
  targetId: string;
  targetLabel: string;
  onClose: () => void;
  onSaved: () => void;
};

export function NotificationMuteSheet({
  visible,
  targetType,
  targetId,
  targetLabel,
  onClose,
  onSaved,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const chooseDuration = async (minutes: number | null) => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await muteNotificationTarget(targetType, targetId, minutes);
      onClose();
      onSaved();
    } catch (caught) {
      setError(await getErrorMessage(caught, 'Unable to mute notifications.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.title}>Mute {targetLabel}</Text>
        <Text style={styles.copy}>Choose how long to stop notifications.</Text>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {notificationMuteDurations.map((duration) => (
          <Pressable
            key={duration.label}
            onPress={() => void chooseDuration(duration.minutes)}
            disabled={saving}
            style={styles.row}
            accessibilityRole="button"
          >
            <Text style={styles.rowText}>{duration.label}</Text>
            {saving ? <ActivityIndicator color={theme.colors.primary} /> : null}
          </Pressable>
        ))}
        <Pressable onPress={onClose} disabled={saving} style={styles.cancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.62)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, paddingBottom: 30, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: theme.colors.surface },
  title: { color: theme.colors.white, fontSize: 18, fontWeight: '800', paddingVertical: 8 },
  copy: { color: theme.colors.textMuted, fontSize: 13, paddingBottom: 10 },
  error: { color: theme.colors.danger, fontSize: 13, paddingBottom: 8 },
  row: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  rowText: { color: theme.colors.white, fontSize: 14, fontWeight: '600' },
  cancel: { minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: theme.colors.textMuted, fontWeight: '700' },
});
