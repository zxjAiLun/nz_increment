import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/design-system.css'

if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('quickTest')) {
  const quickTestScript = document.createElement('script')
  quickTestScript.src = '/scripts/quick-test.js'
  document.head.appendChild(quickTestScript)
}

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.mount('#app')
