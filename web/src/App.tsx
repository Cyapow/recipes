import { Route, Routes } from 'react-router-dom';
import { Library } from './pages/Library';
import { Editor } from './pages/Editor';
import { Describe } from './pages/Describe';
import { Import } from './pages/Import';
import { Cook } from './pages/Cook';
import { RecipeOverview } from './pages/RecipeOverview';
import { Settings } from './pages/Settings';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Library />} />
      <Route path="/new" element={<Editor />} />
      <Route path="/describe" element={<Describe />} />
      <Route path="/import" element={<Import />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/recipe/:id" element={<RecipeOverview />} />
      <Route path="/recipe/:id/cook" element={<Cook />} />
      <Route path="/recipe/:id/edit" element={<Editor />} />
    </Routes>
  );
}
