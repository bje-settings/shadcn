// Ours: the generated components with their CSS modules, the generated global
// stylesheets and the mirrored Typeset, loaded as a consumer would, from the
// style's registry/<style>/styles (@ab/styles).
import '@ab/styles/fonts.css'
import '@ab/styles/variables.scss'
import '@ab/styles/base.scss'
import '@ab/styles/typeset.css'
// Layout for the examples' own markup; the components are ours.
import '@ab/generated/examples.css'
import { oursExamples } from '@ab/generated/examples-ours'
import { ours } from '@ab/generated/ours'
import { createRoot } from 'react-dom/client'
import { Gallery } from './gallery'

createRoot(document.getElementById('root') as HTMLElement).render(
  <Gallery side={{ ui: ours, examples: oursExamples }} />,
)
