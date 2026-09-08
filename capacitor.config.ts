import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.blackblue.tinyheist',
  appName: 'Tiny Heist',
  webDir: 'dist',
  android: {
    backgroundColor: '#05070c',
  },
  ios: {
    backgroundColor: '#05070c',
    contentInset: 'always',
  },
  plugins: {
    SplashScreen: {
      backgroundColor: '#05070c',
      showSpinner: false,
      launchAutoHide: true,
    },
  },
};

export default config;
