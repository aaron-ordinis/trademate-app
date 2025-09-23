// lib/iap.js
import * as RNIap from 'react-native-iap';

export const PRODUCT_IDS = ['premium_monthly', 'premium_yearly'];

let purchaseUpdateSub = null;
let purchaseErrorSub = null;

export async function initIap() {
  await RNIap.initConnection();
  // (optional) On Android: enable pending purchases
  if (RNIap.flushFailedPurchasesCachedAsPendingAndroid) {
    try { await RNIap.flushFailedPurchasesCachedAsPendingAndroid(); } catch {}
  }
}

export async function getSubscriptions() {
  try {
    const items = await RNIap.getSubscriptions(PRODUCT_IDS);
    return items; // [{productId, price, title, description, ...}]
  } catch (e) {
    console.warn('getSubscriptions error', e);
    return [];
  }
}

export async function buySubscription(productId) {
  try {
    const purchase = await RNIap.requestSubscription(productId);
    return purchase; // you’ll verify this server-side
  } catch (err) {
    console.error('IAP purchase error', err);
    throw err;
  }
}

export function listenPurchases(onPurchase, onError) {
  // call in a component’s effect and clean up on unmount
  purchaseUpdateSub = RNIap.purchaseUpdatedListener((purchase) => {
    onPurchase?.(purchase);
  });
  purchaseErrorSub = RNIap.purchaseErrorListener((e) => {
    onError?.(e);
  });
  return () => {
    purchaseUpdateSub?.remove?.();
    purchaseErrorSub?.remove?.();
    purchaseUpdateSub = null;
    purchaseErrorSub = null;
  };
}

export async function acknowledgeAndroid(purchaseToken) {
  try { await RNIap.acknowledgePurchaseAndroid(purchaseToken); } catch {}
}

export async function endIap() {
  try { await RNIap.endConnection(); } catch {}
}