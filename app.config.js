const { existsSync } = require('node:fs');

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
  if (profile && process.env.EAS_BUILD_PLATFORM === 'android' && !googleServicesFile) {
    throw new Error(
      `Set GOOGLE_SERVICES_JSON as an EAS file environment variable for Android ${profile} builds.`,
    );
  }
  if (googleServicesFile && !existsSync(googleServicesFile)) {
    throw new Error(`GOOGLE_SERVICES_JSON points to a file that does not exist: ${googleServicesFile}`);
  }

  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
    plugins: [
      ...(config.plugins ?? []),
      'expo-video',
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
