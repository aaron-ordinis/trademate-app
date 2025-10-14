// polyfills/auth-session-shim.js
import * as AuthSession from 'expo-auth-session';

// Minimal polyfill for AuthSession compatibility without scheduling issues
// Only add polyfills if they don't exist, and do it synchronously
if (typeof AuthSession.addRedirectListener === 'undefined') {
  AuthSession.addRedirectListener = () => ({
    remove: () => {},
  });
}

if (typeof AuthSession.removeRedirectListener === 'undefined') {
  AuthSession.removeRedirectListener = () => {};
}