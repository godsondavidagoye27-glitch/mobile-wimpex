# Authentication setup

## Google

1. Open Google Cloud Console and create or select a project.
2. Configure the OAuth consent screen with Wimpex's app name, support email, terms URL, and privacy URL.
3. Create a Web application OAuth client ID. Add it as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in the local environment. The native Google module uses this ID as its server client ID.
4. Create an iOS OAuth client ID using `app.wimpex.mobile` as the bundle ID. Set `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` and set `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME` to the reversed client ID scheme from the Google client configuration.
5. Create an Android OAuth client ID using `app.wimpex.mobile` as the package name and an Android signing certificate SHA-1 fingerprint. EAS credentials are listed with:

   ```sh
   npx eas-cli@latest credentials --platform android
   ```

   Register the development and production fingerprints as separate Android OAuth clients when they differ. Add the corresponding IDs to the Supabase provider configuration.
6. In Supabase Dashboard, open Authentication, Sign In / Providers, then Google. Enable Google and enter the Web, iOS, and Android client IDs. Enable **Skip nonce check** for the native iOS Google flow.
7. In the project root, copy `.env.example` to `.env` and set the Google IDs together with the Supabase URL and anon key. Do not put an OAuth client secret in the app environment.

Google Sign-In requires a development build. Expo Go displays the development-build message instead of importing the native sign-in module.

## Apple

1. In Apple Developer, enable Sign In with Apple for the Wimpex App ID whose bundle identifier is `app.wimpex.mobile`.
2. In Supabase Dashboard, open Authentication, Sign In / Providers, then Apple. Enable Apple and configure its Services ID and signing key as required by the provider configuration.
3. Put the Services ID first in Supabase's Apple Client IDs list, then include the native App ID. This preserves native token sign-in while retaining the configured Services ID for web OAuth.
4. Configure the email relay source with Apple's Sign in with Apple for Email Communication service if users may choose a private relay address.
5. Add the Apple capability through the app config and build with EAS. Apple sign-in is displayed only on iOS when the platform reports it is available.

Native Apple authentication sends a SHA-256 nonce to Apple and supplies the original nonce to Supabase for token verification. The first Apple response may include a full name; subsequent responses may not.

## Supabase email and functions

1. Configure Supabase email signup and a six digit OTP email template. The recovery email template must expose the token code, not only a deep link, for the in-app reset screen.
2. Apply the migrations in `supabase/migrations` before creating profiles.
3. In Supabase Dashboard, open Edge Functions, then Secrets, and add `WIMPEX_SERVICE_ROLE_KEY` with the project service role key as its value. This secret is only read by the Edge Function. Do not add it to `.env`, `.env.example`, an EAS public variable, or app config.
4. Deploy the account cleanup function:

   ```sh
   npx supabase functions deploy delete-own-account
   ```

   The function verifies the caller's bearer token and deletes only the user identified by that verified token.

## Development builds

Install native packages and run a development build with EAS:

```sh
npx expo install @react-native-google-signin/google-signin expo-apple-authentication expo-crypto expo-dev-client
npx eas-cli@latest build --profile development --platform all
npx expo start --dev-client
```

Use a physical iOS device for Apple sign-in validation. Google sign-in configuration requires the matching bundle identifier or Android package and signing fingerprint.
