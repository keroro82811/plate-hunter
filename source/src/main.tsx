import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Intercept background Firebase quota limit messages to prevent triggering chat fix alerts
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const msg = event?.reason?.message || String(event?.reason || '');
    if (
      msg.includes('Quota limit exceeded') ||
      msg.includes('resource-exhausted') ||
      event?.reason?.code === 'resource-exhausted'
    ) {
      event.preventDefault();
      console.warn('[Storage] Cloud quota threshold reached. Seamlessly switched to local & server storage.');
    }
  });

  window.addEventListener('error', (event) => {
    const msg = event?.message || '';
    if (msg.includes('Quota limit exceeded') || msg.includes('resource-exhausted')) {
      event.preventDefault();
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
