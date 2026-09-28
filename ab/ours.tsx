// Ours: the generated components with their CSS modules, the generated global
// stylesheets and the mirrored Typeset, loaded as a consumer would. The
// harness compares mirror.config.json's upstream.compare style, vega.
import '../registry/vega/styles/fonts.css'
import '../registry/vega/styles/variables.scss'
import '../registry/vega/styles/base.scss'
import '../registry/vega/styles/typeset.css'
// Layout for the examples' own markup; the components are ours.
import './generated/examples.css'
import { createRoot } from 'react-dom/client'
import { Gallery } from './gallery'
import { oursExamples } from './generated/examples-ours'
import { ours } from './generated/ours'

createRoot(document.getElementById('root') as HTMLElement).render(
  <Gallery side={{ ui: ours, examples: oursExamples }} />,
)
