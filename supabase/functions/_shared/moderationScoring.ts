export type ModerationCategory = 'nudity' | 'violence' | 'spam' | 'abuse';

export type ModerationScores = {
  sexual?: number;
  'sexual/minors'?: number;
  violence?: number;
  'violence/graphic'?: number;
  harassment?: number;
  'harassment/threatening'?: number;
  hate?: number;
  'hate/threatening'?: number;
  spam?: number;
};

export type ModerationFlag = {
  category: ModerationCategory;
  score: number;
  highConfidence: boolean;
};

export function classifyModeration(scores: ModerationScores): ModerationFlag[] {
  const candidates: [ModerationCategory, number][] = [
    ['nudity', Math.max(scores.sexual ?? 0, scores['sexual/minors'] ?? 0)],
    ['violence', Math.max(scores.violence ?? 0, scores['violence/graphic'] ?? 0)],
    ['abuse', Math.max(
      scores.harassment ?? 0,
      scores['harassment/threatening'] ?? 0,
      scores.hate ?? 0,
      scores['hate/threatening'] ?? 0,
    )],
    ['spam', scores.spam ?? 0],
  ];
  return candidates
    .filter(([, score]) => score >= 0.5)
    .map(([category, score]) => ({ category, score, highConfidence: score >= 0.85 }));
}
