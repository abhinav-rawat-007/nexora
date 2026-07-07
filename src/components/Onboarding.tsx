import { motion } from "framer-motion";
import { ImagePlus } from "lucide-react";

export function OnboardingBanner({
  reduceMotion,
  onSetup,
  onDismiss,
}: {
  reduceMotion: boolean;
  onSetup: () => void;
  onDismiss: () => void;
}) {
  return (
    <motion.div
      className="toast toast-info onboarding-banner"
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: reduceMotion ? 0 : 0.2 }}
    >
      <ImagePlus size={16} />
      <span>Get cover art for your non-Steam games with a free SteamGridDB key.</span>
      <div className="onboarding-banner-actions">
        <button type="button" className="onboarding-banner-primary" onClick={onSetup}>
          Set it up
        </button>
        <button type="button" className="onboarding-banner-secondary" onClick={onDismiss}>
          Maybe later
        </button>
      </div>
    </motion.div>
  );
}

export function OnboardingSpotlightTip({
  reduceMotion,
  onDismiss,
}: {
  reduceMotion: boolean;
  onDismiss: () => void;
}) {
  return (
    <motion.div
      className="onboarding-tooltip"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: reduceMotion ? 0 : 0.15 }}
    >
      <p>
        Paste your key here. Grab a free one from your <strong>steamgriddb.com</strong> account under
        Preferences &rarr; API, then come back and paste it in.
      </p>
      <button type="button" onClick={onDismiss}>
        Got it
      </button>
    </motion.div>
  );
}
