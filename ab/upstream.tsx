// Upstream: shadcn's own components with Tailwind, styled by the project CSS
// `shadcn init` would write.
import '@fontsource-variable/inter'
import './generated/upstream.css'
import { createRoot } from 'react-dom/client'
import { Gallery } from './gallery'
import { upstream } from './generated/upstream'

createRoot(document.getElementById('root') as HTMLElement).render(<Gallery ui={upstream} />)
