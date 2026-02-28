import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert,
} from 'react-native';
import { colors, spacing, radius, fontSize, fontWeight } from '../../../theme';
import { api } from '../../../config/api';
import { useAuthStore } from '../../../store/authStore';

export function OtpScreen({ navigation, route }: any) {
  const { phone } = route.params;
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const inputs = useRef<TextInput[]>([]);
  const login = useAuthStore((s) => s.login);

  const handleChange = (val: string, idx: number) => {
    const newOtp = [...otp];
    newOtp[idx] = val;
    setOtp(newOtp);
    if (val && idx < 5) inputs.current[idx + 1]?.focus();
  };

  const handleVerify = async () => {
    const code = otp.join('');
    if (code.length < 6) return;
    setLoading(true);
    try {
      const res = await api.post('/api/auth/verify-otp', { phone, otp: code });
      await login(res.data.token, res.data.user);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Invalid OTP');
      setOtp(['', '', '', '', '', '']);
      inputs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.content}>
        <Text style={styles.title}>Enter OTP</Text>
        <Text style={styles.subtitle}>
          We sent a 6-digit code to{'\n'}{phone}
        </Text>

        <View style={styles.otpRow}>
          {otp.map((digit, idx) => (
            <TextInput
              key={idx}
              ref={(r) => { if (r) inputs.current[idx] = r; }}
              style={[styles.otpBox, digit && styles.otpBoxFilled]}
              maxLength={1}
              keyboardType="numeric"
              value={digit}
              onChangeText={(val) => handleChange(val, idx)}
              onKeyPress={({ nativeEvent }) => {
                if (nativeEvent.key === 'Backspace' && !otp[idx] && idx > 0) {
                  inputs.current[idx - 1]?.focus();
                }
              }}
            />
          ))}
        </View>

        <TouchableOpacity
          style={[styles.btn, (otp.join('').length < 6 || loading) && styles.btnDisabled]}
          onPress={handleVerify}
          disabled={otp.join('').length < 6 || loading}
        >
          <Text style={styles.btnText}>{loading ? 'Verifying...' : 'Verify OTP'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.resend}>
          <Text style={styles.resendText}>Didn't receive code? <Text style={styles.resendLink}>Resend</Text></Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  back: { padding: spacing.xl, paddingBottom: 0, marginTop: spacing.lg },
  backText: { fontSize: fontSize.md, color: colors.primary, fontWeight: fontWeight.medium },
  content: { flex: 1, padding: spacing.xl, justifyContent: 'center' },
  title: { fontSize: fontSize.xxxl, fontWeight: fontWeight.bold, color: colors.text.primary },
  subtitle: {
    fontSize: fontSize.md, color: colors.text.secondary,
    marginTop: spacing.sm, marginBottom: spacing.xl, lineHeight: 24,
  },
  otpRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  otpBox: {
    flex: 1, height: 56, borderWidth: 2, borderColor: colors.border,
    borderRadius: radius.md, textAlign: 'center', fontSize: fontSize.xl,
    color: colors.text.primary, fontWeight: fontWeight.bold,
  },
  otpBoxFilled: { borderColor: colors.primary },
  btn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    height: 56, alignItems: 'center', justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: colors.text.inverse, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  resend: { marginTop: spacing.lg, alignItems: 'center' },
  resendText: { fontSize: fontSize.sm, color: colors.text.secondary },
  resendLink: { color: colors.primary, fontWeight: fontWeight.semibold },
});
