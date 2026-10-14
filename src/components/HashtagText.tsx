import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Text, type TextStyle } from 'react-native';
import { theme } from '../theme/theme';

const hashtagPattern = /#([a-zA-Z0-9_]+)/g;

export function HashtagText({
  text,
  style,
}: {
  text: string;
  style?: TextStyle;
}) {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(hashtagPattern)) {
    const start = match.index;
    const tag = match[1];
    if (start === undefined || tag === undefined) continue;
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <Text
        key={`${start}:${tag}`}
        style={styles.hashtag}
        onPress={() => router.push({ pathname: '/hashtag/[tag]', params: { tag } })}
        accessibilityRole="link"
      >
        {match[0]}
      </Text>,
    );
    cursor = start + match[0].length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));

  return <Text style={style}>{parts}</Text>;
}

const styles = {
  hashtag: { color: theme.colors.primary, fontWeight: '700' as const },
};
