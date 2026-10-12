export const stories = [
  { id: 'you', name: 'Your story', initial: 'Y', color: '#38BDF8', isOwner: true },
  { id: 'mila', name: 'Mila', initial: 'M', color: '#22C55E' },
  { id: 'zoe', name: 'Zoe', initial: 'Z', color: '#38BDF8' },
  { id: 'leo', name: 'Leo', initial: 'L', color: '#22C55E' },
  { id: 'noah', name: 'Noah', initial: 'N', color: '#38BDF8' },
];

export const feed = [
  {
    id: '1',
    user: 'Ari',
    handle: '@ari',
    caption: 'Sunrise skate session before the city wakes up.',
    hashtags: ['#sunrise', '#skate', '#citylights'],
    likes: 1842,
    comments: 292,
    saves: 97,
    duration: 0.66,
    image:
      'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: '2',
    user: 'Jun',
    handle: '@jun',
    caption: 'Tiny home office reset — the calm before the launch.',
    hashtags: ['#workspace', '#startup'],
    likes: 1204,
    comments: 89,
    saves: 64,
    duration: 0.38,
    image:
      'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: '3',
    user: 'Nia',
    handle: '@nia',
    caption: 'Weekend coffee crawl around the old market.',
    hashtags: ['#coffee', '#weekend'],
    likes: 2915,
    comments: 341,
    saves: 189,
    duration: 0.73,
    image:
      'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=900&q=80',
  },
];

export const liveMoments = [
  { id: 'live-1', label: 'Live now', title: 'City rooftop jam', viewers: '2.8k', gradient: ['#38BDF8', '#22C55E'] },
  { id: 'live-2', label: 'Creator room', title: 'Design sprint', viewers: '893', gradient: ['#FFD700', '#38BDF8'] },
];

export const chatThreads = [
  { id: 'c1', name: 'Mila', message: 'Can you send the final cut?', time: '2m', unread: 3, online: true },
  { id: 'c2', name: 'Noah', message: 'The new set is live. Want to join?', time: '12m', unread: 0, online: false },
  { id: 'c3', name: 'Rae', message: 'Photos from the weekend are here', time: '1h', unread: 7, online: true },
  { id: 'c4', name: 'Community club', message: 'Welcome to the launch discussion', time: '3h', unread: 2, online: false },
];

export const communities = [
  { name: 'Design Circle', members: '34k', description: 'Product, motion and visual systems.', joined: true },
  { name: 'Street Food', members: '18k', description: 'Hidden gems and late-night bites.', joined: false },
  { name: 'Creators Lab', members: '9.1k', description: 'Tools, workflows and creative experiments.', joined: true },
  { name: 'Climbing Crew', members: '22k', description: 'Routes, sessions, and big wall stories.', joined: false },
];

export const notifications = [
  { id: 'n1', title: 'Mila liked your post', meta: '2 mins ago' },
  { id: 'n2', title: 'New community post', meta: '39 mins ago' },
  { id: 'n3', title: 'Your story has 18 views', meta: '1 hour ago' },
];
