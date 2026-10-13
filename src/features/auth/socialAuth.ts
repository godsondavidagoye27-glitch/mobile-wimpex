import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { getSupabaseClient } from '../../lib/supabase';
import { shouldCompleteSocialProfile } from './signupValidation';

export type SocialSignInResult = {
  profileNeeded: boolean;
  email: string;
  displayName: string;
  avatarUri: string | null;
};

export class SocialSignInError extends Error {
  constructor(
    message: string,
    readonly kind: 'cancelled' | 'play-services' | 'expo-go' | 'linking' | 'failed',
  ) {
    super(message);
    this.name = 'SocialSignInError';
  }
}

function isExistingEmailError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; message?: string };
  return /identity_already_exists|email_exists|user_already_exists/i.test(
    `${candidate.code ?? ''} ${candidate.message ?? ''}`,
  );
}

async function finishSocialSignIn(): Promise<SocialSignInResult> {
  const client = getSupabaseClient();
  const { data: userResult, error: userError } = await client.auth.getUser();
  if (userError) throw userError;
  const user = userResult.user;
  if (!user) throw new Error('The sign-in completed without an active session.');

  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError) throw profileError;

  const metadata = user.user_metadata;
  return {
    profileNeeded: shouldCompleteSocialProfile(Boolean(profile)),
    email: user.email ?? '',
    displayName:
      (typeof metadata.full_name === 'string' && metadata.full_name) ||
      (typeof metadata.name === 'string' && metadata.name) ||
      '',
    avatarUri: typeof metadata.avatar_url === 'string' ? metadata.avatar_url : null,
  };
}

export async function signInWithGoogle(): Promise<SocialSignInResult | null> {
  if (Constants.appOwnership === 'expo') {
    throw new SocialSignInError('Google sign in needs a development build.', 'expo-go');
  }

  try {
    const google = await import('@react-native-google-signin/google-signin');
    const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    if (!webClientId) throw new Error('Google sign in is not configured.');
    google.GoogleSignin.configure({ webClientId });

    if (Platform.OS === 'android') {
      try {
        await google.GoogleSignin.hasPlayServices();
      } catch {
        throw new SocialSignInError(
          'Google Play services are missing or out of date. Update them and try again.',
          'play-services',
        );
      }
    }

    const response = await google.GoogleSignin.signIn();
    if (google.isCancelledResponse(response)) return null;
    if (!google.isSuccessResponse(response) || !response.data.idToken) {
      throw new Error('Google did not return an identity token.');
    }

    const { error } = await getSupabaseClient().auth.signInWithIdToken({
      provider: 'google',
      token: response.data.idToken,
    });
    if (error) throw error;
    return await finishSocialSignIn();
  } catch (error) {
    if (error instanceof SocialSignInError) throw error;
    if (isExistingEmailError(error)) {
      throw new SocialSignInError(
        'An account with this email already exists. Log in with your email and password.',
        'linking',
      );
    }
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string' &&
      /SIGN_IN_CANCELLED|CANCELED|CANCELLED/i.test(error.code)
    ) {
      return null;
    }
    throw new SocialSignInError('Google sign in failed. Try again.', 'failed');
  }
}

export async function signInWithApple(): Promise<SocialSignInResult | null> {
  if (Platform.OS !== 'ios') return null;

  try {
    const AppleAuthentication = await import('expo-apple-authentication');
    const rawNonce = Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce,
    );
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
    if (!credential.identityToken) throw new Error('Apple did not return an identity token.');

    const { error } = await getSupabaseClient().auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce: rawNonce,
    });
    if (error) throw error;

    if (credential.fullName) {
      const fullName = [
        credential.fullName.givenName,
        credential.fullName.middleName,
        credential.fullName.familyName,
      ]
        .filter(Boolean)
        .join(' ');
      const { error: updateError } = await getSupabaseClient().auth.updateUser({
        data: {
          full_name: fullName,
          given_name: credential.fullName.givenName,
          family_name: credential.fullName.familyName,
        },
      });
      if (updateError) throw updateError;
    }

    return await finishSocialSignIn();
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ERR_REQUEST_CANCELED'
    ) {
      return null;
    }
    if (isExistingEmailError(error)) {
      throw new SocialSignInError(
        'An account with this email already exists. Log in with your email and password.',
        'linking',
      );
    }
    throw new SocialSignInError('Apple sign in failed. Try again.', 'failed');
  }
}

export async function signOutProviders() {
  const { error } = await getSupabaseClient().auth.signOut();
  if (error) throw error;

  if (Constants.appOwnership === 'expo') return;
  try {
    const google = await import('@react-native-google-signin/google-signin');
    await google.GoogleSignin.signOut();
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string' &&
      /not.?available|native.?module/i.test(error.code)
    ) {
      return;
    }
    throw error;
  }
}
