// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    files: ["src/features/auth/SignUpFlow.tsx", "src/features/splash/SplashSequence.tsx"],
    rules: {
      // Reanimated shared values are designed to be mutated by animation callbacks and effects.
      "react-hooks/immutability": "off",
    },
  },
]);
