import { HashRouter, Route, Routes } from 'react-router-dom';
import { GlossaryProvider } from './components/Glossary';
import { Layout } from './components/Layout';
import { GlossaryPage } from './pages/GlossaryPage';
import { Home } from './pages/Home';
import { LessonPage } from './pages/LessonPage';
import { ModulePage } from './pages/ModulePage';
import { NotFound } from './pages/NotFound';
import { FinalTestPage, LessonQuizPage, ReviewPage } from './pages/QuizPages';

// HashRouter keeps the static build working from any host or sub-folder without server rewrites.
export function App() {
  return (
    <HashRouter>
      <GlossaryProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/m/:moduleSlug" element={<ModulePage />} />
            <Route path="/m/:moduleSlug/l/:lessonSlug" element={<LessonPage />} />
            <Route path="/m/:moduleSlug/l/:lessonSlug/quiz" element={<LessonQuizPage />} />
            <Route path="/m/:moduleSlug/test" element={<FinalTestPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/glossary" element={<GlossaryPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Layout>
      </GlossaryProvider>
    </HashRouter>
  );
}
