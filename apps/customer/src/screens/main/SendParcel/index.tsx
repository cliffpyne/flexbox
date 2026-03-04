import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, SafeAreaView, Alert,
} from 'react-native';
import { colors, spacing, radius, fontSize, fontWeight } from '../../../theme';

export function SendParcelScreen({ navigation }: any) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    pickupAddress: '', deliveryAddress: '',
    recipientName: '', recipientPhone: '',
    parcelSize: '', parcelDescription: '',
  });

  const handleNext = () => {
    if (step < 3) setStep(step + 1);
    else {
      Alert.alert('🎉 Order Placed!', 'Your parcel has been booked. Tracking ID: FBX-2024-001', [
        { text: 'Track Parcel', onPress: () => navigation.navigate('Tracking') },
      ]);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => step > 1 ? setStep(step - 1) : navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Send Parcel</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Progress */}
      <View style={styles.progress}>
        {[1, 2, 3].map((s) => (
          <View key={s} style={styles.progressRow}>
            <View style={[styles.progressDot, step >= s && styles.progressDotActive]}>
              <Text style={[styles.progressNum, step >= s && styles.progressNumActive]}>{s}</Text>
            </View>
            {s < 3 && <View style={[styles.progressLine, step > s && styles.progressLineActive]} />}
          </View>
        ))}
      </View>
      <View style={styles.progressLabels}>
        <Text style={styles.progressLabel}>Pickup</Text>
        <Text style={styles.progressLabel}>Delivery</Text>
        <Text style={styles.progressLabel}>Details</Text>
      </View>

      <ScrollView style={styles.form} showsVerticalScrollIndicator={false}>
        {step === 1 && (
          <View>
            <Text style={styles.stepTitle}>📍 Pickup Location</Text>
            <Text style={styles.label}>Pickup Address</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Kariakoo Market, Dar es Salaam"
              placeholderTextColor={colors.text.placeholder}
              value={form.pickupAddress}
              onChangeText={(v) => setForm({ ...form, pickupAddress: v })}
            />
            <Text style={styles.label}>Sender Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Your full name"
              placeholderTextColor={colors.text.placeholder}
            />
            <Text style={styles.label}>Sender Phone</Text>
            <TextInput
              style={styles.input}
              placeholder="+255 7XX XXX XXX"
              placeholderTextColor={colors.text.placeholder}
              keyboardType="phone-pad"
            />
            <View style={styles.mapPlaceholder}>
              <Text style={styles.mapEmoji}>🗺️</Text>
              <Text style={styles.mapText}>Map view coming soon</Text>
            </View>
          </View>
        )}

        {step === 2 && (
          <View>
            <Text style={styles.stepTitle}>🏠 Delivery Location</Text>
            <Text style={styles.label}>Delivery Address</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Mikocheni, Dar es Salaam"
              placeholderTextColor={colors.text.placeholder}
              value={form.deliveryAddress}
              onChangeText={(v) => setForm({ ...form, deliveryAddress: v })}
            />
            <Text style={styles.label}>Recipient Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Recipient full name"
              placeholderTextColor={colors.text.placeholder}
              value={form.recipientName}
              onChangeText={(v) => setForm({ ...form, recipientName: v })}
            />
            <Text style={styles.label}>Recipient Phone</Text>
            <TextInput
              style={styles.input}
              placeholder="+255 7XX XXX XXX"
              placeholderTextColor={colors.text.placeholder}
              keyboardType="phone-pad"
              value={form.recipientPhone}
              onChangeText={(v) => setForm({ ...form, recipientPhone: v })}
            />
          </View>
        )}

        {step === 3 && (
          <View>
            <Text style={styles.stepTitle}>📦 Parcel Details</Text>
            <Text style={styles.label}>Parcel Size</Text>
            <View style={styles.sizeRow}>
              {['Small', 'Medium', 'Large'].map((size) => (
                <TouchableOpacity
                  key={size}
                  style={[styles.sizeBtn, form.parcelSize === size && styles.sizeBtnActive]}
                  onPress={() => setForm({ ...form, parcelSize: size })}
                >
                  <Text style={styles.sizeEmoji}>
                    {size === 'Small' ? '📱' : size === 'Medium' ? '📦' : '🛒'}
                  </Text>
                  <Text style={[styles.sizeText, form.parcelSize === size && styles.sizeTextActive]}>
                    {size}
                  </Text>
                  <Text style={styles.sizePrice}>
                    {size === 'Small' ? 'TZS 3,000' : size === 'Medium' ? 'TZS 5,000' : 'TZS 8,000'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              placeholder="What are you sending? (optional)"
              placeholderTextColor={colors.text.placeholder}
              multiline
              numberOfLines={3}
              value={form.parcelDescription}
              onChangeText={(v) => setForm({ ...form, parcelDescription: v })}
            />

            {/* Price Summary */}
            <View style={styles.summary}>
              <Text style={styles.summaryTitle}>Order Summary</Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Delivery fee</Text>
                <Text style={styles.summaryValue}>TZS 5,000</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Insurance</Text>
                <Text style={styles.summaryValue}>TZS 500</Text>
              </View>
              <View style={[styles.summaryRow, styles.summaryTotal]}>
                <Text style={styles.summaryTotalLabel}>Total</Text>
                <Text style={styles.summaryTotalValue}>TZS 5,500</Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.btn} onPress={handleNext}>
          <Text style={styles.btnText}>
            {step === 3 ? '✅ Place Order' : 'Continue →'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: spacing.lg, paddingTop: spacing.xl,
  },
  back: { fontSize: fontSize.md, color: colors.primary, fontWeight: fontWeight.medium },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text.primary },
  progress: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  progressRow: { flexDirection: 'row', alignItems: 'center' },
  progressDot: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface,
    borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  progressDotActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  progressNum: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.text.secondary },
  progressNumActive: { color: '#fff' },
  progressLine: { width: 60, height: 2, backgroundColor: colors.border },
  progressLineActive: { backgroundColor: colors.primary },
  progressLabels: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingHorizontal: spacing.lg, marginTop: spacing.xs, marginBottom: spacing.md,
  },
  progressLabel: { fontSize: fontSize.xs, color: colors.text.secondary },
  form: { flex: 1, padding: spacing.xl },
  stepTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text.primary, marginBottom: spacing.lg },
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text.secondary, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: fontSize.md,
    color: colors.text.primary, height: 52, marginBottom: spacing.md,
  },
  textarea: { height: 80, paddingTop: spacing.sm, textAlignVertical: 'top' },
  mapPlaceholder: {
    backgroundColor: colors.surface, borderRadius: radius.md, height: 150,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
  },
  mapEmoji: { fontSize: 40 },
  mapText: { fontSize: fontSize.sm, color: colors.text.secondary, marginTop: spacing.sm },
  sizeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  sizeBtn: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', borderWidth: 2, borderColor: colors.border,
  },
  sizeBtnActive: { borderColor: colors.primary, backgroundColor: '#EFF6FF' },
  sizeEmoji: { fontSize: 28, marginBottom: spacing.xs },
  sizeText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text.secondary },
  sizeTextActive: { color: colors.primary },
  sizePrice: { fontSize: fontSize.xs, color: colors.text.secondary, marginTop: 2 },
  summary: {
    backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.lg, marginTop: spacing.md,
  },
  summaryTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text.primary, marginBottom: spacing.md },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  summaryLabel: { fontSize: fontSize.sm, color: colors.text.secondary },
  summaryValue: { fontSize: fontSize.sm, color: colors.text.primary },
  summaryTotal: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.xs },
  summaryTotalLabel: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text.primary },
  summaryTotalValue: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.primary },
  footer: { padding: spacing.xl, paddingBottom: spacing.xxl },
  btn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    height: 56, alignItems: 'center', justifyContent: 'center',
  },
  btnText: { color: '#fff', fontSize: fontSize.md, fontWeight: fontWeight.bold },
});
