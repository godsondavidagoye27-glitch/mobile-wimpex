import { router, Tabs } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '../../components/Icon';
import { theme } from '../../theme/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarStyle: {
          backgroundColor: theme.colors.black,
          borderTopColor: theme.colors.line,
          borderTopWidth: 1,
          height: 78,
          paddingTop: 8,
          paddingBottom: 10,
        },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '700',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <Icon name="home" size={20} color={String(focused ? theme.colors.primary : color)} filled={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarIcon: ({ color, focused }) => (
            <Icon name="chats" size={20} color={String(focused ? theme.colors.primary : color)} filled={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Create',
          tabBarLabel: () => null,
          tabBarButton: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Create"
              style={styles.fabWrap}
              onPress={() => router.push('/(tabs)/create')}
            >
              <View style={styles.fab}>
                <Icon name="plus" size={24} color={theme.colors.white} />
              </View>
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="groups"
        options={{
          title: 'Groups',
          tabBarIcon: ({ color, focused }) => (
            <Icon name="groups" size={20} color={String(focused ? theme.colors.primary : color)} filled={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="live"
        options={{
          title: 'Live',
          tabBarIcon: ({ color, focused }) => (
            <Icon name="live" size={20} color={String(focused ? theme.colors.primary : color)} filled={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  fabWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -20,
  },
  fab: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadows.soft,
  },
});
