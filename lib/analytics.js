/**
 * Vercel Web Analytics Integration
 * Initializes Vercel Web Analytics for tracking page views and events
 */

// Initialize the analytics queue
window.va = window.va || function(...params) {
  (window.vaq = window.vaq || []).push(params);
};

// Load the Vercel Analytics script
(function() {
  const script = document.createElement('script');
  script.defer = true;
  script.src = '/_vercel/insights/script.js';
  
  script.onerror = function() {
    console.log('[Vercel Web Analytics] Analytics script could not be loaded. Ensure Web Analytics is enabled in your Vercel project settings.');
  };
  
  document.head.appendChild(script);
})();
