const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

if (!apiKey) {
  console.warn('VITE_GOOGLE_MAPS_API_KEY is not set')
}

export const GOOGLE_MAPS_API_KEY = apiKey ?? ''
