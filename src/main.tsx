import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/tokens.css';
import './styles/base.css';
import './styles/workspace.css';

const root = document.getElementById('root');
if (root === null) throw new Error('#root 요소를 찾지 못했다.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
