import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../../../theme/theme';

export function Field({ label }: { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    height: 56,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: theme.colors.line,
    backgroundColor: '#14181D',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  label: {
    color: theme.colors.textMuted,
    fontSize: 17,
  },
});
