module.exports = ({ config }) => {
  const iosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;
  if (!iosUrlScheme && process.env.EAS_BUILD_PROFILE === 'production') {
    throw new Error(
      'EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME must be set for production builds.',
    );
  }

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      'expo-video',
      'expo-sqlite',
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
