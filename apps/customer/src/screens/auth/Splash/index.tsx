import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useAuthStore } from '../../../store/authStore';
import { colors, fontSize, fontWeight } from '../../../theme';

export function SplashScreen() {
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>📦</Text>
      <Text style={styles.title}>Flexbox</Text>
      <Text style={styles.subtitle}>Delivering Tanzania</Text>
      <ActivityIndicator style={styles.loader} color={colors.primary} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { fontSize: 64, marginBottom: 16 },
  title: {
    fontSize: 40,
    fontWeight: fontWeight.bold,
    color: colors.text.inverse,
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 8,
  },
  loader: { marginTop: 48 },
});
