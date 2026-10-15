import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { OverviewPage } from '@/pages/overview/OverviewPage';
import { BuilderPage } from '@/pages/builder/BuilderPage';
import { Skeleton } from '@/components/ui/primitives';

const ChatPage = lazy(() => import('@/pages/chat/ChatPage'));
const SqlPage = lazy(() => import('@/pages/sql/SqlPage'));
const SavedQueriesPage = lazy(() => import('@/pages/saved/SavedQueriesPage'));
const CanvasListPage = lazy(() => import('@/pages/canvas/CanvasListPage'));
const CanvasEditorPage = lazy(() => import('@/pages/canvas/CanvasEditorPage'));

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard/overview" replace />} />
        <Route path="dashboard">
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="assets" element={<BuilderPage key="assets" entity="assets" />} />
          <Route path="vulnerabilities" element={<BuilderPage key="vulnerabilities" entity="vulnerabilities" />} />
          <Route path="sql" element={<Suspense fallback={<Skeleton className="m-6 h-64" />}><SqlPage /></Suspense>} />
          <Route path="saved" element={<Suspense fallback={<Skeleton className="m-6 h-64" />}><SavedQueriesPage /></Suspense>} />
          <Route path="canvas" element={<Suspense fallback={<Skeleton className="m-6 h-64" />}><CanvasListPage /></Suspense>} />
          <Route path="canvas/:id" element={<Suspense fallback={<Skeleton className="m-6 h-64" />}><CanvasEditorPage /></Suspense>} />
        </Route>
        <Route
          path="chat"
          element={
            <Suspense fallback={<Skeleton className="m-6 h-64" />}>
              <ChatPage />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/dashboard/overview" replace />} />
      </Route>
    </Routes>
  );
}
