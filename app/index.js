// MUST be first for Android stability
import 'react-native-gesture-handler';
import 'react-native-reanimated';

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { supabase } from '../lib/supabase';

export default function Index() {
  const [href, setHref] = useState(null); // JS: no TypeScript generics here

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setHref(session ? '/(app)/quotes/list' : '/(auth)/login');
    })();
  }, []);

  if (!href) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0b0b0c' }}>
        <ActivityIndicator color="#9aa0a6" />
      </View>
    );
  }

  return <Redirect href={href} />;
}