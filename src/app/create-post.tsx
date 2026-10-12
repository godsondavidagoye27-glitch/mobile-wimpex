import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '../components/Icon';
import { theme } from '../theme/theme';

export default function CreatePostScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text style={styles.title}>Create post</Text>
        <Pressable style={styles.postButton} accessibilityRole="button" accessibilityLabel="Share post">
          <Text style={styles.postButtonText}>Post</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.mediaBox}>
          <View style={styles.mediaHeader}>
            <Text style={styles.sectionLabel}>Media</Text>
            <Pressable style={styles.cameraButton} accessibilityRole="button" accessibilityLabel="Choose media">
              <Icon name="camera" size={20} color={theme.colors.primary} />
            </Pressable>
          </View>
          <View style={styles.preview}>
            <Text style={styles.previewText}>Select a video or image</Text>
          </View>
        </View>

        <View style={styles.fieldCard}>
          <Text style={styles.fieldLabel}>Caption</Text>
          <TextInput multiline placeholder="Write a caption" placeholderTextColor={theme.colors.textMuted} style={styles.input} />
        </View>

        <View style={styles.rowItem}>
          <Text style={styles.rowLabel}>Add people</Text>
          <Icon name="chevronRight" size={20} color={theme.colors.textMuted} />
        </View>
        <View style={styles.rowItem}>
          <Text style={styles.rowLabel}>Location</Text>
          <Icon name="mapPin" size={20} color={theme.colors.textMuted} />
        </View>
        <View style={styles.rowItem}>
          <Text style={styles.rowLabel}>Audience</Text>
          <Text style={styles.metaValue}>Everyone</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#171C22',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.line,
  },
  title: { color: theme.colors.white, fontSize: 20, fontWeight: '800' },
  postButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  postButtonText: { color: theme.colors.black, fontWeight: '800' },
  content: { paddingHorizontal: 18, paddingBottom: 32 },
  mediaBox: { marginBottom: 16 },
  mediaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionLabel: { color: theme.colors.white, fontSize: 16, fontWeight: '700' },
  cameraButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#111418',
    borderWidth: 1,
    borderColor: theme.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preview: {
    minHeight: 180,
    borderRadius: 18,
    backgroundColor: '#111418',
    borderWidth: 1,
    borderColor: theme.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewText: { color: theme.colors.textMuted },
  fieldCard: {
    backgroundColor: '#111418',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.line,
    padding: 12,
    marginBottom: 12,
  },
  fieldLabel: { color: theme.colors.white, fontWeight: '700', marginBottom: 8 },
  input: {
    minHeight: 90,
    color: theme.colors.white,
    textAlignVertical: 'top',
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.line,
  },
  rowLabel: { color: theme.colors.white, fontWeight: '600' },
  metaValue: { color: theme.colors.textMuted },
});
