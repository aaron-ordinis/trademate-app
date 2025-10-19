// app/(admin)/boss.js
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList } from 'react-native';

export default function BossChat() {
  const [text, setText] = useState('');
  const [msgs, setMsgs] = useState([
    { id: 'sys1', role: 'system', content: 'Boss ready. Ask me to plan Marketing or Support work.' },
  ]);

  const send = async () => {
    if (!text.trim()) return;
    const userMsg = { id: Date.now().toString(), role: 'user', content: text.trim() };
    setMsgs((m) => [userMsg, ...m]);
    setText('');
    // TODO: call your Edge Function to plan/dispatch jobs
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#EEF2F6', padding: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '900', marginBottom: 8 }}>Boss</Text>
      <FlatList
        inverted
        data={msgs}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => (
          <View style={{ marginVertical: 6 }}>
            <Text style={{ fontWeight: '800' }}>{item.role === 'user' ? 'You' : 'Boss'}</Text>
            <Text>{item.content}</Text>
          </View>
        )}
      />
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <TextInput
          placeholder="Tell Boss what to do…"
          value={text}
          onChangeText={setText}
          style={{ flex: 1, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#e6e9ee' }}
        />
        <Pressable onPress={send} style={{ backgroundColor: '#2a86ff', borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '900' }}>Send</Text>
        </Pressable>
      </View>
    </View>
  );
}