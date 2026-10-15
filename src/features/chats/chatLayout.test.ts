import { describe, expect, it } from 'vitest';
import {
  calculateChatComposerHeight,
  calculateChatKeyboardInset,
  calculateMinimumChatListHeight,
} from './chatLayout';

describe('chat layout helpers', () => {
  it('keeps the composer between its single-line and five-line heights', () => {
    expect(calculateChatComposerHeight(24)).toBe(44);
    expect(calculateChatComposerHeight(96)).toBe(96);
    expect(calculateChatComposerHeight(160)).toBe(120);
  });

  it('uses the larger of the keyboard and bottom safe-area insets', () => {
    expect(calculateChatKeyboardInset(0, 24)).toBe(24);
    expect(calculateChatKeyboardInset(280, 24)).toBe(280);
    expect(calculateChatKeyboardInset(0, 0)).toBe(0);
  });

  it('keeps at least 120 dp for the message list', () => {
    expect(calculateMinimumChatListHeight(80)).toBe(120);
    expect(calculateMinimumChatListHeight(240)).toBe(240);
  });
});
