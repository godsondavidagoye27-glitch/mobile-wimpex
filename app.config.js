const { existsSync, readFileSync } = require('node:fs');

module.exports = ({ config }) => {
  const profile = process.env.EAS_BUILD_PROFILE;
  const iosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;
  const productionRequiredVariables = [
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
    'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID',
    'EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME',
  ];
  if (profile === 'production') {
    const missingVariables = productionRequiredVariables.filter((name) => !process.env[name]);
    if (missingVariables.length) {
      throw new Error(
        `Production builds require these environment variables: ${missingVariables.join(', ')}.`,
      );
    }
  }

  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
  const androidPackage = config.android?.package;
  // EAS_BUILD is only "true" on EAS build workers, so local config evaluation never fails here.
  const isAndroidEasBuild = process.env.EAS_BUILD === 'true' && process.env.EAS_BUILD_PLATFORM === 'android';
  if (isAndroidEasBuild && ['preview', 'production'].includes(profile) && !googleServicesFile) {
    throw new Error(
      `Set GOOGLE_SERVICES_JSON as an EAS file environment variable for the "${profile}" environment. `
      + 'Android push notifications will not work without it.',
    );
  }
  if (googleServicesFile) {
    if (!existsSync(googleServicesFile)) {
      throw new Error(`GOOGLE_SERVICES_JSON points to a file that does not exist: ${googleServicesFile}`);
    }
    let packageNames = [];
    try {
      const parsed = JSON.parse(readFileSync(googleServicesFile, 'utf8'));
      packageNames = (parsed.client ?? [])
        .map((client) => client?.client_info?.android_client_info?.package_name)
        .filter((name) => typeof name === 'string');
    } catch {
      throw new Error('GOOGLE_SERVICES_JSON is not a valid google-services.json file.');
    }
    if (androidPackage && !packageNames.includes(androidPackage)) {
      throw new Error(
        `GOOGLE_SERVICES_JSON is for ${packageNames.join(', ') || 'an unknown app'}, `
        + `but this app's Android package is ${androidPackage}. Download the google-services.json for ${androidPackage} from Firebase.`,
      );
    }
  }

  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
    extra: {
      ...config.extra,
      appVariant: profile ?? 'development',
    },
    plugins: [
      ...(config.plugins ?? []),
      'expo-video',
      'expo-image',
      'expo-sqlite',
      [
        '@livekit/react-native-expo-plugin',
        {
          android: { audioType: 'communication' },
          ios: { enableMultitaskingCameraAccess: false },
        },
      ],
      '@config-plugins/react-native-webrtc',
      ...(iosUrlScheme
        ? [
            [
              '@react-native-google-signin/google-signin',
              { iosUrlScheme },
            ],
          ]
        : []),
    ],
  };
};