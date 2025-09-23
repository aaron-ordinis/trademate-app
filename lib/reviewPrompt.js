// app/lib/reviewPrompt.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as StoreReview from "expo-store-review";
import * as Linking from "expo-linking";
import Constants from "expo-constants";

const KEY_HAS_REVIEWED = "review.hasReviewed";

export async function hasReviewed() {
  return (await AsyncStorage.getItem(KEY_HAS_REVIEWED)) === "true";
}

export async function markReviewed() {
  await AsyncStorage.setItem(KEY_HAS_REVIEWED, "true");
}

/**
 * Open in-app review flow if available, else open Play Store listing.
 * We optimistically mark as reviewed once we successfully launch either flow.
 */
export async function launchReviewFlow() {
  const androidPackage =
    (Constants.expoConfig && Constants.expoConfig.android && Constants.expoConfig.android.package) ||
    (Constants.manifest && Constants.manifest.android && Constants.manifest.android.package) ||
    ""; // set manually if needed

  // 1) Try native in-app review
  try {
    const isAvailable = await StoreReview.isAvailableAsync();
    if (isAvailable) {
      await StoreReview.requestReview();
      await markReviewed();
      return;
    }
  } catch {}

  // 2) Fallback to Play Store listing
  try {
    if (androidPackage) {
      // Prefer market:// for Play app, fall back to https
      const marketUrl = `market://details?id=${androidPackage}`;
      const httpsUrl = `https://play.google.com/store/apps/details?id=${androidPackage}`;

      const canOpenMarket = await Linking.canOpenURL(marketUrl);
      await Linking.openURL(canOpenMarket ? marketUrl : httpsUrl);
      await markReviewed();
      return;
    }
  } catch {}

  // If neither path worked, do nothing (we'll try again next time)
}

/** Should we show the modal? Always true until they've reviewed. */
export async function shouldShowReviewPrompt() {
  return !(await hasReviewed());
}