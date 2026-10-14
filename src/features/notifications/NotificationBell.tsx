import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../components/Icon';
import { theme } from '../../theme/theme';
import { useNotificationUnreadCount } from './useNotificationUnreadCount';

export function NotificationBell() {
  const unreadCount = useNotificationUnreadCount();

  return (
    <Link href="/notifications" asChild>
      <Pressable
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
      >
        <Icon name="bell" size={20} color={theme.colors.white} />
        {unreadCount > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
          </View>
        ) : null}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.line,
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -5,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.danger,
  },
  badgeText: {
    color: theme.colors.white,
    fontSize: 10,
    fontWeight: '800',
  },
});
