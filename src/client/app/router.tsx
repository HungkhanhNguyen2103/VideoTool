import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProjectInitPage } from '../features/project/ProjectInitPage';
import { Layout } from './Layout';
import { ComingSoonPage } from './pages/ComingSoonPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/production/init" replace /> },
      { path: 'production/init', element: <ProjectInitPage /> },
      {
        path: 'production/:projectId/review',
        element: <ComingSoonPage title="2. Duyệt & Tái Tạo" phase={3} />,
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
