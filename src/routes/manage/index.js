import verifyAuth from '../../middlewares/verifyAuth.js'
import express from 'express'
import { getManagedUsers, addManager, removeManager, updateManagerLevel, canManageManagers, canRemoveManager } from '../../helpers/managers.js'

export default function ({ db }) {
  const router = express.Router()

  // Manager dashboard - show all users that the current user can manage
  router.get('/', verifyAuth(), async (req, res) => {
    try {
      // Get all users this manager can manage
      const managedUsers = await getManagedUsers(req.user._id)
      
      // If no managed users and not admin, redirect to profile
      if (managedUsers.length === 0 && !req.user.admin) {
        req.flash('info', _CC.lang('MANAGE_NO_MANAGED_USERS'))
        return res.redirect('/profile')
      }

      // Get all users for manager dropdown
      const allUsers = await db.users.allDocs({ include_docs: true })
      
      res.render('manage', {
        title: _CC.lang('MANAGE_TITLE'),
        managedUsers: managedUsers,
        allUsers: allUsers.rows
      })
    } catch (error) {
      req.flash('error', `${error.message}`)
      res.redirect('/profile')
    }
  })

  // Show individual user management page
  router.get('/user/:userId', verifyAuth(), async (req, res) => {
    try {
      const targetUser = await db.users.get(req.params.userId)
      
      // Check if current user can manage this target user
      if (!canManageManagers(req.user, req.params.userId, targetUser)) {
        req.flash('error', _CC.lang('MANAGE_INSUFFICIENT_PERMISSIONS'))
        return res.redirect('/manage')
      }

      // Get all users for manager dropdown
      const allUsers = await db.users.allDocs({ include_docs: true })
      const availableUsers = allUsers.rows
        .filter(row => row.doc._id !== req.params.userId) // Exclude target user
        .filter(row => !(targetUser.managers && targetUser.managers.some(m => m.userId === row.doc._id))) // Exclude existing managers

      res.render('manage-user', {
        title: _CC.lang('MANAGE_USER_TITLE', targetUser.displayName || targetUser._id),
        targetUser: targetUser,
        availableUsers: availableUsers,
        canManageAll: req.user.admin || canManageManagers(req.user, req.params.userId, targetUser)
      })
    } catch (error) {
      req.flash('error', `${error.message}`)
      res.redirect('/manage')
    }
  })

  // Add manager to a user
  router.post('/user/:userId/add-manager', verifyAuth(), async (req, res) => {
    try {
      const targetUser = await db.users.get(req.params.userId)
      const { managerId, level } = req.body
      
      if (!managerId || !level || !['full', 'collaborator'].includes(level)) {
        req.flash('error', _CC.lang('MANAGE_INVALID_INPUT'))
        return res.redirect(`/manage/user/${req.params.userId}`)
      }

      // Check permissions
      if (!canManageManagers(req.user, req.params.userId, targetUser, level)) {
        req.flash('error', _CC.lang('MANAGE_INSUFFICIENT_PERMISSIONS'))
        return res.redirect(`/manage/user/${req.params.userId}`)
      }

      // Validate manager exists
      await db.users.get(managerId)

      await addManager(req.params.userId, managerId, level, req.user._id)
      req.flash('success', _CC.lang('MANAGE_ADD_SUCCESS', managerId, level))
    } catch (error) {
      req.flash('error', `${error.message}`)
    }
    
    res.redirect(`/manage/user/${req.params.userId}`)
  })

  // Remove manager from a user
  router.post('/user/:userId/remove-manager/:managerId', verifyAuth(), async (req, res) => {
    try {
      const targetUser = await db.users.get(req.params.userId)
      
      // Check permissions
      if (!canRemoveManager(req.user, req.params.userId, targetUser, req.params.managerId)) {
        req.flash('error', _CC.lang('MANAGE_INSUFFICIENT_PERMISSIONS'))
        return res.redirect(`/manage/user/${req.params.userId}`)
      }

      await removeManager(req.params.userId, req.params.managerId)
      req.flash('success', _CC.lang('MANAGE_REMOVE_SUCCESS', req.params.managerId))
    } catch (error) {
      req.flash('error', `${error.message}`)
    }
    
    res.redirect(`/manage/user/${req.params.userId}`)
  })

  // Change manager level
  router.post('/user/:userId/change-manager-level/:managerId/:newLevel', verifyAuth(), async (req, res) => {
    try {
      const targetUser = await db.users.get(req.params.userId)
      
      if (!['full', 'collaborator'].includes(req.params.newLevel)) {
        req.flash('error', _CC.lang('MANAGE_INVALID_LEVEL'))
        return res.redirect(`/manage/user/${req.params.userId}`)
      }

      // Check permissions
      if (!canManageManagers(req.user, req.params.userId, targetUser, req.params.newLevel)) {
        req.flash('error', _CC.lang('MANAGE_INSUFFICIENT_PERMISSIONS'))
        return res.redirect(`/manage/user/${req.params.userId}`)
      }

      await updateManagerLevel(req.params.userId, req.params.managerId, req.params.newLevel)
      req.flash('success', _CC.lang('MANAGE_LEVEL_CHANGE_SUCCESS', req.params.managerId, req.params.newLevel))
    } catch (error) {
      req.flash('error', `${error.message}`)
    }
    
    res.redirect(`/manage/user/${req.params.userId}`)
  })

  return router
} 