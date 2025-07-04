import './env.js'
import './CC.js'

import PouchSession from 'session-pouchdb-store'
import { Strategy as LocalStrategy } from 'passport-local'
import GoogleStrategy from 'passport-google-oidc'
import PassportJwt from 'passport-jwt'
import session from 'express-session'
import bcrypt from 'bcrypt-nodejs'
import flash from 'connect-flash'
import passport from 'passport'
import express from 'express'
import path from 'path'
import fs from 'fs/promises'
import mkdirp from 'mkdirp'
import BodyParser from 'body-parser'
import CookieParser from 'cookie-parser'
import ExpressPouchDB from 'express-pouchdb'
import { customAlphabet } from 'nanoid'
import jwksRsa from 'jwks-rsa'

import config from './config/index.js'
import PouchDB from './PouchDB.js'
import logger from './logger.js'

// from https://github.com/ai/nanoid/blob/main/url-alphabet/index.js
const nanoidWithoutUnderscores = customAlphabet('useandom-26T198340PX75pxJACKVERYMINDBUSHWOLFGQZbfghjklqvwyzrict')

if (!config.dbPrefix.startsWith('http')) {
  await mkdirp(config.dbPrefix)
}

const app = express()
app.set('base', config.base)
app.set('trust proxy', config.trustProxy)

// https://github.com/Wingysam/Christmas-Community/issues/17#issuecomment-1824863081
app.use((req, res, next) => {
  if (!req["session"]?.passport || Object.keys(req["session"]?.passport)?.length === 0) { res.clearCookie('christmas_community.connect.sid', { path: '/wishlist' }) }
  next()
})

const db = {
	users: _CC.usersDb,
	groups: _CC.groupsDb
}

// Run startup migrations
const { ensureManagersField } = await import('./migrations.js')
await ensureManagersField()

async function ensurePfp(username) {
	if (!config.pfp) return
	const user = await db.users.get(username)
	if (user.pfp) return

	const { rows } = await db.users.allDocs({ include_docs: true })

	const unfilteredPool = await fs.readdir('src/static/img/default-pfps')
	const filteredPool = unfilteredPool.filter(file => !rows.find(row => row.doc.pfp === `${_CC.config.base}img/default-pfps/${file}`))
	const pool = filteredPool.length ? filteredPool : unfilteredPool

	user.pfp = `${_CC.config.base}img/default-pfps/${_CC._.sample(pool)}`
	await db.users.put(user)
}

if (config.cfZeroAuthSSOEnabled) {
	passport.use('cf_jwt', new PassportJwt.Strategy({
    // Dynamically provide a signing key based on the kid in the header and the signing keys provided by the JWKS endpoint.
    secretOrKeyProvider: jwksRsa.passportJwtSecret({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: `https://${config.cfTeamName}.cloudflareaccess.com/cdn-cgi/access/certs`,
    }),
		jwtFromRequest: PassportJwt.ExtractJwt.fromHeader('cf-access-jwt-assertion'),
		audience: config.cfAppAudience,
	},
	async (jwt_payload, done) => {
		const email = jwt_payload.email
		const sub = jwt_payload.sub
		
    try {
      // Try to get the user from the database
      const user = await db.users.get(sub)
			return done(null, user)
    } catch (err) {
      // Handle other errors, including missing user
      if (err.message === 'missing') {

				try {
					// Add new user if they don't exist
					await db.users.put({
						_id: sub,
						admin: email === config.cfSetupAdminEmail,
						wishlist: [],
						groups: []
					})

					await ensurePfp(sub)

					// Retrieve the newly created user
					const newUser = await db.users.get(sub)
					return done(null, newUser);
				} catch (putErr) {
					// Handle errors while adding a new user
					console.log(putErr)
					return done(null, false, { message: putErr.message })
				}
      }
      return done(err)
    }
	}))
}

if (config.localLoginEnabled) {
	passport.use('local', new LocalStrategy(
		(username, password, done) => {
			username = username.trim()
			db.users.get(username)
				.then((doc: any) => {
					bcrypt.compare(password, doc.password, (err, correct) => {
						if (err) return done(err)
						if (!correct) return done(null, false, { message: _CC.lang('LOGIN_INCORRECT_PASSWORD') })
						if (correct) return done(null, doc)
					})
				})
				.catch(err => {
					if (err.message === 'missing') return done(null, false, { message: _CC.lang('LOGIN_INCORRECT_USERNAME') })
					return done(err)
				})
		}
	))
}

if (config.googleSSOEnabled) {
  passport.use('google-login', new GoogleStrategy({
    clientID: config.googleSSOClientId,
    clientSecret: config.googleSSOClientSecret,
    callbackURL: config.rootUrl + 'auth/google/redirect'
  },
  async (issuer, profile, done) => {
    const googleId = profile.id.trim() // Get Google id
    try {
      // Try to get the user from the database
      const docs = await db.users.find({
        selector: { 'oauthConnections.google': { $eq: googleId } }
      })
      if (docs.docs.length === 1) {
        return done(null, docs.docs[0])
      } else {
        // Handle other errors, including missing user
        return done(null, false, { message: _CC.lang('LOGIN_SSO_UNKNOWN_USER') })
      }
    } catch (err) {
      // Handle other errors, including missing user
      if (err.message === 'missing') {
        return done(null, false, { message: _CC.lang('LOGIN_SSO_UNKNOWN_USER') })
      }
      return done(err)
    }
  }
  ))

  passport.use('google-link', new GoogleStrategy({
    clientID: config.googleSSOClientId,
    clientSecret: config.googleSSOClientSecret,
    callbackURL: config.rootUrl + 'auth/google/link/redirect',
    passReqToCallback: true
  },
  async (req, issuer, profile, done) => {
    const googleId = profile.id.trim() // Get Google id

    const docs = await db.users.find({
      selector: { 'oauthConnections.google': { $eq: googleId } }
    })
    if (docs.docs.length === 1) {
      req.flash('error', _CC.lang('LOGIN_SSO_LINK_FAILURE_ACCOUNT_EXISTS'))
      return done(null)
    } else {
      try {
        const doc = await db.users.get(req.session.passport.user)
        doc.oauthConnections ??= {}
        doc.oauthConnections.google = googleId
        await db.users.put(doc)
        req.flash('success', _CC.lang('LOGIN_SSO_LINK_SUCCESS'))
        return done(null, doc)
      } catch (err) {
        req.flash('error', _CC.lang('LOGIN_SSO_LINK_FAILURE'))
        return done(err)
      }
    }
  }
  ))
}

passport.serializeUser((user, callback) => callback(null, user._id))

passport.deserializeUser((user, callback) => {
  db.users.get(user)
    .then(dbUser => callback(null, dbUser))
    .catch(() => callback(null, null))
})

// https://stackoverflow.com/a/54426950
app.use((req, res, next) => {
  const redirector = res.redirect
  res.redirect = function (url) {
    const base = this.req.app.set('base')
    if (base && url.startsWith('/')) url = base + url.substr(1)
    redirector.call(this, url)
  }
  next()
})

app.use(BodyParser.urlencoded({ extended: true }))
app.use(CookieParser())
app.use(session({
  secret: config.secret,
  resave: false,
  saveUninitialized: true,
  store: new PouchSession(new PouchDB('sessions')),
  cookie: {
    maxAge: config.sessionMaxAge
  },
  name: 'christmas_community.connect.sid',
  genid: () => nanoidWithoutUnderscores()
}))
app.use((req, res, next) => {
  const basepath = req.path.substring(0, req.path.lastIndexOf('/'))

  // Clear cookies for paths that are not the base path. See #17
  if (basepath.length > config.base.length) {
    res.clearCookie('christmas_community.connect.sid', { path: req.path })
    res.clearCookie('christmas_community.connect.sid', { path: basepath })
  }
  next()
})
app.use(flash())
app.use(passport.initialize())
app.use(passport.session())

app.use((await import('./middlewares/locals.js')).default)

app.use((req, res, next) => {
  logger.log('express', `${req.ip} - ${req.method} ${req.originalUrl}`)
  next()
})

app.get("/health/live", async (req, res) => {
	const healthcheck = {
		uptime: process.uptime(),
		message: 'OK',
		timestamp: Date.now()
	}

	try {
		return res.status(200).send(healthcheck)
	} catch (e) {
		healthcheck.message = `${e}`;
		res.status(503).send(healthcheck)
	}
})

app.get("/health/ready", async (req, res) => {
	const healthcheck = {
		uptime: process.uptime(),
		message: 'OK',
		timestamp: Date.now()
	}

	try {
		await db.users.info()

		return res.status(200).send(healthcheck)
	} catch (e) {
		healthcheck.message = `${e}`;
		res.status(503).send(healthcheck)
	}
})

if (config.cfZeroAuthSSOEnabled) {
	app.use(passport.authenticate('cf_jwt', { session: false }))
	app.use(async (req, res, next) => {
		if (req["user"].displayName == null) {
			const response = await fetch(`https://${config.cfTeamName}.cloudflareaccess.com/cdn-cgi/access/get-identity`, {
				headers: { cookie: `CF_Authorization=${req.headers["cf-access-jwt-assertion"]}` }
			})
			const profile = await response.json()

			const doc = await db.users.get(req["user"]._id)
			doc.displayName = profile.name
      await db.users.put(doc)
		}
		next()
	})
}

app.set('view engine', 'pug')
app.set('views', path.resolve('./src/views'))
app.use(config.base, (await import('./routes/index.js')).default({ db, config, ensurePfp }))

app.listen(config.port, () => { logger.success('express', `Express server started on port ${config.port}!`) })

;(() => {
  if (!config.dbExposePort) return
  const dbExposeApp = express()
  dbExposeApp.use('/', ExpressPouchDB(PouchDB, { inMemoryConfig: true, logPath: config.dbLogFile }))
  dbExposeApp.listen(config.dbExposePort, () => { logger.success('db expose', `DB has been exposed on port ${config.dbExposePort}`) })
})()
