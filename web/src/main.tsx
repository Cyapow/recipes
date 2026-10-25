import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Library } from './pages/Library';
import { Editor } from './pages/Editor';
import { Describe } from './pages/Describe';
import { Import } from './pages/Import';
import { Cook } from './pages/Cook';
import { Settings } from './pages/Settings';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/new" element={<Editor />} />
        <Route path="/describe" element={<Describe />} />
        <Route path="/import" element={<Import />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/recipe/:id" element={<Cook />} />
        <Route path="/recipe/:id/edit" element={<Editor />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);

// Production only: in dev a worker would cache stale modules. A failure must never break the app.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    try {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    } catch {
      // ignore
    }
  });
}
