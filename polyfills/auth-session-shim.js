// polyfills/auth-session-shim.js
import * as AuthSession from 'expo-auth-session';

// Fix for AuthSession.addRedirectListener error
// Polyfill for missing addRedirectListener function
if (!AuthSession.addRedirectListener) {
  AuthSession.addRedirectListener = () => {
    // Return a subscription-like object for compatibility
    return {
      remove: () => {},
    };
  };
}

// Ensure other common AuthSession methods exist
if (!AuthSession.removeRedirectListener) {
  AuthSession.removeRedirectListener = () => {};
}

console.log('[AuthSession Shim] Applied polyfills for missing methods');