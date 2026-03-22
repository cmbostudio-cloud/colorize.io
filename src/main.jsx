import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import AppRoot from './App';

// Service Worker 등록
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .catch(e => console.warn('SW failed:', e));
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(<AppRoot />);
