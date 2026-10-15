import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SupplierApp } from './SupplierApp';
import '../styles/global.scss';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SupplierApp />
  </StrictMode>,
);
