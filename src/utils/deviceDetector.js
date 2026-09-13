/**
 * IBVAP — Dynamic Device & Physical Camera Detection Engine
 * Detects whether the client is on mobile (Android/iOS), tablet, or laptop/desktop,
 * and enumerates physical camera hardware (back/environment vs front/user cameras, USB CCTV).
 */

export const getDevicePlatform = () => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isTablet = /(iPad|tablet|(android(?!.*mobile))|(windows(?!.*phone)(.*touch))|kindle|playbook|silk)/i.test(ua);
  const isMobileScreen = typeof window !== 'undefined' && window.innerWidth <= 768;
  const isMobile = isAndroid || isIOS || isMobileScreen;

  let platformName = 'Desktop Workstation';
  let deviceType = 'desktop';

  if (isTablet) {
    platformName = 'Tablet Terminal';
    deviceType = 'tablet';
  } else if (isAndroid) {
    platformName = 'Android Tactical Mobile';
    deviceType = 'mobile';
  } else if (isIOS) {
    platformName = 'iOS Tactical Terminal';
    deviceType = 'mobile';
  } else if (/Mac/i.test(ua)) {
    platformName = 'macOS Station';
    deviceType = 'laptop';
  } else if (/Win/i.test(ua)) {
    platformName = 'Windows Command Post';
    deviceType = 'laptop';
  }

  return {
    isMobile,
    isTablet,
    isDesktop: !isMobile && !isTablet,
    deviceType,
    platformName,
  };
};

/**
 * Enumerate all physical video cameras connected to this device.
 */
export const enumerateDeviceCameras = async () => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    return [];
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter((d) => d.kind === 'videoinput');
    const { isMobile } = getDevicePlatform();

    return videoDevices.map((d, index) => {
      const lower = (d.label || '').toLowerCase();
      const isBack = lower.includes('back') || lower.includes('rear') || lower.includes('environment') || lower.includes('world') || lower.includes('wide') || lower.includes('main');
      const isFront = lower.includes('front') || lower.includes('user') || lower.includes('selfie') || lower.includes('face') || lower.includes('facetime');

      let cleanLabel = d.label;
      if (!cleanLabel) {
        if (isMobile) {
          cleanLabel = index === 0 ? 'Primary Rear Camera (Environment)' : 'Front Camera (User)';
        } else {
          cleanLabel = index === 0 ? 'Integrated HD Camera' : `External Camera / USB CCTV ${index}`;
        }
      }

      // Infer facing mode
      let facingMode = 'user';
      if (isBack || (isMobile && index === 0 && !isFront)) {
        facingMode = 'environment';
      } else if (isFront) {
        facingMode = 'user';
      }

      const isVirtual = 
        lower.includes('omen') ||
        lower.includes('voice') ||
        lower.includes('virtual') ||
        lower.includes('audio') ||
        lower.includes('obs') ||
        lower.includes('screen') ||
        lower.includes('stereo');

      return {
        deviceId: d.deviceId,
        label: cleanLabel,
        facingMode,
        isBack: facingMode === 'environment',
        isFront: facingMode === 'user',
        isVirtualVoice: isVirtual,
        isOptical: !isVirtual,
        groupId: d.groupId,
      };
    }).sort((a, b) => {
      // Prioritize genuine optical cameras over virtual voice/audio devices
      if (a.isVirtualVoice && !b.isVirtualVoice) return 1;
      if (!a.isVirtualVoice && b.isVirtualVoice) return -1;
      return 0;
    });
  } catch (err) {
    console.debug('Camera enumeration fallback:', err);
    return [];
  }
};

/**
 * Helper to retrieve only genuine physical optical video cameras.
 */
export const getOpticalCameras = async () => {
  const devices = await enumerateDeviceCameras();
  return devices.filter((d) => !d.isVirtualVoice);
};
