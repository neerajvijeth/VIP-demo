import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';
import { setSemantics } from '@shared/semantics';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 60_000, gcTime: 30 * 60_000 } },
});

async function bootstrap() {
  // The server tells us which table/column names and business values to use (env overrides); fall back to defaults.
  try {
    const env = await (await fetch('/api/env')).json();
    if (env?.semantics) setSemantics(env.semantics);
  } catch {
    /* server unreachable: defaults apply */
  }
  render();
}

function render() {
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
}

void bootstrap();
