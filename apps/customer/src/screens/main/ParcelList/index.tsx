import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList,
  SafeAreaView, TouchableOpacity,
} from 'react-native';
import { colors, spacing, radius, fontSize, fontWeight } from '../../../theme';

const DUMMY_PARCELS = [
  { id: 'FBX-2024-001', recipient: 'Ahmed Hassan', address: 'Mikocheni, DSM', status: 'in_transit', date: 'Today 10:00 AM', price: 'TZS 5,500' },
  { id: 'FBX-2024-002', recipient: 'Mary Joseph', address: 'Kinondoni, DSM', status: 'delivered', date: 'Yesterday 3:00 PM', price: 'TZS 3,000' },
  { id: 'FBX-2024-003', recipient: 'Peter Kimani', address: 'Ilala, DSM', status: 'pending', date: 'Dec 20, 9:00 AM', price: 'TZS 8,000' },
  { id: 'FBX-2024-004', recipient: 'Fatuma Ali', address: 'Temeke, DSM', status: 'delivered', date: 'Dec 19, 2:00 PM', price: 'TZS 5,000' },
  { id: 'FBX-2024-005', recipient: 'John Mwangi', address: 'Ubungo, DSM', status: 'failed', date: 'Dec 18, 11:00 AM', price: 'TZS 3,000' },
];

const STATUS_CONFIG: any = {
  pending:    { label: 'Pending',    bg: '#FEF3C7', text: '#D97706', emoji: '⏳' },
  confirmed:  { label: 'Confirmed',  bg: '#DBEAFE', text: '#1E3A8A', emoji: '✅' },
  in_transit: { label: 'In Transit', bg: '#FEF3C7', text: '#D97706', emoji: '🚀' },
  delivered:  { label: 'Delivered',  bg: '#D1FAE5', text: '#065F46', emoji: '✅' },
  failed:     { label: 'Failed',     bg: '#FEE2E2', text: '#991B1B', emoji: '❌' },
};

const TABS = ['All', 'Active', 'Delivered', 'Failed'];

export function ParcelListScreen({ navigation }: any) {
  const [activeTab, setActiveTab] = useState('All');

  const filtered = DUMMY_PARCELS.filter((p) => {
    if (activeTab === 'All') return true;
    if (activeTab === 'Active') return ['pending', 'confirmed', 'in_transit'].includes(p.status);
    if (activeTab === 'Delivered') return p.status === 'delivered';
    if (activeTab === 'Failed') return p.status === 'failed';
    return true;
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Parcels</Text>
        <TouchableOpacity
          style={styles.newBtn}
          onPress={() => navigation.navigate('SendParcel')}
        >
          <Text style={styles.newBtnText}>+ New</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => {
          const config = STATUS_CONFIG[item.status];
          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() => navigation.navigate('Tracking')}
            >
              <View style={styles.cardTop}>
                <View>
                  <Text style={styles.cardId}>{item.id}</Text>
                  <Text style={styles.cardRecipient}>To: {item.recipient}</Text>
                  <Text style={styles.cardAddress}>{item.address}</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: config.bg }]}>
                  <Text style={[styles.badgeText, { color: config.text }]}>
                    {config.emoji} {config.label}
                  </Text>
                </View>
              </View>
              <View style={styles.cardBottom}>
                <Text style={styles.cardDate}>{item.date}</Text>
                <Text style={styles.cardPrice}>{item.price}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📭</Text>
            <Text style={styles.emptyText}>No parcels found</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: spacing.xl, paddingBottom: spacing.md,
  },
  title: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.text.primary },
  newBtn: {
    backgroundColor: colors.primary, paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm, borderRadius: radius.md,
  },
  newBtnText: { color: '#fff', fontWeight: fontWeight.bold, fontSize: fontSize.sm },
  tabs: { flexDirection: 'row', paddingHorizontal: spacing.lg, marginBottom: spacing.md, gap: spacing.sm },
  tab: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, backgroundColor: colors.surface,
  },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: fontSize.sm, color: colors.text.secondary, fontWeight: fontWeight.medium },
  tabTextActive: { color: '#fff' },
  list: { padding: spacing.lg, gap: spacing.md },
  card: {
    backgroundColor: '#fff', borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  cardId: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary },
  cardRecipient: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text.primary, marginTop: 2 },
  cardAddress: { fontSize: fontSize.sm, color: colors.text.secondary, marginTop: 2 },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.full, alignSelf: 'flex-start' },
  badgeText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  cardDate: { fontSize: fontSize.sm, color: colors.text.secondary },
  cardPrice: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.text.primary },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyEmoji: { fontSize: 48, marginBottom: spacing.md },
  emptyText: { fontSize: fontSize.lg, color: colors.text.secondary },
});
