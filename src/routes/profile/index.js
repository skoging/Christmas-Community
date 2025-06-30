import verifyAuth from '../../middlewares/verifyAuth.js'
import bcrypt from 'bcrypt-nodejs'
import express from 'express'
import { addManager, removeManager } from '../../helpers/managers.js'

export default function ({ db, config, ensurePfp }) {
  const router = express.Router()

  router.get('/', verifyAuth(), async (req, res) => {
    await ensurePfp(req.user._id)
    
    // Get all users for collaborator dropdown
    const allUsers = await db.users.allDocs({ include_docs: true })
    const availableUsers = allUsers.rows
      .filter(row => row.doc._id !== req.user._id) // Exclude self
      .filter(row => !(req.user.managers && req.user.managers.some(m => m.userId === row.doc._id))) // Exclude existing managers
    
    res.render('profile', { 
      title: _CC.lang('PROFILE_TITLE', req.user.displayName ?? req.user._id),
      availableUsers: availableUsers,
      currentManagers: req.user.managers || []
    })
  })

  router.post('/pfp', verifyAuth(), async (req, res) => {
    if (config.pfp) {
      req.user.pfp = req.body.image
      await db.users.put(req.user)
      if (!req.user.pfp) await ensurePfp(req.user._id)
      req.flash('success', _CC.lang('PROFILE_SAVE_PFP_SUCCESS'))
    } else {
      req.flash('error', _CC.lang('PROFILE_SAVE_PFP_DISABLED'))
    }
    res.redirect('/profile')
  })

  const INFO_KEYS = [
    'shoeSize', 'ringSize', 'dressSize',
    'sweaterSize', 'shirtSize', 'pantsSize',
    'coatSize', 'hatSize', 'phoneModel'
  ]
  router.post('/info', verifyAuth(), async (req, res) => {
    if (!req.user.info) {
      req.user.info = {}
    }
    for (const [k, v] of Object.entries(req.body)) {
      console.log({ k, v })
      if (!INFO_KEYS.includes(k)) continue
      req.user.info[k] = v
    }
    await db.users.put(req.user)
    req.flash('success', _CC.lang('PROFILE_UPDATE_INFO_SUCCESS'))
    res.redirect('/profile')
  })

  router.get('/password', verifyAuth(), async (req, res) => {
    await ensurePfp(req.user._id)
    res.render('profile-password', { title: _CC.lang('PROFILE_PASSWORD_TITLE', req.user._id) })
  })
  router.post('/password', verifyAuth(), (req, res) => {
    if (!req.body.oldPassword) {
      req.flash('error', _CC.lang('PROFILE_PASSWORD_REQUIRED_OLD'))
      return res.redirect('/profile/password')
    }
    if (!req.body.newPassword) {
      req.flash('error', _CC.lang('PROFILE_PASSWORD_REQUIRED_NEW'))
      return res.redirect('/profile/password')
    }
    bcrypt.compare(req.body.oldPassword, req.user.password, (err, correct) => {
      if (err) throw err
      if (correct) {
        bcrypt.hash(req.body.newPassword, null, null, (err, hash) => {
          if (err) throw err
          db.users.get(req.user._id)
            .then(doc => {
              doc.password = hash
              db.users.put(doc)
                .then(() => {
                  req.flash('success', _CC.lang('PROFILE_PASSWORD_SUCCESS'))
                  res.redirect('/profile/password')
                })
                .catch(err => { throw err })
            })
            .catch(err => { throw err })
        })
      } else {
        req.flash('error', _CC.lang('PROFILE_PASSWORD_OLD_MISMATCH'))
        res.redirect('/profile/password')
      }
    })
  })

  // Add collaborator route
  router.post('/add-collaborator', verifyAuth(), async (req, res) => {
    try {
      const { collaboratorId } = req.body
      
      if (!collaboratorId) {
        req.flash('error', _CC.lang('PROFILE_COLLABORATORS_INVALID_INPUT'))
        return res.redirect('/profile')
      }

      // Validate collaborator exists
      await db.users.get(collaboratorId)

      await addManager(req.user._id, collaboratorId, 'collaborator', req.user._id)
      req.flash('success', _CC.lang('PROFILE_COLLABORATORS_ADD_SUCCESS', collaboratorId))
    } catch (error) {
      req.flash('error', `${error.message}`)
    }
    
    res.redirect('/profile')
  })

  // Remove collaborator route
  router.post('/remove-collaborator/:collaboratorId', verifyAuth(), async (req, res) => {
    try {
      // Check if the manager being removed is a collaborator (not full manager)
      const managerToRemove = req.user.managers?.find(m => m.userId === req.params.collaboratorId)
      if (!managerToRemove) {
        req.flash('error', _CC.lang('PROFILE_COLLABORATORS_NOT_FOUND'))
        return res.redirect('/profile')
      }
      
      if (managerToRemove.level !== 'collaborator') {
        req.flash('error', _CC.lang('PROFILE_COLLABORATORS_CANNOT_REMOVE_FULL'))
        return res.redirect('/profile')
      }

      await removeManager(req.user._id, req.params.collaboratorId)
      req.flash('success', _CC.lang('PROFILE_COLLABORATORS_REMOVE_SUCCESS', req.params.collaboratorId))
    } catch (error) {
      req.flash('error', `${error.message}`)
    }
    
    res.redirect('/profile')
  })

  return router
}
