import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, SafeAreaView, StyleSheet, Text, View,
} from 'react-native';
import { Drive, DriveFile } from './src/api/drive';
import { signInWithPasskey } from './src/auth/passkey';
import { coreStatus, signOut } from './src/core';

const C = { bg: '#0a0f0b', fg: '#f2f7f2', muted: '#7a857b', accent: '#35d353', line: '#1a231c', err: '#ff6b6b' };
const MONO = 'monospace';

type Screen = { name: 'signin' } | { name: 'files' } | { name: 'file'; file: DriveFile };

export default function App() {
  const [drive, setDrive] = useState<Drive | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'signin' });

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />
      {screen.name === 'signin' || !drive ? (
        <SignIn onIn={(w) => { setDrive(new Drive(w)); setScreen({ name: 'files' }); }} />
      ) : screen.name === 'files' ? (
        <Files
          drive={drive}
          onOpen={(file) => setScreen({ name: 'file', file })}
          onOut={() => { signOut(); setDrive(null); setScreen({ name: 'signin' }); }}
        />
      ) : (
        <FileView drive={drive} file={screen.file} onBack={() => setScreen({ name: 'files' })} />
      )}
    </SafeAreaView>
  );
}

function SignIn({ onIn }: { onIn: (wallet: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const core = coreStatus();
  const go = async () => {
    setBusy(true);
    setErr('');
    try {
      onIn(await signInWithPasskey());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={s.center} testID="signin">
      <Text style={s.brand}>untrace</Text>
      <Text style={s.line}>Your files, encrypted on this phone.</Text>
      <Button label={busy ? 'Waiting for passkey' : 'Sign in with passkey'} onPress={go} disabled={busy || !core.linked} />
      {err ? <Text style={s.err}>{err}</Text> : null}
      <Text style={s.label}>{core.linked ? `CORE ${core.version}` : 'CORE NOT LINKED'}</Text>
    </View>
  );
}

function Files({ drive, onOpen, onOut }: { drive: Drive; onOpen: (f: DriveFile) => void; onOut: () => void }) {
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      setFiles(await drive.list());
    } catch (e) {
      setErr((e as Error).message);
      setFiles((f) => f ?? []);
    }
  }, [drive]);

  useEffect(() => { load(); }, [load]);

  const upload = async () => {
    setErr('');
    const pick = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (pick.canceled || !pick.assets?.length) return;
    const a = pick.assets[0];
    try {
      setStatus('reading');
      const plain = await new File(a.uri).bytes();
      await drive.upload(a.name, a.mimeType ?? 'application/octet-stream', plain, setStatus);
      setStatus('');
      await load();
    } catch (e) {
      setStatus('');
      setErr((e as Error).message);
    }
  };

  return (
    <View style={s.fill}>
      <View style={s.header}>
        <Text style={s.label}>FILES</Text>
        <Pressable onPress={onOut}><Text style={s.label}>SIGN OUT</Text></Pressable>
      </View>
      <Text style={[s.label, s.pad]} numberOfLines={1}>{drive.wallet}</Text>
      {files === null ? (
        <ActivityIndicator color={C.accent} style={s.pad} />
      ) : (
        <FlatList
          data={files}
          keyExtractor={(f) => f.file_id}
          onRefresh={load}
          refreshing={false}
          ListEmptyComponent={<Text style={[s.muted, s.pad]}>No files yet.</Text>}
          renderItem={({ item }) => (
            <Pressable style={s.row} onPress={() => onOpen(item)}>
              <Text style={s.name} numberOfLines={1}>{item.name}</Text>
              <Text style={s.label}>{size(item.size)}</Text>
            </Pressable>
          )}
        />
      )}
      {err ? <Text style={[s.err, s.pad]}>{err}</Text> : null}
      <View style={s.pad}>
        <Button label={status ? status.toUpperCase() : 'Upload a file'} onPress={upload} disabled={!!status} />
      </View>
    </View>
  );
}

function FileView({ drive, file, onBack }: { drive: Drive; file: DriveFile; onBack: () => void }) {
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const download = async () => {
    setErr('');
    try {
      setStatus('starting');
      const { name, mime, plain } = await drive.download(file.file_id, setStatus);
      const dir = new Directory(Paths.cache, 'untrace');
      if (!dir.exists) dir.create();
      const out = new File(dir, name.replace(/[/\\]/g, '_') || 'file');
      if (out.exists) out.delete();
      out.write(plain);
      setStatus('');
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(out.uri, { mimeType: mime });
    } catch (e) {
      setStatus('');
      setErr((e as Error).message);
    }
  };
  return (
    <View style={s.fill}>
      <View style={s.header}>
        <Pressable onPress={onBack}><Text style={s.label}>BACK</Text></Pressable>
      </View>
      <View style={s.pad}>
        <Text style={s.title}>{file.name}</Text>
        <Text style={s.label}>{size(file.size)} · {file.mime}</Text>
        <Text style={[s.muted, s.gap]}>Rebuilt and decrypted on this phone.</Text>
        <Button label={status ? status.toUpperCase() : 'Download'} onPress={download} disabled={!!status} />
        {err ? <Text style={s.err}>{err}</Text> : null}
      </View>
    </View>
  );
}

function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[s.button, disabled && { opacity: 0.5 }]}>
      <Text style={s.buttonText}>{label}</Text>
    </Pressable>
  );
}

function size(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  brand: { color: C.accent, fontSize: 34, letterSpacing: 2 },
  line: { color: C.fg, fontSize: 16, textAlign: 'center' },
  title: { color: C.fg, fontSize: 20, marginBottom: 6 },
  label: { color: C.muted, fontSize: 12, fontFamily: MONO, letterSpacing: 1 },
  muted: { color: C.muted, fontSize: 14 },
  err: { color: C.err, fontSize: 13, textAlign: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderColor: C.line },
  pad: { padding: 16 },
  gap: { marginVertical: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderColor: C.line, gap: 12 },
  name: { color: C.fg, fontSize: 15, flex: 1 },
  button: { backgroundColor: C.accent, borderRadius: 8, paddingVertical: 14, paddingHorizontal: 24, alignItems: 'center', alignSelf: 'stretch' },
  buttonText: { color: C.bg, fontSize: 15, fontWeight: '600', fontFamily: MONO },
});
