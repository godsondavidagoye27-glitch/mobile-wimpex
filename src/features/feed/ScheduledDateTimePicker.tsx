import { FocusableTextInput } from '../../components/AuthField';
import { theme } from '../../theme/theme';
import { StyleSheet, View } from 'react-native';

export type ScheduledDateTimePickerProps = {
  date: string;
  time: string;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
};

export function ScheduledDateTimePicker({
  date,
  time,
  onDateChange,
  onTimeChange,
}: ScheduledDateTimePickerProps) {
  return (
    <View style={styles.inputs}>
      <FocusableTextInput
        accessibilityLabel="Scheduled date, year-month-day"
        value={date}
        onChangeText={onDateChange}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={theme.colors.textMuted}
        keyboardType="numbers-and-punctuation"
        style={styles.input}
      />
      <FocusableTextInput
        accessibilityLabel="Scheduled time, 24-hour local time"
        value={time}
        onChangeText={onTimeChange}
        placeholder="HH:MM"
        placeholderTextColor={theme.colors.textMuted}
        keyboardType="numbers-and-punctuation"
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  inputs: { flexDirection: 'row', gap: 10, paddingBottom: 10 },
  input: {
    flex: 1,
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.black,
    paddingHorizontal: 12,
    color: theme.colors.white,
  },
});
