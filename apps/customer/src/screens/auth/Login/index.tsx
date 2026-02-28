import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { colors, spacing, radius, fontSize, fontWeight } from '../../../theme';
import { api } from '../../../config/api';
import { useAuthStore } from '../../../store/authStore';

export function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);

  const handleLogin = async () => {
    if (!phone || !password) {
      Alert.alert('Error', 'Please enter phone and password');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/api/auth/login', {
        phone: `+255${phone}`,
        password,
      });
      await login(res.data.data.token, res.data.data.user);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Text style={styles.logo}>📦</Text>
        <Text style={styles.title}>Welcome to Flexbox</Text>
        <Text style={styles.subtitle}>Sign in to continue</Text>
      </View>

      <View style={styles.form}>
        <View style={styles.phoneRow}>
          <View style={styles.countryCode}>
            <Text style={styles.countryText}>🇹🇿 +255</Text>
          </View>
          <TextInput
            style={styles.input}
            placeholder="712 345 678"
            placeholderTextColor={colors.text.placeholder}
            keyboardType="phone-pad"
            maxLength={9}
            value={phone}
            onChangeText={setPhone}
          />
        </View>

        <TextInput
          style={[styles.input, styles.passwordInput]}
          placeholder="Password"
          placeholderTextColor={colors.text.placeholder}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <TouchableOpacity
          style={[styles.btn, (!phone || !password || loading) && styles.btnDisabled]}
          onPress={handleLogin}
          disabled={!phone || !password || loading}
        >
          <Text style={styles.btnText}>
            {loading ? 'Signing in...' : 'Sign In'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  logo: { fontSize: 64, marginBottom: spacing.md },
  title: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.text.primary, textAlign: 'center' },
  subtitle: { fontSize: fontSize.md, color: colors.text.secondary, textAlign: 'center', marginTop: spacing.sm },
  form: { padding: spacing.xl, paddingBottom: spacing.xxl },
  phoneRow: { flexDirection: 'row', marginBottom: spacing.md, gap: spacing.sm },
  countryCode: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, justifyContent: 'center',
  },
  countryText: { fontSize: fontSize.md, color: colors.text.primary },
  input: {
    flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: fontSize.md,
    color: colors.text.primary, height: 56,
  },
  passwordInput: { flex: 0, marginBottom: spacing.md },
  btn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    height: 56, alignItems: 'center', justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: colors.text.inverse, fontSize: fontSize.md, fontWeight: fontWeight.bold },
});
