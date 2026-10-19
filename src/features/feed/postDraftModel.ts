import type { VideoDraft } from './uploadManager';

export type SavedPostDraft = {
  id: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  video: VideoDraft;
};

export function createPostDraft(
  id: string,
  ownerId: string,
  video: VideoDraft,
  timestamp: string,
): SavedPostDraft {
  return { id, ownerId, createdAt: timestamp, updatedAt: timestamp, video };
}

export function updatePostDraft(
  current: SavedPostDraft,
  video: VideoDraft,
  timestamp: string,
): SavedPostDraft {
  return { ...current, video, updatedAt: timestamp };
}

export function restorePostDraft(
  drafts: SavedPostDraft[],
  id: string,
): SavedPostDraft | null {
  return drafts.find((draft) => draft.id === id) ?? null;
}

export function cleanupPostDraft(
  drafts: SavedPostDraft[],
  id: string,
): { drafts: SavedPostDraft[]; removed: SavedPostDraft | null } {
  const removed = restorePostDraft(drafts, id);
  return { drafts: drafts.filter((draft) => draft.id !== id), removed };
}

export function cleanupUploadedPostDraft(
  drafts: SavedPostDraft[],
  ownerId: string,
  videoUri: string,
): SavedPostDraft[] {
  return drafts.filter((draft) => draft.ownerId !== ownerId || draft.video.uri !== videoUri);
}

export function sortPostDrafts(drafts: SavedPostDraft[]): SavedPostDraft[] {
  return [...drafts].sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
}
