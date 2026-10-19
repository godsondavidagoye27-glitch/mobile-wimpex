import { describe, expect, it } from 'vitest';
import { parseOpenRouterModerationResponse } from './openRouterModeration';

const scores = {
  sexual: 0.1,
  sexual_minors: 0.2,
  violence: 0.3,
  violence_graphic: 0.4,
  harassment: 0.5,
  harassment_threatening: 0.6,
  hate: 0.7,
  hate_threatening: 0.8,
  spam: 0.9,
};

describe('parseOpenRouterModerationResponse', () => {
  it('maps every requested score to the existing moderation categories', () => {
    expect(parseOpenRouterModerationResponse({
      choices: [{ message: { content: JSON.stringify(scores) } }],
    })).toEqual({
      sexual: 0.1,
      'sexual/minors': 0.2,
      violence: 0.3,
      'violence/graphic': 0.4,
      harassment: 0.5,
      'harassment/threatening': 0.6,
      hate: 0.7,
      'hate/threatening': 0.8,
      spam: 0.9,
    });
  });

  it('rejects missing, malformed, and out-of-range model scores', () => {
    expect(() => parseOpenRouterModerationResponse({ choices: [] })).toThrow();
    expect(() => parseOpenRouterModerationResponse({
      choices: [{ message: { content: 'not json' } }],
    })).toThrow();
    expect(() => parseOpenRouterModerationResponse({
      choices: [{ message: { content: JSON.stringify({ ...scores, spam: 2 }) } }],
    })).toThrow();
  });
});
