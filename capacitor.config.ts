import type { CapacitorConfig } from '@capacitor/cli';

// The app id is permanent once the first build is uploaded to Google Play.
// It is a placeholder until the owner confirms the studio and package name.
const config: CapacitorConfig = {
  appId: 'com.ceptivo.castawaycove',
  appName: 'Castaway Cove',
  webDir: 'dist',
  android: {
    backgroundColor: '#2B524C',
  },
};

export default config;
