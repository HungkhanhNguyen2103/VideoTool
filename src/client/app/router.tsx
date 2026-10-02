import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProjectInitPage } from '../features/project/ProjectInitPage';
import { Layout } from './Layout';
import { ReviewScriptPage } from '../features/script/ReviewScriptPage';
import { StudioPage } from '../features/asset/StudioPage';
import { SeoPage } from '../features/seo/SeoPage';

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
        element: <StudioPage />,
      },
      {
        path: 'production/:projectId/seo',
        element: <SeoPage />,
      },
    ],
  },
]);
