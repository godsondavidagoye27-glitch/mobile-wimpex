import { useId } from 'react';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { theme } from '../theme/theme';
import { verifiedBadgeSizes, type VerifiedBadgeSize } from './verifiedBadgeSize';

export type { VerifiedBadgeSize } from './verifiedBadgeSize';

export function VerifiedBadge({
  size = 'sm',
  style,
}: {
  size?: VerifiedBadgeSize;
  style?: StyleProp<ViewStyle>;
}) {
  const gradientId = `verifiedGold-${useId().replace(/:/g, '')}`;
  const diameter = verifiedBadgeSizes[size];
  const strokeWidth = Math.max(0.75, diameter * 0.085);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Verified"
      style={[styles.badge, { width: diameter, height: diameter }, style]}
    >
      <Svg width={diameter} height={diameter} viewBox="0 0 24 24" accessible={false}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.colors.verifiedGoldLight} />
            <Stop offset="0.55" stopColor={theme.colors.verifiedGold} />
            <Stop offset="1" stopColor={theme.colors.verifiedGoldDark} />
          </LinearGradient>
        </Defs>
        <Circle cx="12" cy="12" r="11" fill={`url(#${gradientId})`} stroke={theme.colors.verifiedGoldRim} strokeWidth="1" />
        <Path
          d="M5.5 7.2 8 17l4-7 4 7 2.5-9.8"
          fill="none"
          stroke={theme.colors.verifiedText}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
});
