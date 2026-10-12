import { router } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../components/Icon';
import { theme } from '../../theme/theme';

const createOptions = [
  { key: 'video', title: 'Video', description: 'Record or upload a clip', icon: 'video' },
  { key: 'story', title: 'Story', description: 'Share a quick update', icon: 'sparkles' },
  { key: 'live', title: 'Live', description: 'Go live with your audience', icon: 'radio' },
  { key: 'community', title: 'Community post', description: 'Start a discussion', icon: 'groups' },
] as const;

export default function CreateScreen() {
  const handlePress = (key: string) => {
    if (key === 'video' || key === 'community') {
      router.push('/create-post');
      return;
    }

    const title = key === 'story' ? 'Story' : 'Live';
    const message = key === 'story' ? 'Story is not available yet.' : 'Live is not available yet.';

    Alert.alert(title, message);
  };

  return (
    <View style={styles.screen}>
      <Pressable style={styles.backdrop} onPress={() => router.back()} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>Create</Text>
        {createOptions.map((option) => (
          <Pressable key={option.key} style={styles.optionRow} onPress={() => handlePress(option.key)} accessibilityRole="button">
            <View style={styles.iconBox}>
              <Icon name={option.icon === 'radio' ? 'live' : option.icon === 'groups' ? 'groups' : option.icon as any} size={20} color={theme.colors.primary} />
            </View>
            <View style={styles.textWrap}>
              <Text style={styles.optionTitle}>{option.title}</Text>
              <Text style={styles.optionDescription}>{option.description}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: '#111418',
    borderTopWidth: 1,
    borderTopColor: theme.colors.line,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 32,
  },
  handle: {
    width: 52,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#374151',
    alignSelf: 'center',
    marginBottom: 10,
  },
  title: {
    color: theme.colors.white,
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 14,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.line,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#171C22',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  textWrap: {
    flex: 1,
  },
  optionTitle: {
    color: theme.colors.white,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  optionDescription: {
    color: theme.colors.textMuted,
    fontSize: 12,
  },
});
