import { ProfileScreen } from '../components/ProfileScreen';
import { currentUserProfile } from '../data/profile';

export default function ProfileRoute() {
  return <ProfileScreen profile={currentUserProfile} isOwner />;
}
