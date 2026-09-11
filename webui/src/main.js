import { createApp } from 'vue'
import { applyEdgeToEdge } from './api/ksu.js'
import './mwc.js'

import './theme/tokens.css'
import './theme/base.css'
import './theme/components.css'
import './theme/app.css'

import App from './App.vue'

applyEdgeToEdge()
createApp(App).mount('#app')
