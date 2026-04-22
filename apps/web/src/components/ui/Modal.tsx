import React from 'react';
import ReactDOM from 'react-dom';

/**
 * Portal wrapper — renders children into document.body so they escape
 * any parent stacking context (backdrop-filter, transform, z-index, etc.)
 */
export function Modal({ children }: { children: React.ReactNode }) {
  return ReactDOM.createPortal(children, document.body);
}
