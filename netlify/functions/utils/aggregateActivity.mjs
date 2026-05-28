// ═══════════════════════════════════════════════════════════════
// Shared activity-log aggregator.
//
// Used by both the weekly email report (7-day window) and the
// private all-time admin stats page (no window). The caller is
// responsible for fetching the events; this function purely rolls
// them up into a JSON-safe summary.
//
// Output shape:
//   {
//     totalEvents, sessionCount, uniqueLoggedIn, uniqueGuests,
//     reportRequests, supportRequests, goalsReached,
//     propertyEvents, refiEvents, upgradeEvents, staffEvents,
//     firstEventAt, lastEventAt,           // ISO strings
//     topActors: [ … 25 ],                 // sorted by portfolio
//     supportEvents: [ … ],                // raw support_requested events
//     reportEvents:  [ … ],                // raw report_requested events
//   }
//
// Timestamps in supportEvents / reportEvents / topActors.lastActiveAt
// are normalized to ISO strings so the result is JSON-safe.
// ═══════════════════════════════════════════════════════════════

function toIso(ts) {
  if (!ts) return null
  if (typeof ts === 'string') return ts
  if (ts?.toDate) {
    try { return ts.toDate().toISOString() } catch { return null }
  }
  if (typeof ts?._seconds === 'number') {
    try { return new Date(ts._seconds * 1000).toISOString() } catch { return null }
  }
  try { return new Date(ts).toISOString() } catch { return null }
}

function sanitizeEvent(e) {
  return { ...e, createdAt: toIso(e.createdAt) }
}

// Build a zero-filled daily activity series for the last `days` days.
// One row per UTC day with per-day session + event counts, broken out by
// signed-in vs guest. Used by the admin page's usage-over-time chart.
function buildDailySeries(events, days = 90) {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - (days - 1))

  // Pre-fill every day in the window with a zero bucket so the chart
  // renders a continuous timeline even on days with no activity.
  const buckets = new Map()
  for (let i = 0; i < days; i++) {
    const d = new Date(start)
    d.setUTCDate(d.getUTCDate() + i)
    const key = d.toISOString().slice(0, 10)
    buckets.set(key, {
      date:             key,
      events:           0,
      sessions:         new Set(),
      signedInSessions: new Set(),
      guestSessions:    new Set(),
      uniqueActors:     new Set(),
    })
  }

  for (const e of events) {
    const iso = toIso(e.createdAt)
    if (!iso) continue
    const dayKey = iso.slice(0, 10)
    const bucket = buckets.get(dayKey)
    if (!bucket) continue   // outside the window — ignore
    bucket.events++
    const isUid = !!e.uid
    if (e.sessionId) {
      bucket.sessions.add(e.sessionId)
      if (isUid) bucket.signedInSessions.add(e.sessionId)
      else if (e.guestId) bucket.guestSessions.add(e.sessionId)
    }
    const actorKey = isUid ? `uid:${e.uid}` : `guest:${e.guestId || 'unknown'}`
    bucket.uniqueActors.add(actorKey)
  }

  return Array.from(buckets.values()).map(b => ({
    date:             b.date,
    events:           b.events,
    sessions:         b.sessions.size,
    signedInSessions: b.signedInSessions.size,
    guestSessions:    b.guestSessions.size,
    uniqueActors:     b.uniqueActors.size,
  }))
}

export function aggregateActivity(events) {
  const byActor       = new Map()
  const sessionIds    = new Set()
  const supportEvents = []
  const reportEvents  = []
  const uniqueLoggedIn = new Set()
  const uniqueGuests   = new Set()

  let totalEvents     = events.length
  let reportRequests  = 0
  let supportRequests = 0
  let goalsReached    = 0
  let propertyEvents  = 0
  let refiEvents      = 0
  let upgradeEvents   = 0
  let staffEvents     = 0
  let firstEventAt    = null
  let lastEventAt     = null

  for (const e of events) {
    if (e.sessionId) sessionIds.add(e.sessionId)
    const isUid    = !!e.uid
    const actorKey = isUid ? `uid:${e.uid}` : `guest:${e.guestId || 'unknown'}`
    if (isUid) uniqueLoggedIn.add(e.uid)
    else if (e.guestId) uniqueGuests.add(e.guestId)

    if (!byActor.has(actorKey)) {
      byActor.set(actorKey, {
        key:              actorKey,
        isUid,
        id:               isUid ? e.uid : (e.guestId || 'unknown'),
        sessions:         new Set(),
        highestCashFlow:  -Infinity,
        highestPortfolio: -Infinity,
        highestEquity:    -Infinity,
        propertiesOwned:  0,
        reportRequests:   0,
        supportRequested: false,
        lastActiveAt:     null,
        playerName:       null,
        playerEmail:      null,
        authProvider:     null,
      })
    }
    const a = byActor.get(actorKey)
    if (e.sessionId) a.sessions.add(e.sessionId)
    if (Number.isFinite(e.monthlyCashFlow)) a.highestCashFlow  = Math.max(a.highestCashFlow,  e.monthlyCashFlow)
    if (Number.isFinite(e.portfolioValue))  a.highestPortfolio = Math.max(a.highestPortfolio, e.portfolioValue)
    if (Number.isFinite(e.totalEquity))     a.highestEquity    = Math.max(a.highestEquity,    e.totalEquity)
    if (Number.isFinite(e.propertiesOwned)) a.propertiesOwned  = Math.max(a.propertiesOwned,  e.propertiesOwned)
    if (e.eventType === 'report_requested') {
      reportRequests++
      a.reportRequests++
      reportEvents.push(sanitizeEvent(e))
    }
    if (e.eventType === 'support_requested') {
      supportRequests++
      a.supportRequested = true
      supportEvents.push(sanitizeEvent(e))
    }
    if (e.eventType === 'goal_reached')        goalsReached++
    if (e.eventType === 'property_acquired')   propertyEvents++
    if (e.eventType === 'refinance_completed') refiEvents++
    if (e.eventType === 'upgrade_completed')   upgradeEvents++
    if (e.eventType === 'staff_hired')         staffEvents++

    if (e.playerName    && !a.playerName)    a.playerName    = e.playerName
    if (e.playerEmail   && !a.playerEmail)   a.playerEmail   = e.playerEmail
    if (e.authProvider  && !a.authProvider)  a.authProvider  = e.authProvider

    const tsIso = toIso(e.createdAt)
    if (tsIso) {
      const tsDate = new Date(tsIso)
      if (!a.lastActiveAt || tsDate > new Date(a.lastActiveAt)) a.lastActiveAt = tsIso
      if (!firstEventAt   || tsDate < new Date(firstEventAt))   firstEventAt   = tsIso
      if (!lastEventAt    || tsDate > new Date(lastEventAt))    lastEventAt    = tsIso
    }
  }

  const topActors = Array.from(byActor.values())
    .map(a => {
      const { sessions, ...rest } = a
      return {
        ...rest,
        sessionCount:     sessions.size,
        highestCashFlow:  a.highestCashFlow  === -Infinity ? null : a.highestCashFlow,
        highestPortfolio: a.highestPortfolio === -Infinity ? null : a.highestPortfolio,
        highestEquity:    a.highestEquity    === -Infinity ? null : a.highestEquity,
      }
    })
    .sort((a, b) =>
      ((b.highestPortfolio ?? 0) - (a.highestPortfolio ?? 0)) ||
      (b.sessionCount - a.sessionCount)
    )
    .slice(0, 25)

  return {
    totalEvents,
    sessionCount:  sessionIds.size,
    uniqueLoggedIn: uniqueLoggedIn.size,
    uniqueGuests:   uniqueGuests.size,
    reportRequests,
    supportRequests,
    goalsReached,
    propertyEvents,
    refiEvents,
    upgradeEvents,
    staffEvents,
    firstEventAt,
    lastEventAt,
    topActors,
    supportEvents,
    reportEvents,
    dailySeries: buildDailySeries(events, 90),
  }
}
