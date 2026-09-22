import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { IconSprite } from '../shared/ui/IconSprite';
import { Toast } from '../shared/ui/Toast';
import { router } from './router';

const queryClient = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <IconSprite />
      <RouterProvider router={router} />
      <Toast />
    </QueryClientProvider>
  );
}
