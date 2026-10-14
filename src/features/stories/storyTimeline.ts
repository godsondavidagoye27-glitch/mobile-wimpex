import type { StoryRailRow } from '../../types/database';

export type StoryTimelineState = {
  authorIndex: number;
  storyIndex: number;
  storyCounts: number[];
  paused: boolean;
  holding: boolean;
  ended: boolean;
};

export type StoryTimelineAction =
  | { type: 'advance' }
  | { type: 'previous' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'hold'; active: boolean }
  | { type: 'move-author'; direction: -1 | 1 };

export type StoryRailDisplayRow = StoryRailRow;

export function createStoryTimeline(storyCounts: number[], authorIndex = 0): StoryTimelineState {
  return {
    authorIndex,
    storyIndex: 0,
    storyCounts,
    paused: false,
    holding: false,
    ended: storyCounts.length === 0 || storyCounts.every((count) => count <= 0),
  };
}

export function storyTimelineReducer(
  state: StoryTimelineState,
  action: StoryTimelineAction,
): StoryTimelineState {
  if (state.ended) return state;

  if (action.type === 'pause') return { ...state, paused: true };
  if (action.type === 'resume') return { ...state, paused: false, holding: false };
  if (action.type === 'hold') {
    return { ...state, holding: action.active, paused: action.active };
  }

  if (action.type === 'move-author') {
    const authorIndex = state.authorIndex + action.direction;
    if (authorIndex < 0 || authorIndex >= state.storyCounts.length) return state;
    return {
      ...state,
      authorIndex,
      storyIndex: action.direction < 0 ? Math.max(0, state.storyCounts[authorIndex] - 1) : 0,
    };
  }

  if (action.type === 'advance') {
    if (state.storyIndex + 1 < state.storyCounts[state.authorIndex]) {
      return { ...state, storyIndex: state.storyIndex + 1 };
    }
    if (state.authorIndex + 1 < state.storyCounts.length) {
      return { ...state, authorIndex: state.authorIndex + 1, storyIndex: 0 };
    }
    return { ...state, ended: true };
  }

  if (state.storyIndex > 0) return { ...state, storyIndex: state.storyIndex - 1 };
  if (state.authorIndex > 0) {
    const authorIndex = state.authorIndex - 1;
    return {
      ...state,
      authorIndex,
      storyIndex: Math.max(0, state.storyCounts[authorIndex] - 1),
    };
  }
  return state;
}

export function orderStoryRail<T extends StoryRailDisplayRow>(rows: T[]): T[] {
  return [...rows].sort((first, second) => {
    if (first.is_owner !== second.is_owner) return first.is_owner ? -1 : 1;
    if (first.has_unseen !== second.has_unseen) return first.has_unseen ? -1 : 1;
    return (second.latest_created_at ?? '').localeCompare(first.latest_created_at ?? '');
  });
}

export function formatStoryExpiry(expiresAt: string, now = Date.now()): string {
  const remainingMs = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 'Expired';
  const hour = 60 * 60 * 1000;
  if (remainingMs < hour) {
    const minutes = Math.max(1, Math.ceil(remainingMs / (60 * 1000)));
    return `Expires in ${minutes}m`;
  }
  return `Expires in ${Math.max(1, Math.floor(remainingMs / hour))}h`;
}

export function validateStoryVideo(durationMs: number, sizeBytes: number): string | null {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 15000) {
    return 'Stories can be up to 15 seconds. Choose a shorter video.';
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > 25 * 1024 * 1024) {
    return 'This video is too large. Choose a video under 25 MB.';
  }
  return null;
}

export function fitStoryImageDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('The selected photo dimensions could not be read.');
  }
  const scale = Math.min(1080 / width, 1920 / height, 1);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

export function validateStoryCaption(caption: string) {
  return caption.length <= 120 ? null : 'Captions must be 120 characters or fewer.';
}
