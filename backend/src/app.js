const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const errorMw = require('./middlewares/errorMw');
const eventExists = require('./middlewares/eventExists');
const { eventAccess } = require('./middlewares/eventAccess');
const authMw = require('./middlewares/authMw');
const requireModule = require('./middlewares/requireModule');
const { corsOptions } = require('./config/corsOptions');
const { globalLimiter } = require('./middlewares/authRateLimit');

const app = express();

/**
 * We always sit behind at least one proxy (nginx and/or the Next.js rewrite
 * proxy). TRUST_PROXY accepts everything Express does: a hop count ("1"),
 * "loopback", "loopback,uniquelocal", an IP/CIDR list, "true" or "false".
 * Getting this right matters: rate limiting and logs key on req.ip.
 */
function parseTrustProxy(raw) {
  const v = String(raw ?? '').trim();
  if (v === '') return 1;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));
app.disable('x-powered-by');

// Security headers
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

app.use(cors(corsOptions()));
// Request counts and timings for the owner's health page (in memory, no paths kept).
app.use(require('./middlewares/metrics').middleware);

// 2mb: CSV bulk-import of a few hundred participants easily exceeds the Express default.
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '2mb' }));
app.use(cookieParser());

/** Root URL (health checks) — API routes live under /api/... */
app.get('/', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'hackos-api',
    hint: 'Use paths under /api (e.g. /api/events, /api/auth/login).',
  });
});

// Health check (also reachable as /api/health behind an /api-only reverse proxy)
const health = (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
};
app.get('/health', health);
app.get('/api/health', health);

// Telegram's webhook calls come from Telegram's servers, many per minute in a
// busy event — ahead of the per-user limiter; the secret header guards it.
app.post('/api/telegram/webhook', require('./controllers/telegram.controller').webhook);

// ── Global rate limiter (safety net for ALL API routes) ────────────────────
// Keyed per signed-in user (falls back to IP), so a venue full of hackers
// behind one NAT never shares a single bucket. Auth routes add a stricter
// per-IP limiter for failed attempts (see auth.routes.js).
app.use('/api', globalLimiter);

// An archived event can only be read: one guard in front of every router.
app.use('/api', require('./middlewares/archiveGuard').archiveGuard);

// Import routes
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const eventRoutes = require('./routes/event.routes');
const teamRoutes = require('./routes/team.routes');
const submissionRoutes = require('./routes/submission.routes');
const ticketRoutes = require('./routes/ticket.routes');
const announcementRoutes = require('./routes/announcement.routes');
const telegramRoutes = require('./routes/telegram.routes');
const mailRoutes = require('./routes/mail.routes');
const participantRoutes = require('./routes/participant.routes');
const presentationRoutes = require('./routes/presentation.routes');
const judgeRoutes = require('./routes/judge.routes');
const trackRoutes = require('./routes/track.routes');
const prizeRoutes = require('./routes/prize.routes');
const sponsorRoutes = require('./routes/sponsor.routes');
const mentorRoutes = require('./routes/mentor.routes');
const mentorSelfRoutes = require('./routes/mentorSelf.routes');
const judgeSelfRoutes = require('./routes/judgeSelf.routes');
const feedbackRoutes = require('./routes/feedback.routes');
const settingRoutes = require('./routes/setting.routes');
const certificateRoutes = require('./routes/certificate.routes');
const inviteRoutes = require('./routes/invite.routes');
const teamInviteRoutes = require('./routes/teamInvite.routes');
const volunteerRoutes = require('./routes/volunteer.routes');
const volunteerTaskRoutes = require('./routes/volunteerTask.routes');
const resourceRoutes = require('./routes/resource.routes');
const customerRoutes = require('./routes/customer.routes');
const orderRoutes = require('./routes/order.routes');
const meRoutes = require('./routes/me.routes');
const accountTeamRoutes = require('./routes/accountTeam.routes');
const checkoutRoutes = require('./routes/checkout.routes');

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/team-invites', teamInviteRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/tickets', requireModule('mentors'), ticketRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/mail', mailRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/me', meRoutes);
app.use('/api/account', accountTeamRoutes);
app.use('/api/account/webhooks', require('./routes/webhook.routes'));
app.use('/api/checkout', checkoutRoutes);
app.use('/api/leads', require('./routes/lead.routes'));
app.use('/api/owner', require('./routes/owner.routes'));
app.use('/api/mentor/me', mentorSelfRoutes);
app.use('/api/judge/me', judgeSelfRoutes);
app.use('/api/setup', require('./routes/setup.routes'));
app.use('/api/ai', require('./routes/ai.routes'));
// Signed-in only: the plan and limits of a customer's event are not public.
app.get('/api/events/:eventId/modules', authMw, eventExists, eventAccess, require('./controllers/orderActions.controller').eventModules);
app.use('/api/events/:eventId/builder', eventExists, eventAccess, require('./routes/builder.routes'));
app.use('/api/public', require('./routes/public.routes'));
// A personal calendar feed: the signed link is the key (calendar apps send no cookie).
app.get('/api/calendar/:token', require('./middlewares/authRateLimit').lookupLimiter, require('./controllers/notification.controller').personalFeed);
app.use('/api/files', require('./routes/file.routes'));
app.get('/api/universities', require('./controllers/eventBuilder.controller').universities);
app.use('/api/events/:eventId/participants', eventExists, eventAccess, participantRoutes);
app.use('/api/events/:eventId/presentations', eventExists, eventAccess, requireModule('presentations'), presentationRoutes);
app.use('/api/events/:eventId/judging', eventExists, eventAccess, judgeRoutes);
app.use('/api/events/:eventId/results', eventExists, eventAccess, requireModule('results'), require('./routes/results.routes'));
app.use('/api/events/:eventId/report', eventExists, eventAccess, requireModule('reports'), require('./routes/report.routes'));
app.use('/api/events/:eventId/elimination', eventExists, eventAccess, requireModule('elimination'), require('./routes/elimination.routes'));
app.use('/api/events/:eventId/voting', eventExists, eventAccess, require('./routes/voting.routes'));
app.use('/api/events/:eventId/chat', eventExists, eventAccess, require('./routes/chat.routes'));
app.use('/api/events/:eventId/gallery', eventExists, eventAccess, requireModule('gallery'), require('./routes/gallery.routes').router);
app.use('/api/gallery', require('./routes/gallery.routes').bySlug);
app.use('/api/events/:eventId/checkin', eventExists, eventAccess, requireModule('checkin'), require('./routes/checkin.routes'));
app.use('/api/events/:eventId/tracks', eventExists, eventAccess, trackRoutes);
app.use('/api/events/:eventId/prizes', eventExists, eventAccess, prizeRoutes);
app.use('/api/events/:eventId/sponsors', eventExists, eventAccess, sponsorRoutes);
app.use('/api/events/:eventId/mentors', eventExists, eventAccess, requireModule('mentors'), mentorRoutes);
app.use('/api/events/:eventId/volunteers', eventExists, eventAccess, requireModule('volunteers'), volunteerRoutes);
app.use('/api/events/:eventId/volunteer-tasks', eventExists, eventAccess, requireModule('volunteers'), volunteerTaskRoutes);
app.use('/api/events/:eventId/invites', eventExists, eventAccess, inviteRoutes);
app.use('/api/events/:eventId/participant-invites', eventExists, eventAccess, require('./routes/participantInvite.routes'));
app.use('/api/events/:eventId/feedback', eventExists, eventAccess, feedbackRoutes);
app.use('/api/events/:eventId/settings', eventExists, eventAccess, settingRoutes);
app.use('/api/events/:eventId/certificates', eventExists, eventAccess, requireModule('certificates'), certificateRoutes);
app.use('/api/events/:eventId/resources', eventExists, eventAccess, requireModule('resources'), resourceRoutes);
app.use('/api/events/:eventId/telegram', eventExists, eventAccess, requireModule('telegram'), require('./routes/eventTelegram.routes'));
app.use('/api/events/:eventId/matchmaking', eventExists, eventAccess, requireModule('teams'), require('./routes/matchmaking.routes'));

// JSON 404 for unknown API routes (instead of Express' HTML "Cannot GET …")
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    message: `No route for ${req.method} ${req.originalUrl}`,
    code: 'NOT_FOUND',
  });
});

app.use(errorMw);

module.exports = app;
