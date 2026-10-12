import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { ProfileScreen } from '../../components/ProfileScreen';
import { currentUserProfile, otherProfiles } from '../../data/profile';
import { theme } from '../../theme/theme';

export default function UserProfileRoute() {
  const params = useLocalSearchParams<{ username?: string }>();
  const username = typeof params.username === 'string' ? params.username : '';
  const isOwner = username === currentUserProfile.username;
  const profile = isOwner ? currentUserProfile : otherProfiles[username];

  if (!profile) {
    return (
      <View style={styles.screen}>
        <Text style={styles.message}>User not found</Text>
      </View>
    );
  }

  return <ProfileScreen profile={profile} isOwner={isOwner} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.black,
  },
  message: {
    color: theme.colors.white,
    fontSize: 18,
    fontWeight: '700',
  },
});
