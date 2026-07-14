// Daily automation tick. Run by Render Cron (or any scheduler / external pinger).
// Reads automation_config and runs generation/send/reminders as due.
require('dotenv').config()
const { runCron } = require('../lib/whatsapp/scheduler')

runCron()
  .then((result) => {
    console.log('[cron] done:', JSON.stringify(result))
    process.exit(0)
  })
  .catch((err) => {
    console.error('[cron] failed:', err.message)
    process.exit(1)
  })
