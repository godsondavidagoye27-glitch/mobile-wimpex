import React from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { theme } from '../../theme';

export function LogoMark({ size = 120, style }: { size?: number; style?: any }) {
  return (
    <View style={style}>
      <Svg width={size} height={size * 0.8333} viewBox="0 0 120 100" fill="none">
        <Path d="M14 14 L38 84 L62 28" stroke={theme.colors.sky} strokeWidth={12} strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M58 28 L82 84 L106 14" stroke={theme.colors.green} strokeWidth={12} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}
