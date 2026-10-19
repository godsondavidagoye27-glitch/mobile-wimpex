import { describe, expect, it } from 'vitest';
import { classifyModeration } from './moderationScoring';

describe('classifyModeration', () => {
  it('separates high-confidence violations from review scores', () => {
    expect(classifyModeration({ sexual: 0.9, harassment: 0.65 })).toEqual([
      { category: 'nudity', score: 0.9, highConfidence: true },
      { category: 'abuse', score: 0.65, highConfidence: false },
    ]);
  });

  it('uses the model-provided spam score', () => {
    expect(classifyModeration({ spam: 0.9 })).toEqual([
      { category: 'spam', score: 0.9, highConfidence: true },
    ]);
    expect(classifyModeration({ spam: 0.2 })).toEqual([]);
  });
});
