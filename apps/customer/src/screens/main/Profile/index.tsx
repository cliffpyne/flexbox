import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  SafeAreaView, TouchableOpacity, Alert, Switch,
} from 'react-native';
import { colors, spacing, radius, fontSize, fontWeight } from '../../../theme';
import { useAuthStore } from '../../../store/authStore';

export function ProfileScreen() {
  const { user, logout } = useAuthStore();
  const [notifications, setNotifications] = useState(true);
  const [smsAlerts, setSmsAlerts] = useState(true);

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: logout },
    ]);
  };

  const MenuItem = ({ emoji, label, value, onPress, danger }: any) => (
    <TouchableOpacity style={styles.menuItem} onPress={onPress}>
      <Text style={styles.menuEmoji}>{emoji}</Text>
      <Text style={[styles.menuLabel, danger && styles.menuLabelDanger]}>{label}</Text>
      {value ? <Text style={styles.menuValue}>{value}</Text> : <Text style={styles.menuArrow}>›</Text>}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user?.name?.charAt(0) || 'C'}
            </Text>
          </View>
          <Text style={styles.name}>{user?.name || 'Customer'}</Text>
          <Text style={styles.phone}>{user?.phone || '+255 712 345 678'}</Text>
          <TouchableOpacity style={styles.editBtn}>
            <Text style={styles.editBtnText}>✏️ Edit Profile</Text>
          </TouchableOpacity>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          {[
            { label: 'Parcels', value: '12' },
            { label: 'Delivered', value: '10' },
            { label: 'Spent', value: 'TZS 45K' },
          ].map((stat) => (
            <View key={stat.label} style={styles.stat}>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* Account */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.menuCard}>
            <MenuItem emoji="👤" label="Personal Info" />
            <MenuItem emoji="📍" label="Saved Addresses" />
            <MenuItem emoji="💳" label="Payment Methods" />
            <MenuItem emoji="🧾" label="Transaction History" />
          </View>
        </View>

        {/* Notifications */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notifications</Text>
          <View style={styles.menuCard}>
            <View style={styles.menuItem}>
              <Text style={styles.menuEmoji}>🔔</Text>
              <Text style={styles.menuLabel}>Push Notifications</Text>
              <Switch
                value={notifications}
                onValueChange={setNotifications}
                trackColor={{ true: colors.primary }}
              />
            </View>
            <View style={styles.menuItem}>
              <Text style={styles.menuEmoji}>💬</Text>
              <Text style={styles.menuLabel}>SMS Alerts</Text>
              <Switch
                value={smsAlerts}
                onValueChange={setSmsAlerts}
                trackColor={{ true: colors.primary }}
              />
            </View>
          </View>
        </View>

        {/* Support */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Support</Text>
          <View style={styles.menuCard}>
            <MenuItem emoji="❓" label="Help Center" />
            <MenuItem emoji="💬" label="Chat Support" />
            <MenuItem emoji="⭐" label="Rate App" />
            <MenuItem emoji="📋" label="Terms & Privacy" />
          </View>
        </View>

        {/* Logout */}
        <View style={styles.section}>
          <View style={styles.menuCard}>
            <MenuItem emoji="🚪" label="Logout" onPress={handleLogout} danger />
          </View>
        </View>

        <Text style={styles.version}>Flexbox v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  profileHeader: { alignItems: 'center', padding: spacing.xl, paddingBottom: spacing.lg },
  avatar: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md,
  },
  avatarText: { fontSize: 32, fontWeight: fontWeight.bold, color: '#fff' },
  name: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text.primary },
  phone: { fontSize: fontSize.md, color: colors.text.secondary, marginTop: 4 },
  editBtn: {
    marginTop: spacing.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full,
  },
  editBtnText: { fontSize: fontSize.sm, color: colors.text.primary, fontWeight: fontWeight.medium },
  statsRow: {
    flexDirection: 'row', marginHorizontal: spacing.xl, marginBottom: spacing.lg,
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.primary },
  statLabel: { fontSize: fontSize.xs, color: colors.text.secondary, marginTop: 4 },
  section: { paddingHorizontal: spacing.xl, marginBottom: spacing.lg },
  sectionTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text.secondary, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 1 },
  menuCard: { backgroundColor: '#fff', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  menuItem: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  menuEmoji: { fontSize: 20, marginRight: spacing.md, width: 28 },
  menuLabel: { flex: 1, fontSize: fontSize.md, color: colors.text.primary },
  menuLabelDanger: { color: colors.error },
  menuValue: { fontSize: fontSize.sm, color: colors.text.secondary },
  menuArrow: { fontSize: fontSize.lg, color: colors.text.secondary },
  version: { textAlign: 'center', color: colors.text.secondary, fontSize: fontSize.xs, padding: spacing.xl },
});
