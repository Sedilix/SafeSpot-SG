import type { CapacitorConfig } from '@capacitor/cli';

// Android app shell around the same React front end the website serves.
// The app bundles its own copy of the front end (dist-android, built by
// `npm run build:android`) and calls the Cloud Run server for /api.
// The application id cannot change after the first Play Store release.
const config: CapacitorConfig = {
  appId: 'sg.safespot.app',
  appName: 'SafeSpot SG',
  webDir: 'dist-android',
  android: {
    // Pages are served from https://localhost inside the app.
    allowMixedContent: false,
  },
  plugins: {
    FirebaseAuthentication: {
      // Native Google sign-in only hands back a credential; the web Firebase
      // SDK signs in with it, so Firestore and authFetch keep working as-is.
      skipNativeAuth: true,
      providers: ['google.com'],
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
