import { useLocalSearchParams } from 'expo-router';
import { ProfileScreen } from '../../features/profiles/ProfileScreen';

export default function UserProfileRoute() {
  const params = useLocalSearchParams<{ username?: string }>();
  const username = typeof params.username === 'string' ? params.username : '';
  return <ProfileScreen username={username || null} />;
}
