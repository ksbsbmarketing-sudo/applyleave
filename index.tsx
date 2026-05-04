import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PrintPreview } from './components/PrintPreview';
import { LanguageProvider } from './components/LanguageContext';
import { ErrorBoundary } from './components/ErrorBoundary';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const isPrintMode = new URLSearchParams(window.location.search).get('print') === '1';

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <LanguageProvider>
        {isPrintMode ? <PrintPreview /> : <App />}
      </LanguageProvider>
    </ErrorBoundary>
  </React.StrictMode>
);