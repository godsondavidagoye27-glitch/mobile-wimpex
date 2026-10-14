import {
  Blur,
  Canvas,
  Circle as SkiaCircle,
  Group,
  Paint,
  useCanvasSize,
} from '@shopify/react-native-skia';
import type { SharedValue } from 'react-native-reanimated';
import { StyleSheet } from 'react-native';
import { theme } from '../../theme/theme';
import { motion } from '../../theme/motion';

type SplashSkiaBackdropProps = {
  backdropOpacity: SharedValue<number>;
  goldGlowOpacity: SharedValue<number>;
};

export default function SplashSkiaBackdrop({
  backdropOpacity,
  goldGlowOpacity,
}: SplashSkiaBackdropProps) {
  const { ref: canvasRef, size: canvasSize } = useCanvasSize();
  return (
    <Canvas ref={canvasRef} style={StyleSheet.absoluteFill}>
      <Group layer={<Paint><Blur blur={motion.blur.blob} /></Paint>}>
        <SkiaCircle cx={canvasSize.width * 0.12} cy={canvasSize.height * 0.08} r={160} color={theme.colors.primary} opacity={backdropOpacity} />
        <SkiaCircle cx={canvasSize.width * 0.9} cy={canvasSize.height * 0.92} r={160} color={theme.colors.success} opacity={backdropOpacity} />
      </Group>
      <Group layer={<Paint><Blur blur={14} /></Paint>}>
        <SkiaCircle cx={canvasSize.width / 2} cy={canvasSize.height / 2 - 16} r={46} color={theme.colors.gold} opacity={goldGlowOpacity} />
      </Group>
    </Canvas>
  );
}
