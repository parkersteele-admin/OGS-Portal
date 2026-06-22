import { onRequest } from 'firebase-functions/v2/https'
import { FieldPath, Timestamp, type QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { adminAuth, db } from './admin'

type SafeError = {
  code: string | null
  message: string
}

type NotificationItem = {
  id: string
  type: string | null
  title: string | null
  body: string | null
  userId: string | null
  role: string | null
  link: string | null
  read: boolean | null
  priority: string | null
  jobId: string | null
  createdAt: string | null
}

function toSafeError(err: unknown): SafeError {
  if (err instanceof Error) {
    const code = (err as Error & { code?: unknown }).code
    return {
      code: typeof code === 'string' ? code : null,
      message: err.message,
    }
  }

  return {
    code: null,
    message: String(err),
  }
}

function toIso(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  return null
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  const out: Record<string, string> = {}

  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=')
    if (idx <= 0) continue
    const key = pair.slice(0, idx).trim()
    const val = pair.slice(idx + 1).trim()
    out[key] = decodeURIComponent(val)
  }

  return out
}

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? null
}

async function authenticateRequest(req: { headers: Record<string, string | string[] | undefined> }) {
  const authHeaderValue = req.headers.authorization
  const authHeader = Array.isArray(authHeaderValue) ? authHeaderValue[0] : authHeaderValue

  let token = extractBearerToken(authHeader)
  if (!token) {
    const cookieHeaderValue = req.headers.cookie
    const cookieHeader = Array.isArray(cookieHeaderValue) ? cookieHeaderValue[0] : cookieHeaderValue
    const cookies = parseCookies(cookieHeader)
    token = cookies.__session ?? null
  }

  if (!token) {
    throw Object.assign(new Error('Missing session token.'), { statusCode: 401 })
  }

  return adminAuth.verifyIdToken(token)
}

function isAdminToken(token: Record<string, unknown>): boolean {
  const role = typeof token.role === 'string' ? token.role : null
  const securityRole = typeof token.securityRole === 'string' ? token.securityRole : null
  const roles = toStringArray(token.roles)

  return role === 'admin' || securityRole === 'admin' || roles.includes('admin')
}

function pickNotification(doc: QueryDocumentSnapshot): NotificationItem {
  const data = doc.data() as Record<string, unknown>
  return {
    id: doc.id,
    type: typeof data.type === 'string' ? data.type : null,
    title: typeof data.title === 'string' ? data.title : null,
    body: typeof data.body === 'string' ? data.body : null,
    userId: typeof data.userId === 'string' ? data.userId : null,
    role: typeof data.role === 'string' ? data.role : null,
    link: typeof data.link === 'string' ? data.link : null,
    read: typeof data.read === 'boolean' ? data.read : null,
    priority: typeof data.priority === 'string' ? data.priority : null,
    jobId: typeof data.jobId === 'string' ? data.jobId : null,
    createdAt: toIso(data.createdAt),
  }
}

async function getInboxForUser(userId: string): Promise<NotificationItem[]> {
  const snap = await db
    .collection('notifications')
    .where('userId', '==', userId)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get()

  return snap.docs.map(pickNotification)
}

async function getDocByIdFromCollection(collectionName: string, docId: string) {
  const docSnap = await db.collection(collectionName).doc(docId).get()
  if (!docSnap.exists) return null
  return {
    path: docSnap.ref.path,
    data: docSnap.data() as Record<string, unknown>,
  }
}

async function getDocByIdFromCollectionGroup(groupName: string, docId: string) {
  const snap = await db
    .collectionGroup(groupName)
    .where(FieldPath.documentId(), '==', docId)
    .limit(1)
    .get()

  if (snap.empty) return null
  const doc = snap.docs[0]
  return {
    path: doc.ref.path,
    data: doc.data() as Record<string, unknown>,
  }
}

function pickJobShape(path: string | null, data: Record<string, unknown> | null) {
  if (!data) {
    return {
      canonicalPath: path,
      title: null,
      crewId: null,
      crewLeadUserId: null,
      crewLeadId: null,
      crewMemberUserIds: [] as string[],
      assigneeIds: [] as string[],
    }
  }

  return {
    canonicalPath: path,
    title:
      typeof data.title === 'string'
        ? data.title
        : typeof data.name === 'string'
          ? data.name
          : null,
    crewId: typeof data.crewId === 'string' ? data.crewId : null,
    crewLeadUserId: typeof data.crewLeadUserId === 'string' ? data.crewLeadUserId : null,
    crewLeadId: typeof data.crewLeadId === 'string' ? data.crewLeadId : null,
    crewMemberUserIds: toStringArray(data.crewMemberUserIds),
    assigneeIds: toStringArray(data.assigneeIds),
  }
}

export const apiNotifications = onRequest(async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed.' })
    return
  }

  try {
    const decoded = await authenticateRequest(req)
    const requestedUserId = typeof req.query.userId === 'string' ? req.query.userId : null
    const userId = requestedUserId || decoded.uid

    if (userId !== decoded.uid && !isAdminToken(decoded as Record<string, unknown>)) {
      res.status(403).json({ error: 'Admin required to read another user inbox.' })
      return
    }

    const notifications = await getInboxForUser(userId)
    res.status(200).json({ ok: true, userId, notifications })
  } catch (err) {
    const safeErr = toSafeError(err)
    // Temporary: surface real server error details while API diagnostics are active.
    console.error('[api/notifications] inbox query failed', {
      code: safeErr.code,
      message: safeErr.message,
    })

    const statusCode =
      err instanceof Error && typeof (err as Error & { statusCode?: unknown }).statusCode === 'number'
        ? (err as Error & { statusCode: number }).statusCode
        : 500

    res.status(statusCode).json({
      ok: false,
      error: safeErr,
    })
  }
})

export const adminDebugCrewAssignmentHealth = onRequest(async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed.' })
    return
  }

  let requester: Awaited<ReturnType<typeof authenticateRequest>>
  try {
    requester = await authenticateRequest(req)
  } catch (err) {
    const safeErr = toSafeError(err)
    const statusCode =
      err instanceof Error && typeof (err as Error & { statusCode?: unknown }).statusCode === 'number'
        ? (err as Error & { statusCode: number }).statusCode
        : 401

    res.status(statusCode).json({ ok: false, error: safeErr })
    return
  }

  if (!isAdminToken(requester as Record<string, unknown>)) {
    res.status(403).json({ ok: false, error: { code: 'permission-denied', message: 'Admin only.' } })
    return
  }

  const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : ''
  const jobId = typeof req.query.jobId === 'string' ? req.query.jobId.trim() : ''

  if (!userId || !jobId) {
    res.status(400).json({
      ok: false,
      error: {
        code: 'invalid-argument',
        message: 'Both userId and jobId query params are required.',
      },
    })
    return
  }

  const commitFromEnv =
    process.env.GIT_COMMIT
    ?? process.env.COMMIT_SHA
    ?? process.env.SOURCE_VERSION
    ?? process.env.K_REVISION
    ?? null

  let targetAuthUser: Awaited<ReturnType<typeof adminAuth.getUser>> | null = null
  let targetAuthUserError: SafeError | null = null

  try {
    targetAuthUser = await adminAuth.getUser(userId)
  } catch (err) {
    targetAuthUserError = toSafeError(err)
  }

  const [userDocSnap, userSettingsSnap] = await Promise.all([
    db.collection('users').doc(userId).get(),
    db.collection('userSettings').doc(userId).get(),
  ])

  const [companyUsersByUserId, companyUsersByUid, nestedUsers] = await Promise.all([
    db.collection('companyUsers').where('userId', '==', userId).limit(20).get().catch((err) => err as Error),
    db.collection('companyUsers').where('uid', '==', userId).limit(20).get().catch((err) => err as Error),
    db.collectionGroup('users').where(FieldPath.documentId(), '==', userId).limit(20).get().catch((err) => err as Error),
  ])

  const [crewLeadUser, crewLeadId, crewMember] = await Promise.all([
    db.collection('crews').where('crewLeadUserId', '==', userId).get().catch((err) => err as Error),
    db.collection('crews').where('crewLeadId', '==', userId).get().catch((err) => err as Error),
    db.collection('crews').where('memberUserIds', 'array-contains', userId).get().catch((err) => err as Error),
  ])

  let targetJob = await getDocByIdFromCollection('jobs', jobId)
  if (!targetJob) targetJob = await getDocByIdFromCollection('projectJobs', jobId)
  if (!targetJob) targetJob = await getDocByIdFromCollectionGroup('jobs', jobId)

  let targetJobView = await getDocByIdFromCollection('jobViews', jobId)
  if (!targetJobView) targetJobView = await getDocByIdFromCollectionGroup('jobViews', jobId)

  const [jobsByCrewLeadUser, jobsByCrewMember, jobsByAssignee] = await Promise.all([
    db.collection('jobs').where('crewLeadUserId', '==', userId).limit(100).get().catch((err) => err as Error),
    db.collection('jobs').where('crewMemberUserIds', 'array-contains', userId).limit(100).get().catch((err) => err as Error),
    db.collection('jobs').where('assigneeIds', 'array-contains', userId).limit(100).get().catch((err) => err as Error),
  ])

  const [latestNotifications, crewAssignmentNotifications] = await Promise.all([
    db.collection('notifications').where('userId', '==', userId).orderBy('createdAt', 'desc').limit(25).get().catch((err) => err as Error),
    db.collection('notifications').where('type', '==', 'crew_assignment').where('jobId', '==', jobId).orderBy('createdAt', 'desc').limit(25).get().catch((err) => err as Error),
  ])

  let inboxQueryResult:
    | { success: true; count: number; notifications: NotificationItem[] }
    | { success: false; error: SafeError }

  try {
    const inboxNotifications = await getInboxForUser(userId)
    inboxQueryResult = {
      success: true,
      count: inboxNotifications.length,
      notifications: inboxNotifications,
    }
  } catch (err) {
    inboxQueryResult = {
      success: false,
      error: toSafeError(err),
    }
  }

  const crews = new Map<string, {
    id: string
    path: string
    name: string | null
    crewLeadUserId: string | null
    crewLeadId: string | null
    memberUserIds: string[]
  }>()

  for (const snapOrErr of [crewLeadUser, crewLeadId, crewMember]) {
    if (snapOrErr instanceof Error) continue
    for (const doc of snapOrErr.docs) {
      const data = doc.data() as Record<string, unknown>
      crews.set(doc.id, {
        id: doc.id,
        path: doc.ref.path,
        name: typeof data.name === 'string' ? data.name : null,
        crewLeadUserId: typeof data.crewLeadUserId === 'string' ? data.crewLeadUserId : null,
        crewLeadId: typeof data.crewLeadId === 'string' ? data.crewLeadId : null,
        memberUserIds: toStringArray(data.memberUserIds),
      })
    }
  }

  const visibleJobs = new Map<string, {
    id: string
    path: string
    title: string | null
  }>()

  for (const snapOrErr of [jobsByCrewLeadUser, jobsByCrewMember, jobsByAssignee]) {
    if (snapOrErr instanceof Error) continue
    for (const doc of snapOrErr.docs) {
      const data = doc.data() as Record<string, unknown>
      visibleJobs.set(doc.id, {
        id: doc.id,
        path: doc.ref.path,
        title:
          typeof data.title === 'string'
            ? data.title
            : typeof data.name === 'string'
              ? data.name
              : null,
      })
    }
  }

  const companyUserRecords: Array<{ path: string; data: Record<string, unknown> }> = []

  for (const snapOrErr of [companyUsersByUserId, companyUsersByUid, nestedUsers]) {
    if (snapOrErr instanceof Error) continue
    for (const doc of snapOrErr.docs) {
      if (doc.ref.path === `users/${userId}`) continue
      companyUserRecords.push({
        path: doc.ref.path,
        data: doc.data() as Record<string, unknown>,
      })
    }
  }

  res.status(200).json({
    ok: true,
    debugTarget: {
      endpoint: '/api/admin/debug/crew-assignment-health',
      userId,
      jobId,
      requestedBy: requester.uid,
    },
    buildRuntime: {
      gitCommit: commitFromEnv,
      nodeEnv: process.env.NODE_ENV ?? null,
    },
    user: {
      uid: userId,
      customClaims: {
        role: targetAuthUser?.customClaims?.role ?? null,
        roles: Array.isArray(targetAuthUser?.customClaims?.roles) ? targetAuthUser?.customClaims?.roles : null,
        securityRole: targetAuthUser?.customClaims?.securityRole ?? null,
      },
      authLookupError: targetAuthUserError,
      userRecord: userDocSnap.exists
        ? {
            path: userDocSnap.ref.path,
            role: userDocSnap.get('role') ?? null,
            companyId: userDocSnap.get('companyId') ?? null,
            name: userDocSnap.get('name') ?? null,
            email: userDocSnap.get('email') ?? null,
            updatedAt: toIso(userDocSnap.get('updatedAt')),
          }
        : null,
      userSettings: userSettingsSnap.exists
        ? {
            path: userSettingsSnap.ref.path,
            data: userSettingsSnap.data(),
          }
        : null,
      companyUserRecords,
    },
    crewMembership: {
      crews: Array.from(crews.values()),
      queryErrors: {
        crewLeadUserId: crewLeadUser instanceof Error ? toSafeError(crewLeadUser) : null,
        crewLeadId: crewLeadId instanceof Error ? toSafeError(crewLeadId) : null,
        memberUserIds: crewMember instanceof Error ? toSafeError(crewMember) : null,
      },
    },
    targetJob: pickJobShape(targetJob?.path ?? null, targetJob?.data ?? null),
    targetJobView: pickJobShape(targetJobView?.path ?? null, targetJobView?.data ?? null),
    serverVisibilityCheck: {
      criteria: {
        crewLeadUserIdEqualsUid: userId,
        crewMemberUserIdsContainsUid: userId,
        assigneeIdsContainsUid: userId,
      },
      matchedJobs: Array.from(visibleJobs.values()),
      queryErrors: {
        crewLeadUserId: jobsByCrewLeadUser instanceof Error ? toSafeError(jobsByCrewLeadUser) : null,
        crewMemberUserIds: jobsByCrewMember instanceof Error ? toSafeError(jobsByCrewMember) : null,
        assigneeIds: jobsByAssignee instanceof Error ? toSafeError(jobsByAssignee) : null,
      },
    },
    notifications: {
      latestForUser:
        latestNotifications instanceof Error
          ? { error: toSafeError(latestNotifications) }
          : { count: latestNotifications.size, notifications: latestNotifications.docs.map(pickNotification) },
      crewAssignmentForJob:
        crewAssignmentNotifications instanceof Error
          ? { error: toSafeError(crewAssignmentNotifications) }
          : { count: crewAssignmentNotifications.size, notifications: crewAssignmentNotifications.docs.map(pickNotification) },
      getInboxForUser: inboxQueryResult,
    },
  })
})
