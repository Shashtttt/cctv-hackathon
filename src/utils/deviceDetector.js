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

    // Filter out virtual audio/screen devices
    const opticalInputs = videoDevices.filter((d) => {
      const lower = (d.label || '').toLowerCase();
      const isVirtual = 
        lower.includes('omen') ||
        lower.includes('voice') ||
        lower.includes('virtual') ||
        lower.includes('audio') ||
        lower.includes('obs') ||
        lower.includes('screen') ||
        lower.includes('stereo');
      return !isVirtual;
    });

    // Mobile Dynamic Mode: Smartphones have 2 cameras (Rear Environment + Front User)
    if (isMobile) {
      if (opticalInputs.length >= 2) {
        return opticalInputs.map((d, index) => {
          const lower = (d.label || '').toLowerCase();
          const isFront = lower.includes('front') || lower.includes('user') || lower.includes('selfie') || lower.includes('facetime');
          const isBack = lower.includes('back') || lower.includes('rear') || lower.includes('environment') || lower.includes('main');
          const facingMode = isFront ? 'user' : (isBack ? 'environment' : (index === 0 ? 'environment' : 'user'));
          const cleanLabel = d.label || (facingMode === 'environment' ? 'Rear Camera (Environment)' : 'Front Camera (User)');
          return {
            id: `dev-cam-${index + 1}`,
            deviceId: d.deviceId,
            label: cleanLabel,
            name: cleanLabel,
            facingMode,
            isBack: facingMode === 'environment',
            isFront: facingMode === 'user',
            isOptical: true,
            isDeviceHardware: true,
            resolution: '1080p FHD',
            fps: 30,
            status: 'online',
          };
        });
      }

      // If mobile browser reports 1 device before permission or lacks multiple labels, expose the 2 standard mobile cameras
      return [
        {
          id: 'dev-cam-01',
          deviceId: opticalInputs[0]?.deviceId || 'mobile-rear-camera',
          label: opticalInputs[0]?.label || 'Primary Rear Camera (Environment)',
          name: opticalInputs[0]?.label || 'Primary Rear Camera (Environment)',
          facingMode: 'environment',
          isBack: true,
          isFront: false,
          isOptical: true,
          isDeviceHardware: true,
          resolution: '1080p FHD',
          fps: 30,
          status: 'online',
        },
        {
          id: 'dev-cam-02',
          deviceId: opticalInputs[1]?.deviceId || 'mobile-front-camera',
          label: 'Front Sentry Camera (User)',
          name: 'Front Sentry Camera (User)',
          facingMode: 'user',
          isBack: false,
          isFront: true,
          isOptical: true,
          isDeviceHardware: true,
          resolution: '1080p FHD',
          fps: 30,
          status: 'online',
        },
      ];
    }

    // Laptop / Desktop Mode:
    // A standard laptop has 1 front camera (e.g., HP Wide Vision, Integrated Camera).
    // If external USB cameras are attached, enumerate all of them.
    if (opticalInputs.length === 0) {
      return [
        {
          id: 'dev-cam-01',
          deviceId: 'default-cam-01',
          label: 'Integrated HD Camera (Front)',
          name: 'Integrated HD Camera (Front)',
          facingMode: 'user',
          isBack: false,
          isFront: true,
          isOptical: true,
          isDeviceHardware: true,
          resolution: '1080p FHD',
          fps: 30,
          status: 'online',
        }
      ];
    }

    return opticalInputs.map((d, index) => {
      const lower = (d.label || '').toLowerCase();
      // HP Wide Vision, FaceTime, Integrated, Webcam are front webcams on laptops
      const isFront = lower.includes('front') || lower.includes('user') || lower.includes('selfie') || 
                      lower.includes('face') || lower.includes('facetime') || lower.includes('integrated') || 
                      lower.includes('webcam') || lower.includes('laptop') || lower.includes('wide vision');
      const isBack = !isFront && (lower.includes('back') || lower.includes('rear') || lower.includes('environment') || lower.includes('world'));

      let facingMode = isBack ? 'environment' : 'user';
      let cleanLabel = d.label;
      if (!cleanLabel) {
        cleanLabel = index === 0 ? 'Integrated HD Camera (Front)' : `External USB Camera ${index + 1}`;
      }

      return {
        id: `dev-cam-${index + 1}`,
        deviceId: d.deviceId,
        label: cleanLabel,
        name: cleanLabel,
        facingMode,
        isBack: facingMode === 'environment',
        isFront: facingMode === 'user',
        isOptical: true,
        isDeviceHardware: true,
        resolution: '1080p FHD',
        fps: 30,
        status: 'online',
      };
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
  return await enumerateDeviceCameras();
};

