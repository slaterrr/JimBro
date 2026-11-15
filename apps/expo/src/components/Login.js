// First screen: create an account or sign in with email + password. No email confirmation:
// a new account goes straight to the first-run setup and Jim.
import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { PrimaryButton } from './kit.js';
import { R, T, type } from '../theme.js';

const input = { backgroundColor: T.surface, color: T.text, borderWidth: 1, borderColor: T.border, borderRadius: R.sm, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, marginTop: 6 };

export function Login({ auth, onSignedIn }) {
  const [mode, setMode] = useState('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = signup ? await auth.signUp(email, password) : await auth.signIn(email, password);
    setBusy(false);
    if (r.error) return setError(r.error);
    onSignedIn(r.email);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">
        <Image source={require('../../assets/jim-mascot.png')} accessibilityLabel="Jim, your AI gym bro" style={{ width: 140, height: 140, alignSelf: 'center' }} resizeMode="contain" />
        <Text style={[type.h1, { textAlign: 'center', marginTop: 12 }]}>{signup ? 'Meet Jim' : 'Welcome back'}</Text>
        <Text style={[type.body, { textAlign: 'center', marginTop: 6, marginBottom: 20 }]}>
          {signup ? 'Create your account and Jim will build your first plan with you.' : 'Sign in to pick up where you left off.'}
        </Text>
        <Text style={type.label}>Email</Text>
        <TextInput accessibilityLabel="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={T.textMute}
          autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" style={input} />
        <Text style={[type.label, { marginTop: 14 }]}>Password</Text>
        <TextInput accessibilityLabel="Password" value={password} onChangeText={setPassword} placeholder="At least 6 characters" placeholderTextColor={T.textMute}
          secureTextEntry autoCapitalize="none" autoComplete={signup ? 'new-password' : 'current-password'} textContentType={signup ? 'newPassword' : 'password'}
          onSubmitEditing={submit} returnKeyType="go" style={input} />
        {error ? <Text accessibilityLiveRegion="polite" style={{ color: T.red, marginTop: 10 }}>{error}</Text> : null}
        <PrimaryButton disabled={busy} onPress={submit}>{signup ? 'Create account' : 'Sign in'}</PrimaryButton>
        <TouchableOpacity accessibilityRole="button" onPress={() => { setMode(signup ? 'signin' : 'signup'); setError(null); }} style={{ minHeight: 44, justifyContent: 'center', marginTop: 8 }}>
          <Text style={{ color: T.accentText, textAlign: 'center', fontWeight: '600' }}>{signup ? 'I already have an account · Sign in' : 'New here? Create an account'}</Text>
        </TouchableOpacity>
        <Text style={[type.small, { textAlign: 'center', marginTop: 16 }]}>Your account and workouts stay on this phone.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
