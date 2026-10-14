import { describe, expect, it } from 'vitest';
import {
  createStoryTimeline,
  fitStoryImageDimensions,
  formatStoryExpiry,
  orderStoryRail,
  storyTimelineReducer,
  validateStoryCaption,
  validateStoryVideo,
} from './storyTimeline';

describe('story timeline', () => {
  it('advances stories and moves to the next author', () => {
    const state = createStoryTimeline([2, 1]);
    const nextStory = storyTimelineReducer(state, { type: 'advance' });
    expect(nextStory.storyIndex).toBe(1);
    expect(storyTimelineReducer(nextStory, { type: 'advance' })).toMatchObject({
      authorIndex: 1,
      storyIndex: 0,
    });
  });

  it('moves to the previous story and author', () => {
    const state = { ...createStoryTimeline([2, 2], 1), storyIndex: 0 };
    expect(storyTimelineReducer(state, { type: 'previous' })).toMatchObject({
      authorIndex: 0,
      storyIndex: 1,
    });
    expect(storyTimelineReducer({ ...state, storyIndex: 1 }, { type: 'previous' }).storyIndex).toBe(0);
  });

  it('pauses, resumes, and holds the timeline', () => {
    const state = createStoryTimeline([1]);
    expect(storyTimelineReducer(state, { type: 'pause' }).paused).toBe(true);
    expect(storyTimelineReducer(state, { type: 'hold', active: true })).toMatchObject({
      paused: true,
      holding: true,
    });
    expect(storyTimelineReducer(state, { type: 'resume' })).toMatchObject({
      paused: false,
      holding: false,
    });
  });

  it('supports direct author changes and ends after the rail', () => {
    const state = createStoryTimeline([1, 2]);
    expect(storyTimelineReducer(state, { type: 'move-author', direction: 1 })).toMatchObject({
      authorIndex: 1,
      storyIndex: 0,
    });
    const end = storyTimelineReducer({ ...state, authorIndex: 1, storyIndex: 1 }, { type: 'advance' });
    expect(end.ended).toBe(true);
    expect(storyTimelineReducer(end, { type: 'previous' })).toBe(end);
  });
});

describe('story rail and expiry', () => {
  const row = (author_id: string, is_owner: boolean, has_unseen: boolean, latest_created_at: string) => ({
    author_id,
    display_name: author_id,
    username: author_id,
    avatar_url: null,
    story_count: 1,
    has_unseen,
    is_close_friends_audience: false,
    latest_created_at,
    is_owner,
  });

  it('orders your own story, unseen, then seen authors by latest story', () => {
    expect(orderStoryRail([
      row('seen', false, false, '2026-10-14T10:00:00Z'),
      row('newer', false, true, '2026-10-14T09:00:00Z'),
      row('you', true, false, '2026-10-14T08:00:00Z'),
      row('older', false, true, '2026-10-14T07:00:00Z'),
    ]).map(({ author_id }) => author_id)).toEqual(['you', 'newer', 'older', 'seen']);
  });

  it('formats remaining expiry time', () => {
    const now = Date.parse('2026-10-14T10:00:00Z');
    expect(formatStoryExpiry('2026-10-15T08:01:00Z', now)).toBe('Expires in 22h');
    expect(formatStoryExpiry('2026-10-14T10:00:01Z', now)).toBe('Expires in 1m');
    expect(formatStoryExpiry('2026-10-14T09:59:00Z', now)).toBe('Expired');
  });
});

describe('story video validation', () => {
  it('enforces duration and file-size limits', () => {
    expect(validateStoryVideo(15001, 1024)).toBe('Stories can be up to 15 seconds. Choose a shorter video.');
    expect(validateStoryVideo(5000, 25 * 1024 * 1024 + 1)).toBe('This video is too large. Choose a video under 25 MB.');
    expect(validateStoryVideo(5000, 1024)).toBeNull();
  });

  describe('story composer validation', () => {
    it('fits photos inside the 1080 by 1920 limit without enlarging them', () => {
      expect(fitStoryImageDimensions(2400, 3000)).toEqual({ width: 1080, height: 1350 });
      expect(fitStoryImageDimensions(800, 1200)).toEqual({ width: 800, height: 1200 });
      expect(() => fitStoryImageDimensions(0, 1200)).toThrow('The selected photo dimensions could not be read.');
    });

    it('limits captions to 120 characters', () => {
      expect(validateStoryCaption('a'.repeat(120))).toBeNull();
      expect(validateStoryCaption('a'.repeat(121))).toBe('Captions must be 120 characters or fewer.');
    });
  });
});
