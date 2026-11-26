import { Route, Routes } from 'react-router-dom';
import { Library } from './pages/Library';
import { Editor } from './pages/Editor';
import { Describe } from './pages/Describe';
import { Photos } from './pages/Photos';
import { Import } from './pages/Import';
import { Cook } from './pages/Cook';
import { RecipeOverview } from './pages/RecipeOverview';
import { PrintCard } from './pages/PrintCard';
import { Settings } from './pages/Settings';
import { Shopping } from './pages/Shopping';
import { Planner } from './pages/Planner';
import { Meals } from './pages/Meals';
import { Meal } from './pages/Meal';
import { Ingredients } from './pages/Ingredients';
import { NotFound } from './pages/NotFound';
import { AuthGate } from './components/AuthGate';

export function App() {
  return (
    <AuthGate>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/new" element={<Editor />} />
        <Route path="/describe" element={<Describe />} />
        <Route path="/photos" element={<Photos />} />
        <Route path="/import" element={<Import />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/shopping" element={<Shopping />} />
        <Route path="/planner" element={<Planner />} />
        <Route path="/meals" element={<Meals />} />
        <Route path="/meals/:id" element={<Meal />} />
        <Route path="/ingredients" element={<Ingredients />} />
        <Route path="/recipe/:id" element={<RecipeOverview />} />
        <Route path="/recipe/:id/cook" element={<Cook />} />
        <Route path="/recipe/:id/edit" element={<Editor />} />
        <Route path="/recipe/:id/print" element={<PrintCard />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthGate>
  );
}
