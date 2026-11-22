import type { MicProfile } from './micCalibration';

// Add only versioned numerical profiles cleared for distribution here.
export const builtinProfiles: readonly MicProfile[] = [];
export const faberStudy = {
  model: 'iPhone 17 Pro',
  url: 'https://www.faberacoustical.com/blog/2025/ios/iphone/measured-iphone-17-pro-microphone-frequency-response-and-directivity/',
  status: 'Нижний микрофон · SignalScope measurement mode. Экспериментальная кривая для браузера ожидает разрешённых численных данных.',
} as const;
