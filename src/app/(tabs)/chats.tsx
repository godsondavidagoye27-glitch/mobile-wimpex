import { Link } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../components/Icon';
import { chatThreads } from '../../data/mock';
import { theme } from '../../theme/theme';

export default function ChatsScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Chats</Text>
        <Pressable style={styles.iconButton} accessibilityRole="button">
          <Icon name="search" size={20} color={theme.colors.white} />
        </Pressable>
      </View>

      <FlatList
        data={chatThreads}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Link href="/post/1" asChild>
            <Pressable style={styles.chatRow} accessibilityRole="button">
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.name.slice(0, 1)}</Text>
                {item.online && <View style={styles.onlineDot} />}
              </View>
              <View style={styles.chatBody}>
                <View style={styles.chatTopRow}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.time}>{item.time}</Text>
                </View>
                <Text style={styles.message} numberOfLines={1}>{item.message}</Text>
              </View>
              {item.unread > 0 && (
                <View style={styles.unreadPill}>
                  <Text style={styles.unreadText}>{item.unread}</Text>
                </View>
              )}
            </Pressable>
          </Link>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.black,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: {
    color: theme.colors.white,
    fontSize: 28,
    fontWeight: '800',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#171C22',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.line,
  },
  list: {
    paddingHorizontal: 18,
    paddingBottom: 90,
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.line,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#1B2A35',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    position: 'relative',
  },
  avatarText: {
    color: theme.colors.white,
    fontWeight: '700',
    fontSize: 18,
  },
  onlineDot: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.success,
    borderWidth: 2,
    borderColor: theme.colors.black,
  },
  chatBody: {
    flex: 1,
  },
  chatTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  name: {
    color: theme.colors.white,
    fontWeight: '700',
    fontSize: 15,
  },
  time: {
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  message: {
    color: theme.colors.textMuted,
    fontSize: 13,
  },
  unreadPill: {
    backgroundColor: theme.colors.primary,
    borderRadius: 999,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  unreadText: {
    color: theme.colors.black,
    fontWeight: '800',
    fontSize: 12,
  },
});
