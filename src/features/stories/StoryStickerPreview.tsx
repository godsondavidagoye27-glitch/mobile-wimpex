import { Canvas, RoundedRect, useCanvasSize } from '@shopify/react-native-skia';
import { useMemo, useRef } from 'react';
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Icon } from '../../components/Icon';
import { theme } from '../../theme/theme';
import { normalizedStickerPosition } from './storyStickerLogic';

export type StoryStickerDraft = {
  kind: 'poll' | 'question';
  prompt: string;
  optionOne: string;
  optionTwo: string;
  positionX: number;
  positionY: number;
  scale: number;
};

type Props = {
  sticker: StoryStickerDraft;
  onChange: (sticker: StoryStickerDraft) => void;
};

const cardWidth = 240;
const cardHeight = 124;

export function StoryStickerPreview({ sticker, onChange }: Props) {
  const { ref: canvasRef, size } = useCanvasSize();
  const positionRef = useRef({ x: sticker.positionX, y: sticker.positionY });
  const stickerRef = useRef(sticker);
  const onChangeRef = useRef(onChange);
  positionRef.current = { x: sticker.positionX, y: sticker.positionY };
  stickerRef.current = sticker;
  onChangeRef.current = onChange;

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) + Math.abs(gesture.dy) > 4,
    onPanResponderGrant: () => {
      positionRef.current = {
        x: stickerRef.current.positionX,
        y: stickerRef.current.positionY,
      };
    },
    onPanResponderMove: (_event, gesture) => {
      const current = stickerRef.current;
      if (!size.width || !size.height) return;
      const halfWidth = Math.min(0.49, (cardWidth * current.scale) / (2 * size.width));
      const halfHeight = Math.min(0.49, (cardHeight * current.scale) / (2 * size.height));
      onChangeRef.current({
        ...current,
        positionX: normalizedStickerPosition(positionRef.current.x + gesture.dx / size.width, halfWidth, 1 - halfWidth),
        positionY: normalizedStickerPosition(positionRef.current.y + gesture.dy / size.height, halfHeight, 1 - halfHeight),
      });
    },
  }), [size.height, size.width]);
  const rect = {
    x: sticker.positionX * size.width - (cardWidth * sticker.scale) / 2,
    y: sticker.positionY * size.height - (cardHeight * sticker.scale) / 2,
    width: cardWidth * sticker.scale,
    height: cardHeight * sticker.scale,
  };

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Canvas ref={canvasRef} style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
        <RoundedRect {...rect} r={18 * sticker.scale} color="#101827" opacity={0.96} />
        <RoundedRect
          x={rect.x + 1}
          y={rect.y + 1}
          width={Math.max(0, rect.width - 2)}
          height={Math.max(0, rect.height - 2)}
          r={17 * sticker.scale}
          color="transparent"
          style="stroke"
          strokeWidth={1}
          opacity={0.8}
        />
      </Canvas>
      <View
        {...panResponder.panHandlers}
        style={[
          styles.sticker,
          {
            width: cardWidth * sticker.scale,
            height: cardHeight * sticker.scale,
            left: rect.x,
            top: rect.y,
          },
        ]}
      >
        <Text numberOfLines={2} style={styles.prompt}>{sticker.prompt || 'Your question'}</Text>
        {sticker.kind === 'poll' ? (
          <View style={styles.options}>
            <Text numberOfLines={1} style={styles.option}>{sticker.optionOne || 'Option 1'}</Text>
            <Text numberOfLines={1} style={styles.option}>{sticker.optionTwo || 'Option 2'}</Text>
          </View>
        ) : (
          <Text style={styles.answerHint}>Tap to answer</Text>
        )}
        <View style={styles.dragHint}>
          <Icon name="more" size={20} color={theme.colors.textMuted} />
        </View>
      </View>
    </View>
  );
}

export function StickerSizeControls({
  scale,
  onChange,
}: {
  scale: number;
  onChange: (scale: number) => void;
}) {
  return (
    <View style={styles.sizeControls}>
      <Text style={styles.sizeLabel}>Sticker size</Text>
      <Pressable
        onPress={() => onChange(Math.max(0.7, Math.round((scale - 0.1) * 100) / 100))}
        accessibilityRole="button"
        accessibilityLabel="Make sticker smaller"
        style={styles.sizeButton}
      >
        <Text style={styles.sizeButtonText}>−</Text>
      </Pressable>
      <Text style={styles.sizeValue}>{Math.round(scale * 100)}%</Text>
      <Pressable
        onPress={() => onChange(Math.min(1.5, Math.round((scale + 0.1) * 100) / 100))}
        accessibilityRole="button"
        accessibilityLabel="Make sticker larger"
        style={styles.sizeButton}
      >
        <Text style={styles.sizeButtonText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sticker: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  prompt: {
    color: theme.colors.white,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 9,
  },
  options: { width: '100%', flexDirection: 'row', gap: 8 },
  option: {
    flex: 1,
    color: theme.colors.white,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.48)',
    borderRadius: 9,
    paddingVertical: 7,
    paddingHorizontal: 4,
  },
  answerHint: { color: theme.colors.primary, fontSize: 12, fontWeight: '700' },
  dragHint: { position: 'absolute', top: 4, right: 4, opacity: 0.8 },
  sizeControls: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
  sizeLabel: { flex: 1, color: theme.colors.textMuted, fontSize: 13, fontWeight: '600' },
  sizeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.line,
  },
  sizeButtonText: { color: theme.colors.white, fontSize: 20, fontWeight: '700' },
  sizeValue: { width: 48, color: theme.colors.white, textAlign: 'center', fontSize: 12, fontWeight: '700' },
});
