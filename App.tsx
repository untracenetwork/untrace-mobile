import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { coreStatus } from './src/core';

export default function App() {
  const core = coreStatus();
  return (
    <View style={styles.container}>
      <Text style={styles.brand}>untrace</Text>
      <Text style={styles.line}>Your files, encrypted on this phone.</Text>
      <Text style={styles.muted}>
        {core.linked ? `core ${core.version}` : 'core: not linked (starter build)'}
      </Text>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0f0b', alignItems: 'center', justifyContent: 'center', padding: 24 },
  brand: { color: '#35d353', fontSize: 34, letterSpacing: 2, marginBottom: 12 },
  line: { color: '#f2f7f2', fontSize: 16, textAlign: 'center', marginBottom: 8 },
  muted: { color: '#7a857b', fontSize: 12, fontFamily: 'monospace' },
});
