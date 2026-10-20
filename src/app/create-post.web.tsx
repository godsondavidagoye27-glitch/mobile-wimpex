import { goBack } from '../lib/navigation';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../components/Icon';
import { theme } from '../theme/theme';

export default function CreatePostWebScreen() {
  return (
    <View style={styles.screen}>
      <Pressable
        onPress={() => goBack()}
        style={styles.backButton}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Icon name="back" size={20} color={theme.colors.white} />
      </Pressable>
      <Icon name="video" size={24} color={theme.colors.primary} />
      <Text style={styles.title}>Create a video post in the app</Text>
      <Text style={styles.message}>
        Video selection and uploads are available in the Wimpex iOS and Android apps.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    backgroundColor: theme.colors.black,
  },
  backButton: {
    position: 'absolute',
    top: 18,
    left: 18,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: theme.colors.white,
    fontSize: 21,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 18,
  },
  message: {
    color: theme.colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 10,
  },
});
