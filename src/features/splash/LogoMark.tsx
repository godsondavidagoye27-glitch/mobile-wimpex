import { useEffect } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { theme } from '../../theme/theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export function LogoMark({ size = 120, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  const firstStroke = useSharedValue(140);
  const secondStroke = useSharedValue(140);

  useEffect(() => {
    firstStroke.value = withDelay(300, withTiming(0, { duration: 700, easing: Easing.out(Easing.cubic) }));
    secondStroke.value = withDelay(700, withTiming(0, { duration: 700, easing: Easing.out(Easing.cubic) }));
  }, [firstStroke, secondStroke]);

  const firstStrokeProps = useAnimatedProps(() => ({ strokeDashoffset: firstStroke.value }));
  const secondStrokeProps = useAnimatedProps(() => ({ strokeDashoffset: secondStroke.value }));

  return (
    <View style={style}>
      <Svg width={size} height={size * 0.8333} viewBox="0 0 120 100" fill="none">
        <AnimatedPath
          d="M14 14 L38 84 L62 28"
          stroke={theme.colors.primary}
          strokeWidth={12}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={[140, 300]}
          animatedProps={firstStrokeProps}
        />
        <AnimatedPath
          d="M58 28 L82 84 L106 14"
          stroke={theme.colors.success}
          strokeWidth={12}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={[140, 300]}
          animatedProps={secondStrokeProps}
        />
      </Svg>
    </View>
  );
}
