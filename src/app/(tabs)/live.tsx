import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../../theme/theme';

export default function LiveScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Live</Text>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {[
          { id: 'l1', title: 'City rooftop jam', viewers: '2.8k', gradient: ['#38BDF8', '#22C55E'] },
          { id: 'l2', title: 'Open studio session', viewers: '1.3k', gradient: ['#FFD700', '#38BDF8'] },
          { id: 'l3', title: 'Co-working walkthrough', viewers: '740', gradient: ['#0EA5E9', '#4ADE80'] },
        ].map((item) => (
          <LinearGradient key={item.id} colors={item.gradient as [string, string]} style={styles.card}>
            <Text style={styles.liveLabel}>Live</Text>
            <Text style={styles.titleText}>{item.title}</Text>
            <Text style={styles.meta}>{item.viewers} watching</Text>
          </LinearGradient>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.black,
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    color: theme.colors.white,
    fontSize: 28,
    fontWeight: '800',
  },
  list: {
    paddingHorizontal: 18,
    paddingBottom: 90,
    gap: 14,
  },
  card: {
    height: 180,
    borderRadius: 22,
    padding: 18,
    justifyContent: 'flex-end',
  },
  liveLabel: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(239,68,68,0.9)',
    color: theme.colors.white,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    fontSize: 10,
    fontWeight: '800',
    marginBottom: 10,
  },
  titleText: {
    color: theme.colors.white,
    fontSize: 22,
    fontWeight: '700',
  },
  meta: {
    color: theme.colors.white,
    opacity: 0.9,
    fontSize: 13,
    marginTop: 4,
  },
});
