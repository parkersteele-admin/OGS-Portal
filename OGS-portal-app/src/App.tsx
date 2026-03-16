import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext'
import { Router } from './router'
import './styles/global.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 * 5, retry: 1 },
  },
})

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/*
        AuthProvider mounts a single onAuthStateChanged listener and populates
        the Zustand authStore.  It must wrap Router so all route components
        can read auth state via useAuth().
      */}
      <AuthProvider>
        <Router />
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
