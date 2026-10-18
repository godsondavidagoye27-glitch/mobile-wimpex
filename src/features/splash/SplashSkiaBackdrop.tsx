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
};

export default function SplashSkiaBackdrop({ backdropOpacity }: SplashSkiaBackdropProps) {
  const { ref: canvasRef, size: canvasSize } = useCanvasSize();
  return (
    <Canvas ref={canvasRef} style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      <Group layer={<Paint><Blur blur={motion.blur.blob} /></Paint>}>
        <SkiaCircle cx={canvasSize.width * 0.12} cy={canvasSize.height * 0.08} r={160} color={theme.colors.primary} opacity={backdropOpacity} />
        <SkiaCircle cx={canvasSize.width * 0.9} cy={canvasSize.height * 0.92} r={160} color={theme.colors.success} opacity={backdropOpacity} />
      </Group>
    </Canvas>
  );
}

export function SplashLogoGlow({ opacity }: { opacity: SharedValue<number> }) {
  const { ref: canvasRef, size: canvasSize } = useCanvasSize();

  return (
    <Canvas ref={canvasRef} style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      <Group layer={<Paint><Blur blur={20} /></Paint>}>
        <SkiaCircle
          cx={canvasSize.width / 2}
          cy={canvasSize.height * 0.76}
          r={38}
          color={theme.colors.gold}
          opacity={opacity}
        />
      </Group>
    </Canvas>
  );
}
