type OsPlatform = 'macos' | 'windows' | 'linux' | 'ios' | 'android' | 'freebsd' | 'dragonfly' | 'netbsd' | 'openbsd' | 'solaris' | 'unknown';

function resolvePlatform(): OsPlatform {
  const ua = navigator.userAgent;
  if (ua.includes('Mac')) return 'macos';
  if (ua.includes('Windows')) return 'windows';
  if (ua.includes('Linux')) return 'linux';
  return 'unknown';
}

const currentPlatform = resolvePlatform();

export const isMac = currentPlatform === 'macos';
export const isWindows = currentPlatform === 'windows';
