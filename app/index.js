// app/index.js
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { supabase } from '../lib/supabase';

export default function Index() {
  const [href, setHref] = useState(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setHref(session ? '/(app)/quotes/list' : '/(auth)/login');
    })();
  }, []);

  if (!href) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0b0b0c' }}>
        <ActivityIndicator />
      </View>
    );
  }
  return <Redirect href={href} />;
}