import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AuthState {
  token: string | null;
  user: any | null;
  isLoggedIn: boolean;
  login: (token: string, user: any) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isLoggedIn: false,

  login: async (token, user) => {
    await AsyncStorage.setItem('auth_token', token);
    await AsyncStorage.setItem('user', JSON.stringify(user));
    set({ token, user, isLoggedIn: true });
  },

  logout: async () => {
    await AsyncStorage.removeItem('auth_token');
    await AsyncStorage.removeItem('user');
    set({ token: null, user: null, isLoggedIn: false });
  },

  hydrate: async () => {
    const token = await AsyncStorage.getItem('auth_token');
    const user = await AsyncStorage.getItem('user');
    if (token && user) {
      set({ token, user: JSON.parse(user), isLoggedIn: true });
    }
  },
}));
