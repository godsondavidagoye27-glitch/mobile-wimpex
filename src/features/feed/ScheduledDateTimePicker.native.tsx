import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerChangeEvent,
} from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { localDateTimeParts } from './scheduledPosts';
import type { ScheduledDateTimePickerProps } from './ScheduledDateTimePicker';
import { theme } from '../../theme/theme';

type PickerMode = 'date' | 'time';

function toLocalDate(date: string, time: string): Date {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!dateMatch || !timeMatch) return new Date(Date.now() + 60 * 60 * 1000);
  const [, year, month, day] = dateMatch;
  const [, hour, minute] = timeMatch;
  const result = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return Number.isFinite(result.getTime()) ? result : new Date(Date.now() + 60 * 60 * 1000);
}

function toLocalParts(value: Date) {
  return localDateTimeParts(value.toISOString());
}

export function ScheduledDateTimePicker({
  date,
  time,
  onDateChange,
  onTimeChange,
}: ScheduledDateTimePickerProps) {
  const [iosMode, setIosMode] = useState<PickerMode | null>(null);
  const [pickerRange, setPickerRange] = useState<{ minimumDate: Date; maximumDate: Date } | null>(null);
  const value = toLocalDate(date, time);

  function onValueChange(_event: DateTimePickerChangeEvent, selectedDate: Date) {
    const parts = toLocalParts(selectedDate);
    if (iosMode === 'date') onDateChange(parts.date);
    if (iosMode === 'time') onTimeChange(parts.time);
  }

  function openPicker(mode: PickerMode) {
    const minimumDate = new Date(Date.now() + 10 * 60 * 1000);
    const maximumDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    setPickerRange({ minimumDate, maximumDate });
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value,
        mode,
        is24Hour: true,
        minimumDate,
        maximumDate,
        onValueChange: (_event, selectedDate) => {
          const parts = toLocalParts(selectedDate);
          if (mode === 'date') onDateChange(parts.date);
          else onTimeChange(parts.time);
        },
      });
      return;
    }
    setIosMode(mode);
  }

  return (
    <>
      <View style={styles.row}>
        <Pressable onPress={() => openPicker('date')} style={styles.button} accessibilityRole="button">
          <Text style={styles.label}>Date</Text>
          <Text style={styles.value}>{date}</Text>
        </Pressable>
        <Pressable onPress={() => openPicker('time')} style={styles.button} accessibilityRole="button">
          <Text style={styles.label}>Time</Text>
          <Text style={styles.value}>{time}</Text>
        </Pressable>
      </View>
      {Platform.OS === 'ios' ? (
        <Modal visible={iosMode !== null} transparent animationType="slide" onRequestClose={() => setIosMode(null)}>
          <View style={styles.backdrop}>
            <View style={styles.sheet}>
              {iosMode ? (
                <DateTimePicker
                  value={value}
                  mode={iosMode}
                  display="spinner"
                  is24Hour
                  minimumDate={pickerRange?.minimumDate}
                  maximumDate={pickerRange?.maximumDate}
                  onValueChange={onValueChange}
                />
              ) : null}
              <Pressable onPress={() => setIosMode(null)} style={styles.doneButton} accessibilityRole="button">
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, paddingBottom: 10 },
  button: {
    flex: 1,
    minHeight: 52,
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.black,
  },
  label: { color: theme.colors.textMuted, fontSize: 11 },
  value: { color: theme.colors.white, fontSize: 14, fontWeight: '700' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: theme.colors.surface, padding: 16, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  doneButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary, borderRadius: 12 },
  doneText: { color: theme.colors.black, fontWeight: '800' },
});
