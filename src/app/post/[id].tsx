import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'react-native';
import { theme } from '../../theme/theme';

export default function PostDetailScreen() {
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Image
          source={{ uri: 'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=900&q=80' }}
          style={styles.image}
        />

        <View style={styles.authorRow}>
          <Link href="/user?username=mila" asChild>
            <Pressable style={styles.avatar} accessibilityRole="button" accessibilityLabel="Open profile">
              <Text style={styles.avatarText}>A</Text>
            </Pressable>
          </Link>
          <View style={styles.authorMeta}>
            <Link href="/user?username=mila" asChild>
              <Pressable>
                <Text style={styles.name}>Ari</Text>
                <Text style={styles.handle}>@ari</Text>
              </Pressable>
            </Link>
          </View>
          <Pressable style={styles.followButton} accessibilityRole="button">
            <Text style={styles.followText}>Follow</Text>
          </Pressable>
        </View>

        <Text style={styles.caption}>Sunrise skate session before the city wakes up.</Text>
        <Text style={styles.hashtags}>#sunrise #skate #citylights</Text>

        <View style={styles.metricRow}>
          <Text style={styles.metric}>1.8k likes</Text>
          <Text style={styles.metric}>292 comments</Text>
          <Text style={styles.metric}>97 saved</Text>
        </View>

        <View style={styles.commentList}>
          {['Love this energy', 'The frame is perfect.', 'Need this location details'].map((comment, index) => (
            <View key={comment} style={styles.commentRow}>
              <Link href="/user?username=mila" asChild>
                <Pressable style={styles.commentAvatar} accessibilityRole="button" accessibilityLabel="Open commenter profile">
                  <Text style={styles.commentAvatarText}>{String.fromCharCode(65 + index)}</Text>
                </Pressable>
              </Link>
              <View style={styles.commentBody}>
                <Link href="/user?username=mila" asChild>
                  <Pressable>
                    <Text style={styles.commentName}>{['Mila', 'Noah', 'Rae'][index]}</Text>
                  </Pressable>
                </Link>
                <Text style={styles.commentText}>{comment}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.inputBar}>
        <TextInput placeholder="Write a comment" placeholderTextColor={theme.colors.textMuted} style={styles.input} />
        <Pressable style={styles.sendButton} accessibilityRole="button">
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.black,
  },
  content: {
    paddingBottom: 90,
  },
  image: {
    width: '100%',
    height: 420,
  },
  authorRow: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#1D3557',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: theme.colors.white,
    fontWeight: '700',
  },
  authorMeta: {
    flex: 1,
    marginLeft: 12,
  },
  name: {
    color: theme.colors.white,
    fontWeight: '700',
    fontSize: 16,
  },
  handle: {
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  followButton: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
  },
  followText: {
    color: theme.colors.black,
    fontWeight: '800',
  },
  caption: {
    color: theme.colors.white,
    fontSize: 17,
    paddingHorizontal: 18,
    marginTop: 8,
  },
  hashtags: {
    color: theme.colors.primary,
    fontSize: 14,
    paddingHorizontal: 18,
    marginTop: 8,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
  },
  metric: {
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  commentList: {
    paddingHorizontal: 18,
    paddingTop: 20,
    gap: 16,
  },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  commentAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#17212B',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  commentAvatarText: {
    color: theme.colors.white,
    fontWeight: '700',
  },
  commentBody: {
    flex: 1,
  },
  commentName: {
    color: theme.colors.white,
    fontWeight: '700',
    marginBottom: 4,
  },
  commentText: {
    color: theme.colors.textMuted,
    lineHeight: 20,
  },
  inputBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#111418',
    borderTopWidth: 1,
    borderTopColor: theme.colors.line,
    flexDirection: 'row',
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: '#171C22',
    borderRadius: 18,
    minHeight: 44,
    paddingHorizontal: 14,
    color: theme.colors.white,
  },
  sendButton: {
    marginLeft: 12,
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
  },
  sendText: {
    color: theme.colors.black,
    fontWeight: '800',
  },
});
