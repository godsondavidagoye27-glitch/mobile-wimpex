import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useVerifiedMap } from '../features/badges/verifiedMap';
import { VerifiedBadge, type VerifiedBadgeSize } from './VerifiedBadge';

export function NameWithBadge({
  name,
  userId,
  verified,
  size = 'sm',
  textStyle,
  style,
  numberOfLines = 1,
}: {
  name: string;
  userId?: string | null;
  verified?: boolean;
  size?: VerifiedBadgeSize;
  textStyle?: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
  numberOfLines?: number;
}) {
  const { data } = useVerifiedMap(userId ? [userId] : []);
  const isVerified = verified ?? (userId ? data?.[userId] === true : false);

  return (
    <View style={[styles.row, style]}>
      <Text numberOfLines={numberOfLines} ellipsizeMode="tail" style={[styles.name, textStyle]}>
        {name}
      </Text>
      {isVerified ? <VerifiedBadge size={size} style={styles.badge} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  name: { flexShrink: 1, minWidth: 0 },
  badge: { marginLeft: 4 },
});
