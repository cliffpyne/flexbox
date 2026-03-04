import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet,
  SafeAreaView, TouchableOpacity, Dimensions,
} from 'react-native';
import { colors, spacing, radius, fontSize, fontWeight } from '../../../theme';

const { width, height } = Dimensions.get('window');

export function TrackingScreen({ navigation }: any) {
  const [dots, setDots] = useState('');
  const [riderPos, setRiderPos] = useState({ x: 0.3, y: 0.5 });

  useEffect(() => {
    const dotsInterval = setInterval(() => {
      setDots((d) => d.length >= 3 ? '' : d + '.');
    }, 500);
    const moveInterval = setInterval(() => {
      setRiderPos((pos) => ({
        x: Math.min(0.75, pos.x + 0.008),
        y: 0.5 + Math.sin(Date.now() / 2000) * 0.05,
      }));
    }, 800);
    return () => { clearInterval(dotsInterval); clearInterval(moveInterval); };
  }, []);

  return (
    <View style={styles.container}>
      {/* FAKE MAP */}
      <View style={styles.map}>
        {/* Grid lines */}
        {[...Array(10)].map((_, i) => (
          <View key={`h${i}`} style={[styles.gridH, { top: `${i * 12}%` }]} />
        ))}
        {[...Array(8)].map((_, i) => (
          <View key={`v${i}`} style={[styles.gridV, { left: `${i * 15}%` }]} />
        ))}

        {/* Roads */}
        <View style={[styles.road, { top: '52%', left: 0, right: 0, height: 14 }]} />
        <View style={[styles.road, { left: '42%', top: 0, bottom: 0, width: 14 }]} />
        <View style={[styles.road, { top: '30%', left: 0, right: 0, height: 10, transform: [{ rotate: '-8deg' }] }]} />
        <View style={[styles.road, { top: '70%', left: 0, right: 0, height: 8 }]} />

        {/* Route dotted line */}
        <View style={styles.routeLine} />

        {/* Pickup */}
        <View style={[styles.pinContainer, { left: '12%', top: '44%' }]}>
          <View style={[styles.pin, { backgroundColor: '#EFF6FF', borderColor: colors.primary }]}>
            <Text style={styles.pinEmoji}>📦</Text>
          </View>
          <Text style={styles.pinLabel}>Pickup</Text>
        </View>

        {/* Delivery */}
        <View style={[styles.pinContainer, { left: '75%', top: '28%' }]}>
          <View style={[styles.pin, { backgroundColor: '#D1FAE5', borderColor: colors.success }]}>
            <Text style={styles.pinEmoji}>🏠</Text>
          </View>
          <Text style={styles.pinLabel}>Delivery</Text>
        </View>

        {/* Rider — MOVING */}
        <View style={[styles.pinContainer, {
          left: `${riderPos.x * 100}%`,
          top: `${riderPos.y * 100}%`,
        }]}>
          <View style={styles.riderPulseOuter} />
          <View style={styles.riderPulseInner} />
          <View style={[styles.pin, { backgroundColor: colors.secondary, borderColor: '#fff', borderWidth: 3 }]}>
            <Text style={styles.pinEmoji}>🛵</Text>
          </View>
        </View>

        {/* Top bar */}
        <SafeAreaView style={styles.topBar}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
          <View style={styles.idBadge}>
            <Text style={styles.idText}>📍 FBX-2024-001</Text>
          </View>
          <View style={{ width: 44 }} />
        </SafeAreaView>

        <Text style={styles.mapLabel}>Dar es Salaam, Tanzania</Text>
      </View>

      {/* BOTTOM SHEET */}
      <View style={styles.sheet}>
        <View style={styles.handle} />

        {/* Rider row */}
        <View style={styles.riderRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>J</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.riderName}>John Mwenda</Text>
            <Text style={styles.riderSub}>🟢 On the way{dots}</Text>
          </View>
          <TouchableOpacity style={styles.actionBtn}>
            <Text style={styles.actionEmoji}>📞</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn}>
            <Text style={styles.actionEmoji}>💬</Text>
          </TouchableOpacity>
        </View>

        {/* ETA row */}
        <View style={styles.etaRow}>
          {[
            { val: '2.3 km', label: 'Distance' },
            { val: '~12 min', label: 'ETA' },
            { val: 'Transit', label: 'Status' },
          ].map((item, i) => (
            <React.Fragment key={i}>
              {i > 0 && <View style={styles.divider} />}
              <View style={styles.etaItem}>
                <Text style={styles.etaVal}>{item.val}</Text>
                <Text style={styles.etaLabel}>{item.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>

        {/* Progress */}
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: '60%' }]} />
        </View>
        <View style={styles.progressLabels}>
          <Text style={styles.progressLabel}>📦 Picked up</Text>
          <Text style={styles.progressLabel}>🛵 In transit</Text>
          <Text style={styles.progressLabel}>🏠 Delivered</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1, backgroundColor: '#E8F0E9', overflow: 'hidden', position: 'relative' },
  gridH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#C8D8C9' },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#C8D8C9' },
  road: { position: 'absolute', backgroundColor: '#fff', opacity: 0.85 },
  routeLine: {
    position: 'absolute', left: '14%', top: '46%',
    width: '63%', height: 5, backgroundColor: colors.primary,
    borderRadius: 3, opacity: 0.85,
  },
  pinContainer: { position: 'absolute', alignItems: 'center', transform: [{ translateX: -22 }, { translateY: -22 }] },
  pin: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25, shadowRadius: 6, elevation: 6,
  },
  pinEmoji: { fontSize: 22 },
  pinLabel: {
    fontSize: 10, fontWeight: fontWeight.bold, color: '#333',
    backgroundColor: '#fff', paddingHorizontal: 5, paddingVertical: 2,
    borderRadius: 4, marginTop: 3,
  },
  riderPulseOuter: {
    position: 'absolute', width: 70, height: 70, borderRadius: 35,
    borderWidth: 2, borderColor: colors.secondary, opacity: 0.2,
    top: -13, left: -13,
  },
  riderPulseInner: {
    position: 'absolute', width: 56, height: 56, borderRadius: 28,
    borderWidth: 2, borderColor: colors.secondary, opacity: 0.35,
    top: -6, left: -6,
  },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg,
  },
  backBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2, shadowRadius: 4, elevation: 4,
  },
  backText: { fontSize: 20, color: colors.text.primary },
  idBadge: {
    backgroundColor: '#fff', paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm, borderRadius: radius.full,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 4, elevation: 4,
  },
  idText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary },
  mapLabel: {
    position: 'absolute', bottom: spacing.sm, right: spacing.sm,
    fontSize: 10, color: '#555', backgroundColor: 'rgba(255,255,255,0.75)',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.xl, paddingBottom: spacing.xxl,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 8,
  },
  handle: {
    width: 40, height: 4, backgroundColor: colors.border,
    borderRadius: 2, alignSelf: 'center', marginBottom: spacing.lg,
  },
  riderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 20, fontWeight: fontWeight.bold, color: '#fff' },
  riderName: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text.primary },
  riderSub: { fontSize: fontSize.sm, color: colors.text.secondary, marginTop: 2 },
  actionBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  actionEmoji: { fontSize: 20 },
  etaRow: {
    flexDirection: 'row', backgroundColor: colors.surface,
    borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg,
  },
  etaItem: { flex: 1, alignItems: 'center' },
  etaVal: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text.primary },
  etaLabel: { fontSize: fontSize.xs, color: colors.text.secondary, marginTop: 2 },
  divider: { width: 1, backgroundColor: colors.border },
  progressBar: {
    backgroundColor: colors.surface, borderRadius: radius.full,
    height: 8, marginBottom: spacing.sm,
  },
  progressFill: { backgroundColor: colors.primary, height: 8, borderRadius: radius.full },
  progressLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  progressLabel: { fontSize: fontSize.xs, color: colors.text.secondary },
});
