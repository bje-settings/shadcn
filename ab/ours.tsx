// Ours: the generated components with their CSS modules and the generated
// global stylesheets, as a consumer would install them.
import '@fontsource-variable/inter'
import '../registry/styles/variables.scss'
import '../registry/styles/base.scss'
import { createRoot } from 'react-dom/client'
import { Gallery } from './gallery'
import { ours } from './generated/ours'

createRoot(document.getElementById('root') as HTMLElement).render(<Gallery ui={ours} />)
