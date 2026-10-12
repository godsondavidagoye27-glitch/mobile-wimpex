import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../components/Icon';
import { communities } from '../../data/mock';
import { theme } from '../../theme/theme';

export default function GroupsScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Groups</Text>
        <Pressable style={styles.iconButton} accessibilityRole="button">
          <Icon name="search" size={20} color={theme.colors.white} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {communities.map((community: (typeof communities)[number]) => (
          <View key={community.name} style={styles.communityCard}>
            <View style={styles.iconWrap}>
              <Icon name="groups" size={24} color={theme.colors.primary} />
            </View>
            <View style={styles.communityBody}>
              <Text style={styles.communityName}>{community.name}</Text>
              <Text style={styles.meta}>{community.members} members</Text>
              <Text style={styles.description}>{community.description}</Text>
            </View>
            <Pressable style={[styles.joinButton, community.joined && styles.joinedButton]} accessibilityRole="button">
              <Text style={[styles.joinText, community.joined && styles.joinedText]}>{community.joined ? 'Joined' : 'Join'}</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
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
  communityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.line,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#16232A',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  communityBody: {
    flex: 1,
  },
  communityName: {
    color: theme.colors.white,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 2,
  },
  meta: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginBottom: 4,
  },
  description: {
    color: theme.colors.textMuted,
    fontSize: 13,
  },
  joinButton: {
    backgroundColor: '#142A38',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 78,
    alignItems: 'center',
  },
  joinedButton: {
    backgroundColor: 'rgba(34,197,94,0.12)',
  },
  joinText: {
    color: theme.colors.primary,
    fontWeight: '700',
  },
  joinedText: {
    color: theme.colors.success,
  },
});
