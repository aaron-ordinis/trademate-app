import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform
} from 'react-native';
import { ArrowLeft, Info } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

// Theme constants
const BRAND = '#2a86ff';
const TEXT = '#0b1220';
const MUTED = '#6b7280';
const CARD = '#ffffff';
const BORDER = '#e6e9ee';
const OK = '#16a34a';
const DISABLED = '#9ca3af';

export function SharedCard({ children, style = {} }) {
  return (
    <View style={[styles.card, style]}>
      {children}
    </View>
  );
}

export function SectionHeader({ 
  title, 
  tooltip, 
  onTooltipPress, 
  showTooltip = false 
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {tooltip && (
          <TouchableOpacity 
            style={styles.infoBtn}
            onPress={onTooltipPress}
          >
            <Info size={16} color={MUTED} />
          </TouchableOpacity>
        )}
      </View>
      {showTooltip && tooltip && (
        <View style={styles.tooltip}>
          <Text style={styles.tooltipText}>{tooltip}</Text>
        </View>
      )}
    </View>
  );
}

export function SharedHeader({ 
  title, 
  onBack, 
  rightComponent 
}) {
  return (
    <View style={styles.header}>
      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <ArrowLeft size={20} color={TEXT} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.headerRight}>
        {rightComponent || <View style={{ width: 40 }} />}
      </View>
    </View>
  );
}

export function BottomActionBar({ 
  leftButton, 
  rightButton, 
  disabled = false 
}) {
  const insets = useSafeAreaInsets();
  
  return (
    <View style={[styles.actionBar, { paddingBottom: insets.bottom }]}>
      {leftButton && (
        <TouchableOpacity
          style={[styles.actionBtn, styles.secondaryActionBtn]}
          onPress={() => {
            Haptics.selectionAsync();
            leftButton.onPress();
          }}
          disabled={disabled || leftButton.disabled}
        >
          <Text style={styles.actionBtnText}>{leftButton.title}</Text>
        </TouchableOpacity>
      )}
      
      {rightButton && (
        <TouchableOpacity
          style={[styles.actionBtn, styles.primaryActionBtn, (disabled || rightButton.disabled) && { opacity: 0.55 }]}
          onPress={() => {
            Haptics.selectionAsync();
            rightButton.onPress();
          }}
          disabled={disabled || rightButton.disabled}
        >
          <Text style={[styles.actionBtnText, { color: "#fff" }]}>{rightButton.title}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#0b1220',
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 3 },
    }),
  },
  
  sectionHeader: {
    marginBottom: 16,
  },
  
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: TEXT,
  },
  
  infoBtn: {
    marginLeft: 8,
    padding: 4,
  },
  
  tooltip: {
    marginTop: 8,
    padding: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  
  tooltipText: {
    fontSize: 14,
    color: MUTED,
    lineHeight: 18,
  },
  
  header: {
    backgroundColor: CARD,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  
  headerTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: TEXT,
  },
  
  headerRight: {
    width: 40,
    alignItems: 'flex-end',
  },
  
  actionBar: {
    backgroundColor: CARD,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingHorizontal: 16,
    paddingTop: 12,
    flexDirection: "row",
    gap: 12,
    ...Platform.select({
      ios: {
        shadowColor: "#0b1220",
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: -4 },
      },
      android: {
        elevation: 8,
      },
    }),
  },
  
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  
  primaryActionBtn: {
    backgroundColor: OK,
    borderColor: OK,
  },
  
  secondaryActionBtn: {
    backgroundColor: "#f8fafc",
  },
  
  actionBtnText: {
    fontSize: 15,
    fontWeight: "900",
    color: TEXT,
  },
});
