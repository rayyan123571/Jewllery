import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { themeCssVariables } from './styles/theme.js'
// Fonts first: the @font-face rules must be registered before anything paints.
import './styles/fonts.css'
import './styles/index.css'

// Theme tokens are injected from theme.ts rather than duplicated in CSS, so
// there is exactly one definition of every colour and dimension.
const tokens = document.createElement('style')
tokens.textContent = themeCssVariables()
document.head.appendChild(tokens)

const root = document.getElementById('root')
if (!root) throw new Error('No #root element')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
