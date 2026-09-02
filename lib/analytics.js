/**
 * Vercel Web Analytics initialization
 * This script injects the Vercel Analytics tracking code
 */
import { inject } from '@vercel/analytics';

// Initialize analytics with auto mode detection
inject({
  mode: 'auto', // Automatically detect environment (production/development)
  debug: false   // Set to true for debug logging
});
