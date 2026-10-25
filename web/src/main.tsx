import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Library } from './pages/Library';
import { Editor } from './pages/Editor';
import { Cook } from './pages/Cook';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/new" element={<Editor />} />
        <Route path="/recipe/:id" element={<Cook />} />
        <Route path="/recipe/:id/edit" element={<Editor />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
