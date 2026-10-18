import { useLocalSearchParams } from 'expo-router';
import { ProfileScreen } from '../../features/profiles/ProfileScreen';
import { getSingleRouteParam } from '../../lib/routeParams';

export default function UserProfileRoute() {
  const params = useLocalSearchParams<{ username?: string }>();
  const username = getSingleRouteParam(params.username) ?? '';
  return <ProfileScreen username={username || null} />;
}
