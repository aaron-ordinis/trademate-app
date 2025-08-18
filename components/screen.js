import React from "react";
import { SafeAreaView } from "react-native-safe-area-context";

export default function Screen({ children, edges = ['top','left','right','bottom'], style }) {
  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: '#0b0b0c' }, style]}>
      {children}
    </SafeAreaView>
  );
}