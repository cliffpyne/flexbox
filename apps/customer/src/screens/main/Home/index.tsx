import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, SafeAreaView,
} from 'react-native';
import { colors, spacing, radius, fontSize, fontWeight } from '../../../theme';
import { useAuthStore } from '../../../store/authStore';

export function HomeScreen({ navigation }: any) {
  const user = useAuthStore((s) => s.user);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Good morning 👋</Text>
            <Text style={styles.name}>{user?.name || 'Customer'}</Text>
          </View>
          <TouchableOpacity
            style={styles.profileBtn}
            onPress={() => navigation.navigate('Profile')}
          >
            <Text style={styles.profileIcon}>👤</Text>
          </TouchableOpacity>
        </View>

        {/* Send Parcel CTA */}
        <TouchableOpacity
          style={styles.ctaCard}
          onPress={() => navigation.navigate('SendParcel')}
        >
          <Text style={styles.ctaEmoji}>📦</Text>
          <View style={styles.ctaText}>
            <Text style={styles.ctaTitle}>Send a Parcel</Text>
            <Text style={styles.ctaSubtitle}>Fast & reliable delivery across Tanzania</Text>
          </View>
          <Text style={styles.ctaArrow}>→</Text>
        </TouchableOpacity>

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.quickActions}>
            {[
              { emoji: '📍', label: 'Track Parcel', screen: 'Tracking' },
              { emoji: '📋', label: 'My Parcels', screen: 'ParcelList' },
              { emoji: '💳', label: 'Payments', screen: 'ParcelList' },
              { emoji: '⚙️', label: 'Settings', screen: 'Profile' },
            ].map((action) => (
              <TouchableOpacity
                key={action.label}
                style={styles.quickAction}
                onPress={() => navigation.navigate(action.screen)}
              >
                <Text style={styles.quickEmoji}>{action.emoji}</Text>
                <Text style={styles.quickLabel}>{action.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Recent Parcels */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Parcels</Text>
            <TouchableOpacity onPress={() => navigation.navigate('ParcelList')}>
              <Text style={styles.seeAll}>See all</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>📭</Text>
            <Text style={styles.emptyText}>No parcels yet</Text>
            <Text style={styles.emptySubtext}>Send your first parcel today!</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', padding: spacing.xl, paddingBottom: spacing.md,
  },
  greeting: { fontSize: fontSize.sm, color: colors.text.secondary },
  name: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text.primary },
  profileBtn: {
    width: 44, height: 44, borderRadius: radius.full,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  profileIcon: { fontSize: 20 },
  ctaCard: {
    margin: spacing.xl, marginTop: spacing.sm,
    backgroundColor: colors.primary, borderRadius: radius.lg,
    padding: spacing.lg, flexDirection: 'row', alignItems: 'center',
  },
  ctaEmoji: { fontSize: 40, marginRight: spacing.md },
  ctaText: { flex: 1 },
  ctaTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: '#fff' },
  ctaSubtitle: { fontSize: fontSize.sm, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  ctaArrow: { fontSize: 24, color: '#fff' },
  section: { paddingHorizontal: spacing.xl, marginBottom: spacing.lg },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text.primary, marginBottom: spacing.md },
  seeAll: { fontSize: fontSize.sm, color: colors.primary, fontWeight: fontWeight.medium },
  quickActions: { flexDirection: 'row', gap: spacing.sm },
  quickAction: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border,
  },
  quickEmoji: { fontSize: 28, marginBottom: spacing.xs },
  quickLabel: { fontSize: fontSize.xs, color: colors.text.secondary, textAlign: 'center', fontWeight: fontWeight.medium },
  emptyState: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyEmoji: { fontSize: 48, marginBottom: spacing.md },
  emptyText: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.text.primary },
  emptySubtext: { fontSize: fontSize.sm, color: colors.text.secondary, marginTop: spacing.xs },
});
