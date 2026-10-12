import { useLocalSearchParams } from 'expo-router';
import { ProfileScreen } from '../components/ProfileScreen';
import { currentUserProfile, otherProfiles } from '../data/profile';

export default function UserProfileRoute() {
  const params = useLocalSearchParams<{ username?: string }>();
  const username = params.username ?? 'mila';
  const profile = username === currentUserProfile.username ? currentUserProfile : otherProfiles[username] ?? otherProfiles.mila;

  return <ProfileScreen profile={profile} isOwner={false} />;
}
