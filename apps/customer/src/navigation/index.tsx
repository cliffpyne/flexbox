import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { SplashScreen } from '../screens/auth/Splash';
import { LoginScreen } from '../screens/auth/Login';
import { HomeScreen } from '../screens/main/Home';
import { SendParcelScreen } from '../screens/main/SendParcel';
import { TrackingScreen } from '../screens/main/Tracking';
import { ParcelListScreen } from '../screens/main/ParcelList';
import { ProfileScreen } from '../screens/main/Profile';
import { colors } from '../theme';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.text.secondary,
        tabBarStyle: { borderTopColor: colors.border },
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen}
        options={{ tabBarIcon: ({ color }) => <Text style={{ fontSize: 22, color }}>🏠</Text>, tabBarLabel: 'Home' }} />
      <Tab.Screen name="ParcelList" component={ParcelListScreen}
        options={{ tabBarIcon: ({ color }) => <Text style={{ fontSize: 22, color }}>📋</Text>, tabBarLabel: 'My Parcels' }} />
      <Tab.Screen name="Tracking" component={TrackingScreen}
        options={{ tabBarIcon: ({ color }) => <Text style={{ fontSize: 22, color }}>📍</Text>, tabBarLabel: 'Track' }} />
      <Tab.Screen name="Profile" component={ProfileScreen}
        options={{ tabBarIcon: ({ color }) => <Text style={{ fontSize: 22, color }}>👤</Text>, tabBarLabel: 'Profile' }} />
      <Tab.Screen name="SendParcel" component={SendParcelScreen}
        options={{ tabBarButton: () => null, tabBarLabel: '' }} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const { isLoggedIn, isHydrated } = useAuthStore();
  if (!isHydrated) return <SplashScreen />;
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isLoggedIn
          ? <Stack.Screen name="Main" component={MainTabs} />
          : <Stack.Screen name="Login" component={LoginScreen} />
        }
      </Stack.Navigator>
    </NavigationContainer>
  );
}
