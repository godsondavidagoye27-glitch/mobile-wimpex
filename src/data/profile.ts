export type Profile = {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  link?: string;
  initials: string;
  avatarColor: string;
  avatarGradient: [string, string];
  following: number;
  followers: number;
  likes: number;
  isPrivate: boolean;
  showLikedVideos: boolean;
  highlights: Array<{ id: string; name: string; initials: string; color: string }>;
};

export type PostItem = {
  id: string;
  title: string;
  image: string;
  views: number;
  pinned?: boolean;
  processing?: boolean;
  liked?: boolean;
  saved?: boolean;
  audience?: 'Everyone' | 'Friends' | 'Only me';
};

export const currentUserProfile: Profile = {
  id: 'me',
  username: 'ariwimpex',
  displayName: 'Ari Walker',
  bio: 'Designing quiet rituals for the new wave of creators.',
  link: 'wimpex.app/ari',
  initials: 'AW',
  avatarColor: '#1D3557',
  avatarGradient: ['#38BDF8', '#22C55E'],
  following: 1284,
  followers: 24500,
  likes: 482000,
  isPrivate: false,
  showLikedVideos: false,
  highlights: [
    { id: 'plus', name: 'New', initials: '+', color: '#1E293B' },
    { id: 'h1', name: 'Launch', initials: 'L', color: '#38BDF8' },
    { id: 'h2', name: 'Trips', initials: 'T', color: '#22C55E' },
    { id: 'h3', name: 'Mood', initials: 'M', color: '#F59E0B' },
  ],
};

export const otherProfiles: Record<string, Profile> = {
  mila: {
    id: 'mila',
    username: 'mila',
    displayName: 'Mila Hart',
    bio: 'Field notes from creative work and slow travel.',
    link: 'mila.studio',
    initials: 'MH',
    avatarColor: '#2B2F36',
    avatarGradient: ['#38BDF8', '#A78BFA'],
    following: 342,
    followers: 18200,
    likes: 56000,
    isPrivate: false,
    showLikedVideos: true,
    highlights: [
      { id: 'h1', name: 'Studio', initials: 'S', color: '#38BDF8' },
      { id: 'h2', name: 'Trips', initials: 'T', color: '#22C55E' },
    ],
  },
  noah: {
    id: 'noah',
    username: 'noah',
    displayName: 'Noah Reed',
    bio: 'Designing community led experiences for curious people.',
    initials: 'NR',
    avatarColor: '#1F2937',
    avatarGradient: ['#F59E0B', '#38BDF8'],
    following: 482,
    followers: 11200,
    likes: 22400,
    isPrivate: false,
    showLikedVideos: false,
    highlights: [
      { id: 'h1', name: 'City', initials: 'C', color: '#38BDF8' },
      { id: 'h2', name: 'Food', initials: 'F', color: '#22C55E' },
    ],
  },
};

export const profilePosts: Record<string, PostItem[]> = {
  me: [
    { id: 'p1', title: 'Morning frame', image: 'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=900&q=80', views: 12.4, pinned: true },
    { id: 'p2', title: 'Studio light', image: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=900&q=80', views: 8.1 },
    { id: 'p3', title: 'Night run', image: 'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=900&q=80', views: 4.9, processing: true },
    { id: 'p4', title: 'Harbor edit', image: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80', views: 6.2 },
    { id: 'p5', title: 'City focus', image: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80', views: 3.8 },
    { id: 'p6', title: 'Coastline', image: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=900&q=80', views: 9.6 },
  ],
  mila: [
    { id: 'm1', title: 'Studio setup', image: 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=900&q=80', views: 7.9 },
    { id: 'm2', title: 'Weekend move', image: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=900&q=80', views: 5.2 },
    { id: 'm3', title: 'Slow travel', image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80', views: 6.7 },
  ],
  noah: [
    { id: 'n1', title: 'Mountain notes', image: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80', views: 11.2 },
    { id: 'n2', title: 'Street light', image: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80', views: 3.6 },
  ],
};

export const likedPosts: Record<string, PostItem[]> = {
  me: [
    { id: 'l1', title: 'Favorite frame', image: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80', views: 18.4 },
    { id: 'l2', title: 'Prefect light', image: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80', views: 12.2 },
  ],
  mila: [
    { id: 'ml1', title: 'Fave setup', image: 'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=900&q=80', views: 9.1 },
  ],
};

export const savedPosts: Record<string, PostItem[]> = {
  me: [
    { id: 's1', title: 'Saved clip', image: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=900&q=80', views: 8.3 },
    { id: 's2', title: 'Travel note', image: 'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=900&q=80', views: 4.1 },
  ],
};

export const profileSearch = [
  { id: 'mila', username: 'mila', displayName: 'Mila Hart', initials: 'MH', avatarColor: '#2B2F36', followed: true },
  { id: 'noah', username: 'noah', displayName: 'Noah Reed', initials: 'NR', avatarColor: '#1F2937', followed: false },
  { id: 'zoe', username: 'zoe', displayName: 'Zoe Kim', initials: 'ZK', avatarColor: '#1D3557', followed: false },
  { id: 'leo', username: 'leo', displayName: 'Leo Stone', initials: 'LS', avatarColor: '#2F3A2A', followed: true },
];
