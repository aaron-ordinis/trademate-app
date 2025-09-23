// Premium access logic for 7-day trial + subscription model

/**
 * Determines if a user has premium access based on trial and subscription status
 * @param {Object} profile - User profile object
 * @returns {Object} - { isPremium: boolean, status: string, daysRemaining?: number, isBlocked: boolean }
 */
export function getPremiumStatus(profile) {
  if (!profile) {
    return { isPremium: false, status: 'no_profile', isBlocked: false };
  }

  const now = new Date();
  const trialEndsAt = profile.trial_ends_at ? new Date(profile.trial_ends_at) : null;
  const planTier = profile.plan_tier?.toLowerCase() || 'free';
  const planStatus = profile.plan_status?.toLowerCase() || 'inactive';

  // Premium subscriber
  if (planTier === 'premium' && planStatus === 'active') {
    return { isPremium: true, status: 'premium', isBlocked: false };
  }

  // Trial user
  if (trialEndsAt && now <= trialEndsAt) {
    return { isPremium: true, status: 'trial', isBlocked: false };
  }

  // Expired trial
  if (trialEndsAt && now > trialEndsAt) {
    return { isPremium: false, status: 'expired', isBlocked: true };
  }

  // Free user (no trial set up yet)
  return { isPremium: false, status: 'free', isBlocked: false };
}

/**
 * Simple helper to check if user has premium access
 * @param {Object} profile - User profile object
 * @returns {boolean}
 */
export function isPremiumUser(profile) {
  return getPremiumStatus(profile).isPremium;
}

/**
 * Check if user is blocked from using the app
 * @param {Object} profile - User profile object
 * @returns {boolean}
 */
export function isUserBlocked(profile) {
  return getPremiumStatus(profile).isBlocked;
}

/**
 * Get display text for trial status
 * @param {Object} profile - User profile object  
 * @returns {string}
 */
export function getTrialStatusText(profile) {
  const status = getPremiumStatus(profile);
  
  switch (status.status) {
    case 'subscribed':
      return 'Pro plan active';
    case 'trial':
      return `Trial ends in ${status.daysRemaining} day${status.daysRemaining === 1 ? '' : 's'}`;
    case 'expired':
      return 'Trial expired — Subscribe to continue using TradeMate';
    default:
      return 'Loading...';
  }
}
