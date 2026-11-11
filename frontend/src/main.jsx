// Fonts are self-hosted (same origin, no render-blocking third-party CSS).
import '@fontsource-variable/schibsted-grotesk'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
