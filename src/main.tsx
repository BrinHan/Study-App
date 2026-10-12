import { render } from 'preact'
import '@fontsource-variable/plus-jakarta-sans/wght.css'
import './styles.css'
import './pwa'
import { App } from './app'

render(<App />, document.getElementById('app')!)
