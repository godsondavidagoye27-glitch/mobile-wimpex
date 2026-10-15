import { describe, expect, it } from 'vitest';
import { calculateKeyboardLayout } from './keyboardLayout';

describe('calculateKeyboardLayout', () => {
  it('preserves the full container when the keyboard is closed', () => {
    expect(calculateKeyboardLayout(640, 24, 0)).toEqual({
      bottomInset: 0,
      availableHeight: 640,
    });
  });

  it('reserves the larger of the keyboard and navigation-bar insets', () => {
    expect(calculateKeyboardLayout(640, 24, 290)).toEqual({
      bottomInset: 290,
      availableHeight: 350,
    });
    expect(calculateKeyboardLayout(640, 32, 24)).toEqual({
      bottomInset: 32,
      availableHeight: 608,
    });
  });

  it('never returns a negative available height', () => {
    expect(calculateKeyboardLayout(240, 24, 320)).toEqual({
      bottomInset: 320,
      availableHeight: 0,
    });
  });
});
