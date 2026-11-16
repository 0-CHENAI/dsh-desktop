/** Exercise the shipped Harness frame, rather than a second synthetic caption layout. */
if (process.platform !== 'win32') process.exit(0)
process.env.DSH_SMOKE_TITLEBAR_MATRIX = '1'
require('./check-desktop-profile.cjs')
