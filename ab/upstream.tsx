// Upstream: shadcn's own components with Tailwind, styled by the project CSS
// `shadcn init` would write.
import '@fontsource-variable/inter'
import '@ab/generated/upstream.css'
import { upstreamExamples } from '@ab/generated/examples-upstream'
import { upstream } from '@ab/generated/upstream'
import { createRoot } from 'react-dom/client'
import { Gallery } from './gallery'

createRoot(document.getElementById('root') as HTMLElement).render(
  <Gallery side={{ ui: upstream, examples: upstreamExamples }} />,
)
