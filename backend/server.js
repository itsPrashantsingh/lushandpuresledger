require('dotenv').config()
const express = require('express')
const cors = require('cors')
const app = express()

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  }
}))

function requireApiKey(req, res, next) {
  const key = process.env.API_KEY
  if (!key) return next()
  const provided = req.headers['x-api-key']
  if (provided !== key) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

app.use('/webhook', express.raw({ type: 'application/json' }))
app.use(express.json())

// confirm-payment is public (customer after Razorpay); other routes need API key
app.use('/api/razorpay', (req, res, next) => {
  if (req.method === 'POST' && req.path === '/confirm-payment') return next()
  return requireApiKey(req, res, next)
})
app.use('/api/razorpay', require('./routes/razorpay'))
app.use('/api/daily-entry', require('./routes/daily-entry'))
app.use('/api/logs', require('./routes/logs'))
app.use('/api/whatsapp', require('./routes/whatsapp'))
app.use('/webhook', require('./routes/webhook'))

app.get('/health', (req, res) => res.json({ ok: true }))

app.use((err, req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: err.message || 'Server error' })
})

const port = process.env.PORT || 3001
app.listen(port, () => console.log('Server running on port', port))
