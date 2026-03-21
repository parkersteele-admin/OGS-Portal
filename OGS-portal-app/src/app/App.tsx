import React from 'react'
import { AppProviders } from './providers/AppProviders'
import { AppRouter } from './router/AppRouter'
import '../styles/global.css'

const App: React.FC = () => (
  <AppProviders>
    <AppRouter />
  </AppProviders>
)

export default App
