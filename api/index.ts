// Vercel entry: the whole Express API (password gate included) as one function.
// vercel.json routes /api/* and /files/* here; the front end is the static Vite build.
import app from '../server/app.ts'

export default app
