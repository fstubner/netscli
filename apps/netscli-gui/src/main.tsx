import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary } from './components/primitives/ErrorBoundary.tsx'
import { reportFirstPaint } from './services/renderMode.ts'

// The non-null assertion is the one place it is justified: index.html always
// ships this element, and a missing root is a build error, not a runtime case
// worth branching on. Throwing a clear message beats React's opaque failure.
const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('#root is missing from index.html')

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

// Deliberately outside the tree, and outside the ErrorBoundary. This has to run
// whenever anything reached the screen, including the boundary's own fallback:
// a caught React error still means the compositor worked, and turning hardware
// compositing off would be the wrong response to it.
reportFirstPaint()


