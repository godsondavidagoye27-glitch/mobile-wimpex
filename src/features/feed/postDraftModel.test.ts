import { describe, expect, it } from 'vitest';
import {
  cleanupPostDraft,
  cleanupUploadedPostDraft,
  createPostDraft,
  restorePostDraft,
  sortPostDrafts,
  updatePostDraft,
} from './postDraftModel';
import type { VideoDraft } from './uploadManager';

const video: VideoDraft = {
  uri: 'file:///draft.mp4',
  fileName: 'draft.mp4',
  contentType: 'video/mp4',
  fileSize: 1024,
  durationMs: 5000,
  width: 720,
  height: 1280,
  caption: 'Draft caption',
  audience: 'followers',
  allowComments: false,
  autoCaptions: true,
};

describe('post draft model', () => {
  it('creates a draft with creation and update timestamps', () => {
    expect(createPostDraft('draft-1', 'owner-1', video, '2026-10-19T10:00:00.000Z')).toEqual({
      id: 'draft-1',
      ownerId: 'owner-1',
      createdAt: '2026-10-19T10:00:00.000Z',
      updatedAt: '2026-10-19T10:00:00.000Z',
      video,
    });
  });

  it('updates the content and last-edited timestamp without changing identity', () => {
    const created = createPostDraft('draft-1', 'owner-1', video, '2026-10-19T10:00:00.000Z');
    const changed = updatePostDraft(created, { ...video, caption: 'Updated' }, '2026-10-19T10:05:00.000Z');
    expect(changed).toMatchObject({
      id: created.id,
      ownerId: created.ownerId,
      createdAt: created.createdAt,
      updatedAt: '2026-10-19T10:05:00.000Z',
      video: { caption: 'Updated' },
    });
  });

  it('restores the selected draft and orders the newest edit first', () => {
    const older = createPostDraft('draft-1', 'owner-1', video, '2026-10-19T10:00:00.000Z');
    const newer = createPostDraft('draft-2', 'owner-1', video, '2026-10-19T10:05:00.000Z');
    expect(restorePostDraft([older, newer], 'draft-2')).toEqual(newer);
    expect(sortPostDrafts([older, newer])).toEqual([newer, older]);
  });

  it('cleans up only the requested draft', () => {
    const first = createPostDraft('draft-1', 'owner-1', video, '2026-10-19T10:00:00.000Z');
    const second = createPostDraft('draft-2', 'owner-1', video, '2026-10-19T10:05:00.000Z');
    expect(cleanupPostDraft([first, second], 'draft-1')).toEqual({
      drafts: [second],
      removed: first,
    });
  });

  it('cleans the uploaded video draft only for its owner', () => {
    const uploaded = createPostDraft('draft-1', 'owner-1', video, '2026-10-19T10:00:00.000Z');
    const sameUriOtherOwner = createPostDraft('draft-2', 'owner-2', video, '2026-10-19T10:05:00.000Z');
    const otherVideo = createPostDraft(
      'draft-3',
      'owner-1',
      { ...video, uri: 'file:///other.mp4' },
      '2026-10-19T10:10:00.000Z',
    );
    expect(cleanupUploadedPostDraft(
      [uploaded, sameUriOtherOwner, otherVideo],
      'owner-1',
      video.uri,
    )).toEqual([sameUriOtherOwner, otherVideo]);
  });
});
