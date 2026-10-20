import { describe, expect, it } from 'vitest';
import {
  aggregatePollVotes,
  normalizedStickerPosition,
  recordPollVoteOnce,
  validateStorySticker,
} from './storyStickerLogic';

describe('story poll results', () => {
  it('records at most one vote for each viewer', () => {
    const firstVote = recordPollVoteOnce([], 'viewer-1', 1);
    const attemptedSecondVote = recordPollVoteOnce(firstVote, 'viewer-1', 2);

    expect(attemptedSecondVote).toEqual([{ voter_id: 'viewer-1', option_number: 1 }]);
  });

  it('aggregates unique votes and identifies the viewing voter', () => {
    expect(aggregatePollVotes([
      { voter_id: 'viewer-1', option_number: 1 },
      { voter_id: 'viewer-1', option_number: 2 },
      { voter_id: 'viewer-2', option_number: 2 },
    ], 'viewer-2')).toEqual({
      optionOneCount: 1,
      optionTwoCount: 1,
      totalVotes: 2,
      viewerOption: 2,
    });
  });

  it('keeps sticker coordinates within the story canvas', () => {
    expect(normalizedStickerPosition(-0.2)).toBe(0);
    expect(normalizedStickerPosition(0.7)).toBe(0.7);
    expect(normalizedStickerPosition(1.2)).toBe(1);
  });

  it('requires a prompt and two choices for polls', () => {
    expect(validateStorySticker({
      kind: 'poll',
      prompt: 'Pick one',
      optionOne: 'Yes',
      optionTwo: '',
    })).toBe('Add both choices to your poll.');
    expect(validateStorySticker({
      kind: 'question',
      prompt: 'Ask me anything',
      optionOne: '',
      optionTwo: '',
    })).toBeNull();
  });
});
