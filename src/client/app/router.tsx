import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProjectInitPage } from '../features/project/ProjectInitPage';
import { Layout } from './Layout';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { ReviewScriptPage } from '../features/script/ReviewScriptPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/production/init" replace /> },
      { path: 'production/init', element: <ProjectInitPage /> },
      {
        path: 'production/:projectId/review',
        element: <ReviewScriptPage />,
      },
      {
        path: 'production/:projectId/studio',
        element: <ComingSoonPage title="3. Studio Phân Cảnh & Xuất Video" phase={4} />,
      },
      {
        path: 'production/:projectId/seo',
        element: <ComingSoonPage title="4. SEO & Đóng Gói Kênh" phase={6} />,
      },
    ],
  },
]);
