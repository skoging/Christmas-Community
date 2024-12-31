import verifyAuth from '../../middlewares/verifyAuth.js'
import express from 'express'
import { nanoid } from 'nanoid'

const SECRET_TOKEN_LENGTH = 32
const SECRET_TOKEN_LIFETIME =
  // One week, approximately. Doesn't need to be perfect.
  1000 * // milliseconds
  60 * // seconds
  60 * // minutes
  24 * // hours
  7 // days

export default function ({ db, ensurePfp }) {
  const router = express.Router()

  router.get('/', verifyAuth(), (req, res) => {
    if (!req.user.admin) return res.redirect('/')
    db.users.allDocs({ include_docs: true })
      .then(docs => {
        res.render('adminSettings', { title: _CC.lang('ADMIN_SETTINGS_HEADER'), users: docs.rows })
      })
      .catch(err => { throw err })
  })

  router.post('/add', verifyAuth(), async (req, res) => {
    if (!req.user.admin) return res.redirect('/')

    const username = req.body.newUserUsername.trim()
    if (!username) {
      return db
        .allDocs({ include_docs: true })
        .then((docs) => {
          res.render('adminSettings', {
            add_user_error: _CC.lang(
              'ADMIN_SETTINGS_USERS_ADD_ERROR_USERNAME_EMPTY'
            ),
            title: _CC.lang('ADMIN_SETTINGS_HEADER'),
            users: docs.rows
          })
        })
        .catch((err) => {
          throw err
        })
    }

    await db.users.put({
      _id: username,
      admin: false,
      wishlist: [],

      signupToken: nanoid(SECRET_TOKEN_LENGTH),
      expiry: new Date().getTime() + SECRET_TOKEN_LIFETIME
    })

    await ensurePfp(username)
    res.redirect(`/admin-settings/edit/${req.body.newUserUsername.trim()}`)
  })

  router.get('/edit/:userToEdit', verifyAuth(), async (req, res) => {
    if (!req.user.admin) return res.redirect('/')
    const doc = await db.users.get(req.params.userToEdit)
    delete doc.password

		const groupDocs = await db.groups.allDocs({ include_docs: true })

    res.render('admin-user-edit', { user: doc, groups: groupDocs })
  })

  router.post('/edit/refresh-signup-token/:userToEdit', verifyAuth(), async (req, res) => {
    if (!req.user.admin) return res.redirect('/')
    const doc = await db.users.get(req.params.userToEdit)
    doc.signupToken = nanoid(SECRET_TOKEN_LENGTH)
    doc.expiry = new Date().getTime() + SECRET_TOKEN_LIFETIME
    await db.users.put(doc)
    return res.redirect(`/admin-settings/edit/${req.params.userToEdit}`)
  })

  router.post('/edit/resetpw/:userToEdit', verifyAuth(), async (req, res) => {
    if (!req.user.admin) return res.redirect('/')
    const doc = await db.users.get(req.params.userToEdit)
    doc.pwToken = nanoid(SECRET_TOKEN_LENGTH)
    doc.pwExpiry = new Date().getTime() + SECRET_TOKEN_LIFETIME
    await db.users.put(doc)
    return res.redirect(`/admin-settings/edit/${req.params.userToEdit}`)
  })

  router.post('/edit/cancelresetpw/:userToEdit', verifyAuth(), async (req, res) => {
    if (!req.user.admin) return res.redirect('/')
    const doc = await db.users.get(req.params.userToEdit)
    delete doc.pwToken
    delete doc.pwExpiry
    await db.users.put(doc)
    return res.redirect(`/admin-settings/edit/${req.params.userToEdit}`)
  })

  router.post('/edit/rename/:userToRename', verifyAuth(), async (req, res) => {
    if (!req.user.admin && req.user._id !== req.params.userToRename) return res.redirect('/')
    if (!req.body.newUsername) {
      req.flash('error', _CC.lang('ADMIN_SETTINGS_USERS_EDIT_NO_USERNAME_PROVIDED'))
      return res.redirect(`/admin-settings/edit/${req.params.userToRename}`)
    }
    if (req.body.newUsername === req.params.userToRename) {
      req.flash('error', _CC.lang('ADMIN_SETTINGS_USERS_EDIT_SAME_NAME'))
      return res.redirect(`/admin-settings/edit/${req.params.userToRename}`)
    }

    const oldName = req.params.userToRename
    const newName = req.body.newUsername

    const userDoc = await db.users.get(oldName)
    userDoc._id = newName
    delete userDoc._rev
    try {
      await db.users.put(userDoc)
      try {
        const usersBulk = []
        const users = (await db.users.allDocs({ include_docs: true })).rows
        for (const { doc: user } of users) {
          for (const item of user.wishlist) {
            if (item.pledgedBy === oldName) item.pledgedBy = newName
            if (item.addedBy === oldName) item.addedBy = newName
          }
          usersBulk.push(user)
        }

        await db.users.bulkDocs(usersBulk)
        await db.users.remove(await db.users.get(oldName))

        await _CC.wishlistManager.clearCache()

        req.flash('success', _CC.lang('ADMIN_SETTINGS_USERS_EDIT_RENAMED_USER'))
        return res.redirect(`/wishlist/${newName}`)
      } catch (error) {
        console.log(error, error.stack)
        await db.users.remove(await db.users.get(newName))
        throw error
      }
    } catch (error) {
      req.flash('error', error.message)
      return res.redirect(`/admin-settings/edit/${oldName}`)
    }
  })

  router.post('/edit/impersonate/:userToEdit', verifyAuth(), async (req, res) => {
    if (!req.user.admin) return res.redirect('/')
    req.login({ _id: req.params.userToEdit }, err => {
      if (err) {
        req.flash('error', err.message)
        return res.redirect(`/admin-settings/edit/${req.params.userToEdit}`)
      }
      req.flash('success', _CC.lang('ADMIN_SETTINGS_USERS_EDIT_IMPERSONATE_SUCCESS', req.params.userToEdit))
      res.redirect('/')
    })
  })

  router.post('/edit/promote/:userToPromote', verifyAuth(), async (req, res) => {
    if (!req.user.admin) return res.redirect('/')
    const user = await db.users.get(req.params.userToPromote)
    if (!user) {
      req.flash('error', _CC.lang('ADMIN_SETTINGS_USERS_EDIT_PROMOTE_DEMOTE_NOT_FOUND'))
      return res.redirect(`/admin-settings/edit/${req.params.userToPromote}`)
    }
    if (user.admin) {
      req.flash('error', _CC.lang('ADMIN_SETTINGS_USERS_EDIT_PROMOTE_ALREADY_ADMIN'))
      return res.redirect(`/admin-settings/edit/${req.params.userToPromote}`)
    }

    user.admin = true
    await db.users.put(user)

    req.flash('success', _CC.lang('ADMIN_SETTINGS_USERS_EDIT_PROMOTE_SUCCESS', user.displayName ?? user._id))
    return res.redirect(`/admin-settings/edit/${req.params.userToPromote}`)
  })

  router.post('/edit/demote/:userToDemote', verifyAuth(), async (req, res) => {
    if (!req.user.admin) return res.redirect('/')
    if (req.user._id === req.params.userToDemote) {
      req.flash('error', _CC.lang('ADMIN_SETTINGS_USERS_EDIT_DEMOTE_SELF'))
      return res.redirect(`/admin-settings/edit/${req.params.userToDemote}`)
    }

    const user = await db.users.get(req.params.userToDemote)

    if (!user) {
      req.flash('error', _CC.lang('ADMIN_SETTINGS_USERS_EDIT_PROMOTE_DEMOTE_NOT_FOUND'))
      return res.redirect(`/admin-settings/edit/${req.params.userToDemote}`)
    }
    if (!user.admin) {
      req.flash('error', _CC.lang('ADMIN_SETTINGS_USERS_EDIT_DEMOTE_NOT_ADMIN'))
      return res.redirect(`/admin-settings/edit/${req.params.userToDemote}`)
    }

    user.admin = false
    await db.users.put(user)

    req.flash('success', _CC.lang('ADMIN_SETTINGS_USERS_EDIT_DEMOTE_SUCCESS', user.displayName ?? user._id))
    return res.redirect(`/admin-settings/edit/${req.params.userToDemote}`)
  })

  router.post('/edit/:userToEdit/groups', verifyAuth(), async (req, res) => {
    if (!req.user.admin) return res.redirect('/')
    const user = await db.users.get(req.params.userToEdit)
    if (!user) {
      req.flash('error', _CC.lang('ADMIN_SETTINGS_USERS_EDIT_GROUP_ADD_REMOVE_USER_NOT_FOUND'))
      return res.redirect(`/admin-settings/edit/${req.params.userToEdit}`)
    }

		const group = {
			_id: nanoid(),
			displayName: req.body.displayName
		}
		await db.groups.put(group)

    user.groups = [...new Set([...user.groups ?? [], group._id])]
    await db.users.put(user)

    req.flash('success', _CC.lang('ADMIN_SETTINGS_USERS_EDIT_GROUP_ADD_SUCCESS', user.displayName ?? user._id, group.displayName))
    return res.redirect(`/admin-settings/edit/${req.params.userToEdit}`)
  })

  router.put('/edit/:userToEdit/groups/:groupId', verifyAuth(), async (req, res) => {
    if (!req.user.admin) return res.redirect('/')
    const user = await db.users.get(req.params.userToEdit)
    if (!user) {
      req.flash('error', _CC.lang('ADMIN_SETTINGS_USERS_EDIT_GROUP_ADD_REMOVE_USER_NOT_FOUND'))
      return res.redirect(`/admin-settings/edit/${req.params.userToEdit}`)
    }

		var group = await db.groups.get(groupId)
		if (!group) {
      req.flash('error', _CC.lang('ADMIN_SETTINGS_USERS_EDIT_GROUP_ADD_REMOVE_GROUP_NOT_FOUND'))
      return res.redirect(`/admin-settings/edit/${req.params.userToEdit}`)
    }

    user.groups = [...new Set([...user.groups, group._id])]
    await db.users.put(user)

    req.flash('success', _CC.lang('ADMIN_SETTINGS_USERS_EDIT_GROUP_ADD_SUCCESS', user.displayName ?? user._id, group.displayName))
    return res.redirect(`/admin-settings/edit/${req.params.userToEdit}`)
  })

  router.delete('/edit/:userToEdit/groups/:groupId', verifyAuth(), async (req, res) => {
    if (!req.user.admin) return res.redirect('/')
    const user = await db.users.get(req.params.userToEdit)
    if (!user) {
      req.flash('error', _CC.lang('ADMIN_SETTINGS_USERS_EDIT_GROUP_ADD_REMOVE_USER_NOT_FOUND'))
      return res.redirect(`/admin-settings/edit/${req.params.userToEdit}`)
    }

    user.groups = user.groups.filter(g => g !== groupId)
    await db.users.put(user)

    req.flash('success', _CC.lang('ADMIN_SETTINGS_USERS_EDIT_GROUP_REMOVE_SUCCESS', user.displayName ?? user._id, group.displayName))
    return res.redirect(`/admin-settings/edit/${req.params.userToEdit}`)
  })

  router.post('/edit/remove/:userToRemove', verifyAuth(), async (req, res) => {
    try {
      if (!req.user.admin) return res.redirect('/')

      const userToRemove = await db.users.get(req.params.userToRemove)
      if (userToRemove.admin) {
        req.flash('error', _CC.lang('ADMIN_SETTINGS_USERS_EDIT_DELETE_FAIL_ADMIN'))
        return res.redirect('/admin-settings')
      }
      await db.users.remove(userToRemove)

      const { rows } = await db.users.allDocs()
      for (const row of rows) {
        const wishlist = await _CC.wishlistManager.get(row.id)
        for (const item of wishlist.items) {
          if (item.addedBy === userToRemove._id) {
            await wishlist.remove(item.id)
          } else if (item.pledgedBy === userToRemove._id) {
            await wishlist.unpledge(item.id)
          }
        }
      }

      req.flash('success', _CC.lang('ADMIN_SETTINGS_USERS_EDIT_DELETE_SUCCESS', userToRemove.displayName ?? userToRemove._id))
    } catch (error) {
      req.flash('error', `${error}`)
    }

    res.redirect('/admin-settings')
  })

  router.get('/clear-wishlists', verifyAuth(), async (req, res) => {
    if (!req.user.admin) return res.redirect('/')
    res.render('admin-clear-wishlists')
  })

  router.post('/clear-wishlists', verifyAuth(), async (req, res) => {
    if (!req.user.admin) return res.redirect('/')

    const usersBulk = []
    const { rows: users } = await db.users.allDocs({ include_docs: true })
    for (const { doc: user } of users) {
      user.wishlist = []
      usersBulk.push(user)
    }
    await db.users.bulkDocs(usersBulk)

    await _CC.wishlistManager.clearCache()

    req.flash('success', _CC.lang('ADMIN_SETTINGS_CLEARDB_SUCCESS'))
    res.redirect('/admin-settings')
  })

  return router
}
