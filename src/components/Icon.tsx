import React from 'react';
import {
  ArrowLeft,
  Ban,
  Bell,
  Bookmark,
  Camera,
  Captions,
  Check,
  ChevronRight,
  Circle,
  Download,
  Eye,
  EyeOff,
  Flag,
  Globe,
  Heart,
  Home,
  Info,
  Languages,
  LayoutGrid,
  Link2,
  Lock,
  LogOut,
  MapPin,
  MessageCircle,
  MessageSquare,
  Mic,
  MoonStar,
  MoreHorizontal,
  Play,
  Plus,
  Radio,
  Search,
  Send,
  Settings,
  Share2,
  Shield,
  Sparkles,
  SunMedium,
  Trash2,
  User,
  Users,
  Video,
} from 'lucide-react-native';

const iconMap = {
  home: Home,
  chats: MessageSquare,
  plus: Plus,
  groups: Users,
  live: Radio,
  bell: Bell,
  moon: MoonStar,
  sun: SunMedium,
  search: Search,
  settings: Settings,
  heart: Heart,
  comment: MessageCircle,
  message: MessageCircle,
  bookmark: Bookmark,
  captions: Captions,
  play: Play,
  send: Send,
  back: ArrowLeft,
  user: User,
  mapPin: MapPin,
  sparkles: Sparkles,
  camera: Camera,
  video: Video,
  mic: Mic,
  check: Check,
  chevronRight: ChevronRight,
  shield: Shield,
  globe: Globe,
  lock: Lock,
  dot: Circle,
  more: MoreHorizontal,
  grid: LayoutGrid,
  link: Link2,
  pin: MapPin,
  share: Share2,
  logOut: LogOut,
  trash: Trash2,
  language: Languages,
  download: Download,
  flag: Flag,
  ban: Ban,
  info: Info,
  eye: Eye,
  eyeOff: EyeOff,
} as const;

export type AppIconName = keyof typeof iconMap;

export function Icon({
  name,
  size = 20,
  color,
  filled = false,
}: {
  name: AppIconName;
  size?: 20 | 24;
  color?: string;
  filled?: boolean;
}) {
  const Component = iconMap[name];

  return (
    <Component
      size={size}
      color={color}
      strokeWidth={1.75}
      fill={filled ? color ?? 'currentColor' : 'none'}
    />
  );
}
